// VibeBoss: which conversations load the knowledge base. The choice is per conversation, with a
// per-project default for new ones. A loaded conversation's agent gets a short note with each
// prompt pointing it at the index file; nothing from the knowledge base is sent ahead of time.
import type {
  VibeBossKnowledgeSelection,
  VibeBossKnowledgeSelectionInput,
  VibeBossKnowledgeSelectionState,
  VibeBossKnowledgeSetSelectionInput,
} from "@t3tools/contracts";
import {
  VibeBossError,
  VibeBossKnowledgeSelection as VibeBossKnowledgeSelectionSchema,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";
import { readFolder } from "./Knowledge.ts";
import { DEFAULT_CATEGORIES, INDEX_FILE } from "./KnowledgeNaming.ts";

const MAX_THREADS = 500;
const OFF: VibeBossKnowledgeSelection = { enabled: false, categories: null };

const Store = Schema.Struct({
  version: Schema.Literal(1),
  threads: Schema.Record(Schema.String, VibeBossKnowledgeSelectionSchema),
  projects: Schema.Record(Schema.String, VibeBossKnowledgeSelectionSchema),
});
type Store = typeof Store.Type;

const decodeStore = Schema.decodeUnknownOption(Schema.fromJsonString(Store));
const encodeStore = Schema.encodeEffect(Schema.fromJsonString(Store));

const storePath = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const path = yield* Path.Path;
  return path.join(config.stateDir, "vibeboss", "knowledge-selections.json");
});

const loadStore = Effect.fn("VibeBossKnowledgeSelection.loadStore")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const raw = yield* fs.readFileString(yield* storePath).pipe(Effect.option);
  const empty: Store = { version: 1, threads: {}, projects: {} };
  return Option.isNone(raw) ? empty : Option.getOrElse(decodeStore(raw.value), () => empty);
});

function sameSelection(left: VibeBossKnowledgeSelection, right: VibeBossKnowledgeSelection) {
  if (left.enabled !== right.enabled) return false;
  if (left.categories === null || right.categories === null) {
    return left.categories === right.categories;
  }
  return (
    left.categories.length === right.categories.length &&
    left.categories.every((category) => right.categories!.includes(category))
  );
}

function resolve(store: Store, input: VibeBossKnowledgeSelectionInput) {
  const projectDefault = input.projectId === null ? undefined : store.projects[input.projectId];
  return {
    selection: store.threads[input.threadId] ?? projectDefault ?? OFF,
    projectDefault: projectDefault ?? OFF,
  };
}

/** The default categories plus every top-level folder the user or the organizer has made. */
const listCategories = Effect.fn("VibeBossKnowledgeSelection.listCategories")(function* (
  folder: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const names = yield* fs.readDirectory(folder).pipe(Effect.orElseSucceed(() => []));
  const folders: Array<string> = [];
  for (const name of names.toSorted((left, right) => left.localeCompare(right))) {
    if (name.startsWith(".")) continue;
    const info = yield* fs.stat(path.join(folder, name)).pipe(Effect.option);
    if (Option.isSome(info) && info.value.type === "Directory") folders.push(name);
  }
  return [...new Set([...DEFAULT_CATEGORIES, ...folders])];
});

const buildState = Effect.fn("VibeBossKnowledgeSelection.buildState")(function* (
  store: Store,
  input: VibeBossKnowledgeSelectionInput,
) {
  const folder = yield* readFolder();
  const { selection, projectDefault } = resolve(store, input);
  const state: VibeBossKnowledgeSelectionState = {
    available: folder !== null,
    selection,
    isProjectDefault: sameSelection(selection, projectDefault),
    categories: folder === null ? [] : yield* listCategories(folder),
  };
  return state;
});

export const getSelection = Effect.fn("VibeBossKnowledgeSelection.getSelection")(function* (
  input: VibeBossKnowledgeSelectionInput,
) {
  return yield* buildState(yield* loadStore(), input);
});

export const setSelection = Effect.fn("VibeBossKnowledgeSelection.setSelection")(function* (
  input: VibeBossKnowledgeSetSelectionInput,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = yield* storePath;
  const before = yield* loadStore();
  // The oldest conversations lose their own choice first and fall back to the project default.
  const threads = Object.entries({ ...before.threads, [input.threadId]: input.selection }).slice(
    -MAX_THREADS,
  );
  const store: Store = {
    version: 1,
    threads: Object.fromEntries(threads),
    projects:
      input.asProjectDefault === true && input.projectId !== null
        ? { ...before.projects, [input.projectId]: input.selection }
        : before.projects,
  };
  const fail = (cause: unknown) => new VibeBossError({ detail: "保存知识库选择失败", cause });
  const json = yield* encodeStore(store).pipe(Effect.mapError(fail));
  yield* fs
    .makeDirectory(path.dirname(file), { recursive: true })
    .pipe(Effect.andThen(fs.writeFileString(file, `${json}\n`)), Effect.mapError(fail));
  return yield* buildState(store, input);
});

/** What a loaded conversation's agent is told; pure so the wording can be tested. */
export function knowledgeNote(
  folder: string,
  indexPath: string,
  categories: ReadonlyArray<string> | null,
): string {
  return [
    "<knowledge_base>",
    `用户为这个会话加载了知识库，位置：${folder}`,
    `需要查资料、找文件或引用已有材料时，先读索引 ${indexPath}（每个文件一行，有路径和摘要），再按路径打开原文件。和当前问题无关时不用读。`,
    categories === null ? "" : `这次只用这些分类里的资料：${categories.join("、")}。`,
    "同一主题有多个版本时，用户没点名就用最新的一版，并说明用的是哪一版。",
    "</knowledge_base>",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/** The note for one conversation's next prompt, or "" when it loads no knowledge. */
export const promptNote = Effect.fn("VibeBossKnowledgeSelection.promptNote")(
  function* (input: VibeBossKnowledgeSelectionInput) {
    const path = yield* Path.Path;
    const { selection } = resolve(yield* loadStore(), input);
    if (!selection.enabled) return "";
    if (selection.categories !== null && selection.categories.length === 0) return "";
    const folder = yield* readFolder();
    if (folder === null) return "";
    return knowledgeNote(folder, path.join(folder, INDEX_FILE), selection.categories);
  },
  Effect.orElseSucceed(() => ""),
);
