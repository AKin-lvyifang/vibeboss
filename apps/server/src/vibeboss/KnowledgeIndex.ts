// @effect-diagnostics nodeBuiltinImport:off -- one small SQLite file per knowledge folder, opened only while a call runs
// VibeBoss: full-text search over the knowledge folder. Each file's text is kept as short passages
// that remember where they came from (slide, sheet, heading), in one SQLite file inside the folder.
// It lives on disk and is read only when searched; deleting it just makes the next search rebuild it.
import * as NodeSqlite from "node:sqlite";

const PASSAGE_CHARS = 700;
export const MAX_DOC_CHARS = 150_000;

const CJK = /[㐀-鿿豈-﫿]/;

/**
 * Chinese has no spaces, so SQLite's word tokenizer would see a sentence as one word. Runs of
 * Chinese become overlapping two-character tokens, which is how a two-character word is found.
 */
export function tokenize(text: string): string {
  const tokens: Array<string> = [];
  let word = "";
  let run = "";
  const flush = () => {
    if (word !== "") tokens.push(word);
    if (run.length === 1) tokens.push(run);
    for (let index = 0; index + 1 < run.length; index++) tokens.push(run.slice(index, index + 2));
    word = "";
    run = "";
  };
  for (const char of text.toLowerCase()) {
    if (CJK.test(char)) {
      if (word !== "") flush();
      run += char;
    } else if (/[\p{L}\p{N}]/u.test(char)) {
      if (run !== "") flush();
      word += char;
    } else {
      flush();
    }
  }
  flush();
  return tokens.join(" ");
}

export interface Passage {
  /** Where in the file this text is: "第 3 页", "工作表 月度", a heading, or "" for the start. */
  readonly location: string;
  readonly text: string;
}

function locationOf(line: string): string | null {
  const slide = /^## Slide (\d+)\s*$/.exec(line);
  if (slide) return `第 ${slide[1]} 页`;
  const sheet = /^## Sheet: (.+)$/.exec(line);
  if (sheet) return `工作表 ${sheet[1]!.trim()}`;
  const heading = /^#{1,6}\s+(.+)$/.exec(line);
  return heading ? heading[1]!.trim().slice(0, 60) : null;
}

/** Cuts a file's text at slides, sheets and headings, and again wherever a part runs long. */
export function splitPassages(text: string): ReadonlyArray<Passage> {
  const passages: Array<Passage> = [];
  let location = "";
  let buffer = "";
  const flush = () => {
    const body = buffer.replace(/\n{3,}/g, "\n\n").trim();
    if (body !== "") passages.push({ location, text: body });
    buffer = "";
  };
  for (const line of text.slice(0, MAX_DOC_CHARS).split("\n")) {
    const next = locationOf(line);
    if (next !== null) {
      flush();
      location = next;
      continue;
    }
    if (buffer.length + line.length > PASSAGE_CHARS && buffer !== "") flush();
    let rest = line;
    while (rest.length > PASSAGE_CHARS) {
      buffer = rest.slice(0, PASSAGE_CHARS);
      flush();
      rest = rest.slice(PASSAGE_CHARS);
    }
    buffer += `${rest}\n`;
  }
  flush();
  return passages;
}

export interface IndexedFile {
  readonly path: string;
  readonly stamp: string;
}

export interface SearchHit {
  readonly path: string;
  readonly location: string;
  readonly text: string;
  readonly score: number;
}

export interface KnowledgeIndex {
  /** Paths whose stored text is missing or older than the file. */
  readonly stale: (files: ReadonlyArray<IndexedFile>) => ReadonlyArray<IndexedFile>;
  /** Replaces one file's passages. `summary` is searchable too, so a file is found by what it is about. */
  readonly put: (file: IndexedFile, summary: string, text: string) => void;
  /** Forgets every file not in `paths`. */
  readonly keepOnly: (paths: ReadonlyArray<string>) => void;
  readonly search: (
    query: string,
    limit: number,
    prefixes: ReadonlyArray<string> | null,
  ) => ReadonlyArray<SearchHit>;
  readonly read: (path: string) => ReadonlyArray<Passage>;
  readonly close: () => void;
}

export function openKnowledgeIndex(file: string): KnowledgeIndex {
  const db = new NodeSqlite.DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, stamp TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS passages (
      id INTEGER PRIMARY KEY, path TEXT NOT NULL, location TEXT NOT NULL, text TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS passages_path ON passages (path);
    CREATE VIRTUAL TABLE IF NOT EXISTS passage_tokens USING fts5(
      tokens, content = '', contentless_delete = 1, tokenize = 'unicode61'
    );
  `);
  // Deletes run as plain SQL: after a contentless FTS delete the connection reports a row id too
  // large for a prepared statement's `run` to return.
  const removePath = (path: string) => {
    const quoted = `'${path.replaceAll("'", "''")}'`;
    for (const row of db.prepare("SELECT id FROM passages WHERE path = ?").all(path)) {
      db.exec(`DELETE FROM passage_tokens WHERE rowid = ${Number(row.id)}`);
    }
    db.exec(
      `DELETE FROM passages WHERE path = ${quoted}; DELETE FROM files WHERE path = ${quoted};`,
    );
  };
  return {
    stale: (files) => {
      const known = new Map(
        db
          .prepare("SELECT path, stamp FROM files")
          .all()
          .map((row) => [row.path, row.stamp]),
      );
      return files.filter((item) => known.get(item.path) !== item.stamp);
    },
    put: (item, summary, text) => {
      db.exec("BEGIN");
      removePath(item.path);
      const insert = db.prepare("INSERT INTO passages (path, location, text) VALUES (?, ?, ?)");
      const index = db.prepare("INSERT INTO passage_tokens (rowid, tokens) VALUES (?, ?)");
      const name = item.path.slice(item.path.lastIndexOf("/") + 1);
      const passages = [{ location: "概要", text: summary }, ...splitPassages(text)];
      for (const passage of passages) {
        if (passage.text.trim() === "") continue;
        const id = insert.run(item.path, passage.location, passage.text).lastInsertRowid;
        // The file name rides along with every passage, so "that tech review deck" finds its slides.
        index.run(id, tokenize(`${name} ${passage.location} ${passage.text}`));
      }
      db.prepare("INSERT INTO files (path, stamp) VALUES (?, ?)").run(item.path, item.stamp);
      db.exec("COMMIT");
    },
    keepOnly: (paths) => {
      const keep = new Set(paths);
      for (const row of db.prepare("SELECT path FROM files").all()) {
        if (!keep.has(row.path as string)) removePath(row.path as string);
      }
    },
    search: (query, limit, prefixes) => {
      const tokens = [
        ...new Set(
          tokenize(query)
            .split(" ")
            .filter((token) => token !== ""),
        ),
      ];
      if (tokens.length === 0) return [];
      const match = tokens.map((token) => `"${token.replaceAll('"', "")}"`).join(" OR ");
      const rows = db
        .prepare(
          `SELECT p.path AS path, p.location AS location, p.text AS text, bm25(passage_tokens) AS rank
           FROM passage_tokens JOIN passages p ON p.id = passage_tokens.rowid
           WHERE passage_tokens MATCH ? ORDER BY rank LIMIT ?`,
        )
        .all(match, prefixes === null ? limit : limit * 6);
      return rows
        .filter(
          (row) =>
            prefixes === null ||
            prefixes.some((prefix) => (row.path as string).startsWith(`${prefix}/`)),
        )
        .slice(0, limit)
        .map((row) => ({
          path: row.path as string,
          location: row.location as string,
          text: row.text as string,
          score: -(row.rank as number),
        }));
    },
    read: (path) =>
      db
        .prepare("SELECT location, text FROM passages WHERE path = ? ORDER BY id")
        .all(path)
        .map((row) => ({ location: row.location as string, text: row.text as string })),
    close: () => db.close(),
  };
}
