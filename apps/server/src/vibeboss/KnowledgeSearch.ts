// VibeBoss: what the knowledge tools do. A search first brings the index up to date with the
// folder (only files that changed are read again), then answers from the index.
import { VibeBossError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import { getState } from "./Knowledge.ts";
import { type KnowledgeIndex, openKnowledgeIndex } from "./KnowledgeIndex.ts";
import { extensionOf } from "./KnowledgeNaming.ts";
import { extractText } from "./KnowledgeText.ts";

const INDEX_FILE = "index.sqlite";
/** A first search over a large folder indexes this many files and leaves the rest to the next. */
const SYNC_PER_CALL = 60;
const READ_CHARS = 40_000;

export interface KnowledgeHit {
  readonly path: string;
  readonly file: string;
  readonly location: string;
  readonly text: string;
  /** How the agent should name this source in its answer. */
  readonly cite: string;
}

const cite = (name: string, location: string) =>
  ["本地知识库", name, location === "概要" ? "" : location]
    .filter((part) => part !== "")
    .join(" · ");

const withIndex = Effect.fn("VibeBossKnowledgeSearch.withIndex")(function* <A>(
  use: (index: KnowledgeIndex, folder: string) => A,
) {
  const path = yield* Path.Path;
  const state = yield* getState();
  const folder = state.config.folder;
  if (folder === null) {
    return yield* new VibeBossError({ detail: "还没有设置知识库位置。" });
  }
  const index = yield* Effect.try({
    try: () => openKnowledgeIndex(path.join(folder, ".vibeboss", INDEX_FILE)),
    catch: (cause) => new VibeBossError({ detail: "打不开知识库检索库。", cause }),
  });
  return yield* Effect.gen(function* () {
    const files = state.docs.map((doc) => ({
      path: doc.path,
      stamp: `${doc.modifiedAt}:${doc.size}`,
    }));
    const byPath = new Map(state.docs.map((doc) => [doc.path, doc]));
    index.keepOnly(files.map((file) => file.path));
    for (const file of index.stale(files).slice(0, SYNC_PER_CALL)) {
      const doc = byPath.get(file.path)!;
      const text = yield* extractText(
        path.join(folder, ...file.path.split("/")),
        extensionOf(doc.name),
      );
      index.put(
        file,
        [doc.topic, doc.version, doc.audience, doc.summary].filter((part) => part !== "").join(" "),
        text,
      );
    }
    return use(index, folder);
  }).pipe(Effect.ensuring(Effect.sync(() => index.close())));
});

/** Brings the index up to date without searching, so the first question after organizing is fast. */
export const syncIndex = Effect.fn("VibeBossKnowledgeSearch.syncIndex")(function* () {
  yield* withIndex(() => undefined);
});

/** The passages that best match a question, each with where it is and how to cite it. */
export const searchPassages = Effect.fn("VibeBossKnowledgeSearch.searchPassages")(function* (
  query: string,
  limit: number,
  categories: ReadonlyArray<string> | null,
) {
  return yield* withIndex((index) =>
    index.search(query, limit, categories).map((hit): KnowledgeHit => {
      const file = hit.path.slice(hit.path.lastIndexOf("/") + 1);
      return {
        path: hit.path,
        file,
        location: hit.location,
        text: hit.text,
        cite: cite(file, hit.location),
      };
    }),
  );
});

/** One file's text from the index, so a slide deck or spreadsheet can be read like a document. */
export const readDocument = Effect.fn("VibeBossKnowledgeSearch.readDocument")(function* (
  relativePath: string,
) {
  const passages = yield* withIndex((index) => index.read(relativePath));
  if (passages.length === 0) {
    return yield* new VibeBossError({ detail: "知识库里没有这个文件，路径要照搜索结果原样填写。" });
  }
  const file = relativePath.slice(relativePath.lastIndexOf("/") + 1);
  let text = "";
  let location = "";
  for (const passage of passages) {
    if (passage.location !== location) {
      location = passage.location;
      text += `\n\n## ${location}\n`;
    }
    text += `${passage.text}\n`;
  }
  const trimmed = text.trim();
  return {
    path: relativePath,
    file,
    text: trimmed.slice(0, READ_CHARS),
    truncated: trimmed.length > READ_CHARS,
    cite: cite(file, ""),
  };
});
