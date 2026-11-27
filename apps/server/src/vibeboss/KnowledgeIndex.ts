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

/** Below this share of the question's weight, a passage only brushes the topic and is left out. */
const MIN_COVERAGE = 0.5;

// Words that shape a question without saying what it is about; left in, they match everything.
// Single characters are dropped only once the text is split into words, so 目的 keeps its 的.
const QUESTION_WORDS =
  /是什么意思|什么意思|是什么|为什么|有哪些|有什么|什么|怎么样|怎么|怎样|如何|哪些|哪个|哪里|在哪|多少钱|多少|是否|有没有|请问|一下|一个|我们|这次|那个|这个|应该|可以/g;
const PARTICLES = new Set("吗呢吧的了是讲和与及或我你他在有把被给过着");

const segmenter = new Intl.Segmenter("zh", { granularity: "word" });

interface QueryWord {
  readonly word: string;
  /**
   * The word may be noise: joined back from single characters (the system segmenter splits names
   * it does not know into 小 红 书, but also leaves 早 会 上 that way), or carrying a particle.
   */
  readonly joined: boolean;
}

/** The words a question is about; a lone character is dropped. */
function queryWords(query: string): ReadonlyArray<QueryWord> {
  const words: Array<QueryWord> = [];
  let run = "";
  const flush = () => {
    if ([...run].length > 1) words.push({ word: run, joined: true });
    run = "";
  };
  const text = query.toLowerCase().replace(QUESTION_WORDS, " ");
  for (const part of segmenter.segment(text)) {
    if (!part.isWordLike) {
      flush();
      continue;
    }
    const segment = part.segment;
    if ([...segment].length === 1 && CJK.test(segment)) {
      if (PARTICLES.has(segment)) flush();
      else run += segment;
      continue;
    }
    flush();
    // "讲的" and "改了" come back as words but may say nothing about the topic, while 目的 does.
    const unsure = [...segment].some((char) => PARTICLES.has(char));
    if (CJK.test(segment) || segment.length > 1) words.push({ word: segment, joined: unsure });
  }
  flush();
  return words.filter(
    (item, index) => words.findIndex((other) => other.word === item.word) === index,
  );
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
  /** How much of what the question asks about this passage mentions, 0 to 1, rare words counting more. */
  readonly coverage: number;
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
    CREATE VIRTUAL TABLE IF NOT EXISTS passage_vocab USING fts5vocab(passage_tokens, 'row');
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
      const total = Number(db.prepare("SELECT count(*) AS n FROM passages").get()?.n ?? 0);
      const frequency = db.prepare("SELECT doc FROM passage_vocab WHERE term = ?");
      const idf = (seen: number) => Math.log(1 + total / (seen + 0.5));
      // Each word is looked at through its two-character pieces that the knowledge base has.
      // A word it never mentions weighs most: if the question is about it, nothing here answers.
      // A joined word it never mentions is more likely a particle, so it is set aside.
      const words = queryWords(query).flatMap(({ word, joined }) => {
        const pieces = tokenize(word)
          .split(" ")
          .filter((token) => token !== "")
          .map((token) => ({ token, seen: Number(frequency.get(token)?.doc ?? 0) }));
        const known = pieces.filter((piece) => piece.seen > 0);
        if (known.length === 0) {
          return joined ? [] : [{ pieces: [] as Array<string>, weight: idf(0) }];
        }
        return [
          {
            pieces: known.map((piece) => piece.token),
            weight: idf(Math.min(...known.map((piece) => piece.seen))),
          },
        ];
      });
      const tokens = [...new Set(words.flatMap((item) => item.pieces))];
      if (tokens.length === 0) return [];
      const match = tokens.map((token) => `"${token.replaceAll('"', "")}"`).join(" OR ");
      const rows = db
        .prepare(
          `SELECT p.path AS path, p.location AS location, p.text AS text, bm25(passage_tokens) AS rank
           FROM passage_tokens JOIN passages p ON p.id = passage_tokens.rowid
           WHERE passage_tokens MATCH ? ORDER BY rank LIMIT ?`,
        )
        .all(match, prefixes === null ? limit * 3 : limit * 8);
      const whole = words.reduce((sum, item) => sum + item.weight, 0);
      return (
        rows
          .filter(
            (row) =>
              prefixes === null ||
              prefixes.some((prefix) => (row.path as string).startsWith(`${prefix}/`)),
          )
          .map((row) => {
            const path = row.path as string;
            const present = new Set(
              tokenize(
                `${path.slice(path.lastIndexOf("/") + 1)} ${row.location} ${row.text}`,
              ).split(" "),
            );
            const covered = words.reduce(
              (sum, item) =>
                item.pieces.length === 0
                  ? sum
                  : sum +
                    (item.weight * item.pieces.filter((piece) => present.has(piece)).length) /
                      item.pieces.length,
              0,
            );
            return {
              path,
              location: row.location as string,
              text: row.text as string,
              score: -(row.rank as number),
              coverage: whole === 0 ? 0 : covered / whole,
            };
          })
          // A passage that shares only a common word with the question is not an answer to it.
          .filter((hit) => hit.coverage >= MIN_COVERAGE)
          .slice(0, limit)
      );
    },
    read: (path) =>
      db
        .prepare("SELECT location, text FROM passages WHERE path = ? ORDER BY id")
        .all(path)
        .map((row) => ({ location: row.location as string, text: row.text as string })),
    close: () => db.close(),
  };
}
