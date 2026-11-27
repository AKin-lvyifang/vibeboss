// VibeBoss: the knowledge base is one plain folder. Files keep their own formats; VibeBoss adds an
// index agents read first and a hidden record of what the organizer did, so every run can be undone.
import * as NodeOS from "node:os";

import {
  type VibeBossKnowledgeConfig,
  VibeBossKnowledgeConfig as VibeBossKnowledgeConfigSchema,
  type VibeBossKnowledgeDoc,
  VibeBossKnowledgeLogEntry,
  type VibeBossKnowledgeOrganizeResult,
  type VibeBossKnowledgeState,
  VibeBossError,
  type VibeBossReviewModel,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";
import {
  DEFAULT_CATEGORIES,
  docType,
  EXCERPT_CHARS,
  extensionOf,
  INDEX_FILE,
  type OrganizeInput,
  organizedPath,
  organizePrompt,
  type OrganizePlan,
  parseOrganizeAnswer,
  renderIndex,
  uniquePath,
} from "./KnowledgeNaming.ts";

const STORE_DIR = ".vibeboss";
const STORE_FILE = "knowledge.json";
const FEISHU_LOG_FILE = "feishu-sync.jsonl";
const FEISHU_TASK_FILE = "feishu-sync-task.md";
const FEISHU_ROOT_FILE = "feishu-root.json";
const MAX_FILES = 2000;
const MAX_DEPTH = 4;
const BATCH = 6;
const MAX_PER_RUN = 30;
const MAX_LOG = 50;

const fail = (detail: string) => (cause: unknown) => new VibeBossError({ detail, cause });

const DocRecord = Schema.Struct({
  originalPath: Schema.String,
  category: Schema.String,
  group: Schema.String,
  topic: Schema.String,
  version: Schema.String,
  date: Schema.String,
  audience: Schema.String,
  summary: Schema.String,
});
type DocRecord = typeof DocRecord.Type;

const Store = Schema.Struct({
  version: Schema.Literal(1),
  docs: Schema.Record(Schema.String, DocRecord),
  held: Schema.Array(Schema.String),
  log: Schema.Array(VibeBossKnowledgeLogEntry),
});
type Store = typeof Store.Type;

const EMPTY_STORE: Store = { version: 1, docs: {}, held: [], log: [] };
const EMPTY_CONFIG: VibeBossKnowledgeConfig = { version: 1, folder: null };

const decodeConfig = Schema.decodeUnknownOption(
  Schema.fromJsonString(VibeBossKnowledgeConfigSchema),
);
const encodeConfig = Schema.encodeEffect(Schema.fromJsonString(VibeBossKnowledgeConfigSchema));
const decodeStore = Schema.decodeUnknownOption(Schema.fromJsonString(Store));
const encodeStore = Schema.encodeEffect(Schema.fromJsonString(Store));

const resolvePaths = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const path = yield* Path.Path;
  return {
    configPath: path.join(config.stateDir, "vibeboss", "knowledge.json"),
    defaultFolder: path.join(NodeOS.homedir(), "VibeBoss", "Knowledge"),
  };
});

const readText = Effect.fn("VibeBossKnowledge.readText")(function* (file: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.readFileString(file).pipe(Effect.orElseSucceed(() => null));
});

const writeText = Effect.fn("VibeBossKnowledge.writeText")(function* (file: string, text: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs
    .makeDirectory(path.dirname(file), { recursive: true })
    .pipe(
      Effect.andThen(fs.writeFileString(file, text)),
      Effect.mapError(fail(`写入 ${file} 失败`)),
    );
});

const loadConfig = Effect.fn("VibeBossKnowledge.loadConfig")(function* (configPath: string) {
  const raw = yield* readText(configPath);
  return raw === null ? EMPTY_CONFIG : Option.getOrElse(decodeConfig(raw), () => EMPTY_CONFIG);
});

const loadStore = Effect.fn("VibeBossKnowledge.loadStore")(function* (folder: string) {
  const path = yield* Path.Path;
  const raw = yield* readText(path.join(folder, STORE_DIR, STORE_FILE));
  return raw === null ? EMPTY_STORE : Option.getOrElse(decodeStore(raw), () => EMPTY_STORE);
});

// The agent doing the upload appends one line per file; lines it gets wrong are ignored.
const FeishuRecord = Schema.Struct({
  path: Schema.String,
  url: Schema.String,
  at: Schema.String,
  /** Feishu's own id of the uploaded copy, so the next sync updates it instead of adding another. */
  token: Schema.optional(Schema.String),
});
type FeishuRecord = typeof FeishuRecord.Type;
const decodeFeishuRecord = Schema.decodeUnknownOption(Schema.fromJsonString(FeishuRecord));

/** The latest upload of each file, by path. */
const loadFeishuRecords = Effect.fn("VibeBossKnowledge.loadFeishuRecords")(function* (
  folder: string,
) {
  const path = yield* Path.Path;
  const raw = yield* readText(path.join(folder, STORE_DIR, FEISHU_LOG_FILE));
  const records = new Map<string, FeishuRecord>();
  for (const line of (raw ?? "").split("\n")) {
    const record = line.trim() === "" ? Option.none() : decodeFeishuRecord(line);
    if (Option.isSome(record)) records.set(record.value.path, record.value);
  }
  return records;
});

/**
 * A file the organizer moved keeps its Feishu copy: the record is repeated under the new path.
 * Lines are only ever appended, like the agent's own.
 */
const carryFeishuRecords = Effect.fn("VibeBossKnowledge.carryFeishuRecords")(function* (
  folder: string,
  moves: ReadonlyArray<{ readonly from: string; readonly to: string }>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const records = yield* loadFeishuRecords(folder);
  const lines = moves.flatMap((move) => {
    const record = records.get(move.from);
    return record === undefined ? [] : [JSON.stringify({ ...record, path: move.to })];
  });
  if (lines.length === 0) return;
  const file = path.join(folder, STORE_DIR, FEISHU_LOG_FILE);
  const before = (yield* readText(file)) ?? "";
  yield* fs
    .writeFileString(file, `${before.replace(/\n*$/, "\n")}${lines.join("\n")}\n`)
    .pipe(Effect.ignore);
});

interface ScannedFile {
  readonly path: string;
  readonly size: number;
  readonly modifiedAt: string;
}

const scan = Effect.fn("VibeBossKnowledge.scan")(function* (folder: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const files: Array<ScannedFile> = [];
  const walk: (relative: string, depth: number) => Effect.Effect<void> = Effect.fnUntraced(
    function* (relative: string, depth: number) {
      const dir = relative === "" ? folder : path.join(folder, ...relative.split("/"));
      const names = yield* fs.readDirectory(dir).pipe(Effect.orElseSucceed(() => []));
      for (const name of names.toSorted((left, right) => left.localeCompare(right))) {
        if (files.length >= MAX_FILES) return;
        if (name.startsWith(".") || name.startsWith("~$")) continue;
        const child = relative === "" ? name : `${relative}/${name}`;
        if (child === INDEX_FILE) continue;
        const info = yield* fs.stat(path.join(dir, name)).pipe(Effect.option);
        if (Option.isNone(info)) continue;
        if (info.value.type === "Directory") {
          if (depth < MAX_DEPTH) yield* walk(child, depth + 1);
        } else if (info.value.type === "File") {
          files.push({
            path: child,
            size: Number(info.value.size),
            modifiedAt: Option.match(info.value.mtime, {
              onNone: () => "",
              onSome: (modified) => modified.toISOString(),
            }),
          });
        }
      }
    },
  );
  yield* walk("", 0);
  return files;
});

function toDoc(
  file: ScannedFile,
  store: Store,
  uploads: ReadonlyMap<string, FeishuRecord>,
): VibeBossKnowledgeDoc {
  const record = store.docs[file.path];
  const upload = uploads.get(file.path);
  const name = file.path.slice(file.path.lastIndexOf("/") + 1);
  const uploadedAt = upload === undefined ? Number.NaN : Date.parse(upload.at);
  const base = {
    path: file.path,
    name,
    type: docType(name),
    size: file.size,
    modifiedAt: file.modifiedAt,
    feishu:
      upload === undefined || Number.isNaN(uploadedAt)
        ? ("none" as const)
        : uploadedAt >= Date.parse(file.modifiedAt)
          ? ("synced" as const)
          : ("changed" as const),
    feishuUrl: upload?.url ?? null,
  };
  if (record === undefined) {
    return {
      ...base,
      organized: false,
      held: store.held.includes(file.path),
      category: "",
      group: "",
      topic: "",
      version: "",
      date: "",
      audience: "",
      summary: "",
      originalName: name,
    };
  }
  return {
    ...base,
    organized: true,
    held: false,
    category: record.category,
    group: record.group,
    topic: record.topic,
    version: record.version,
    date: record.date,
    audience: record.audience,
    summary: record.summary,
    originalName: record.originalPath.slice(record.originalPath.lastIndexOf("/") + 1),
  };
}

/** Drops records of files that were renamed or removed outside VibeBoss. */
function pruneStore(store: Store, files: ReadonlyArray<ScannedFile>): Store {
  const present = new Set(files.map((file) => file.path));
  return {
    ...store,
    docs: Object.fromEntries(Object.entries(store.docs).filter(([key]) => present.has(key))),
    held: store.held.filter((key) => present.has(key)),
  };
}

const buildState = Effect.fn("VibeBossKnowledge.buildState")(function* (
  config: VibeBossKnowledgeConfig,
  defaultFolder: string,
) {
  const path = yield* Path.Path;
  if (config.folder === null) {
    const state: VibeBossKnowledgeState = {
      config,
      defaultFolder,
      categories: [...DEFAULT_CATEGORIES],
      docs: [],
      log: [],
      indexPath: null,
    };
    return { state, store: EMPTY_STORE };
  }
  const files = yield* scan(config.folder);
  const store = pruneStore(yield* loadStore(config.folder), files);
  const uploads = yield* loadFeishuRecords(config.folder);
  const docs = files.map((file) => toDoc(file, store, uploads));
  const used = docs.filter((doc) => doc.organized).map((doc) => doc.category);
  const state: VibeBossKnowledgeState = {
    config,
    defaultFolder,
    categories: [...new Set([...DEFAULT_CATEGORIES, ...used])],
    docs,
    log: store.log,
    indexPath: path.join(config.folder, INDEX_FILE),
  };
  return { state, store };
});

const persist = Effect.fn("VibeBossKnowledge.persist")(function* (
  folder: string,
  store: Store,
  docs: ReadonlyArray<VibeBossKnowledgeDoc>,
) {
  const path = yield* Path.Path;
  const json = yield* encodeStore(store).pipe(Effect.mapError(fail("保存整理记录失败")));
  yield* writeText(path.join(folder, STORE_DIR, STORE_FILE), `${json}\n`);
  yield* writeText(path.join(folder, INDEX_FILE), renderIndex(docs));
});

/** The knowledge folder, or null until one is set. */
export const readFolder = Effect.fn("VibeBossKnowledge.readFolder")(function* () {
  const paths = yield* resolvePaths;
  return (yield* loadConfig(paths.configPath)).folder;
});

export const getState = Effect.fn("VibeBossKnowledge.getState")(function* () {
  const paths = yield* resolvePaths;
  const config = yield* loadConfig(paths.configPath);
  return (yield* buildState(config, paths.defaultFolder)).state;
});

export const saveConfig = Effect.fn("VibeBossKnowledge.saveConfig")(function* (
  input: VibeBossKnowledgeConfig,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const paths = yield* resolvePaths;
  const folder = input.folder === null ? null : input.folder.trim();
  if (folder !== null && !path.isAbsolute(folder)) {
    return yield* new VibeBossError({ detail: "知识库位置要填完整路径。" });
  }
  const config: VibeBossKnowledgeConfig = { ...input, folder };
  if (folder !== null) {
    yield* fs
      .makeDirectory(folder, { recursive: true })
      .pipe(Effect.mapError(fail(`创建 ${folder} 失败`)));
  }
  const json = yield* encodeConfig(config).pipe(Effect.mapError(fail("保存配置失败")));
  yield* writeText(paths.configPath, `${json}\n`);
  const built = yield* buildState(config, paths.defaultFolder);
  if (folder !== null) yield* persist(folder, built.store, built.state.docs);
  return built.state;
});

export type KnowledgeGenerate = (
  prompt: string,
  model: VibeBossReviewModel | undefined,
) => Effect.Effect<string, object>;

export type KnowledgeExtract = (file: string, extension: string) => Effect.Effect<string>;

/** Names and files what is still unorganized. Each run is one log entry that `undo` can reverse. */
export const organize = Effect.fn("VibeBossKnowledge.organize")(function* (
  includeHeld: boolean,
  generate: KnowledgeGenerate | null,
  extract: KnowledgeExtract,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const paths = yield* resolvePaths;
  const config = yield* loadConfig(paths.configPath);
  const before = yield* buildState(config, paths.defaultFolder);
  const folder = config.folder;
  const pending = before.state.docs
    .filter((doc) => !doc.organized && (includeHeld || !doc.held))
    .slice(0, MAX_PER_RUN);
  const done = (
    state: VibeBossKnowledgeState,
    organized: number,
    modelError: string | null,
  ): VibeBossKnowledgeOrganizeResult => ({ state, organized, modelError });
  if (folder === null || pending.length === 0) return done(before.state, 0, null);
  if (generate === null) {
    return done(before.state, 0, "没有可用的小模型，文件留在“待整理”。");
  }
  const absolute = (relative: string) => path.join(folder, ...relative.split("/"));
  const now = DateTime.formatIso(yield* DateTime.now);

  const organizedDocs = before.state.docs.filter((doc) => doc.organized);
  const topics = new Set(organizedDocs.map((doc) => doc.topic));
  const groups = new Set(
    organizedDocs.filter((doc) => doc.group !== "").map((doc) => `${doc.category}/${doc.group}`),
  );
  const plans: Array<OrganizePlan> = [];
  let failedBatches = 0;
  for (let offset = 0; offset < pending.length; offset += BATCH) {
    const inputs: Array<OrganizeInput> = [];
    for (const doc of pending.slice(offset, offset + BATCH)) {
      const excerpt = yield* extract(absolute(doc.path), extensionOf(doc.name));
      inputs.push({
        file: doc.path,
        modifiedDate: (doc.modifiedAt || now).slice(0, 10),
        excerpt: excerpt.slice(0, EXCERPT_CHARS),
      });
    }
    const answer = yield* generate(
      organizePrompt(inputs, {
        categories: before.state.categories,
        groups: [...groups],
        topics: [...topics],
      }),
      config.organizerModel,
    ).pipe(Effect.result);
    if (answer._tag === "Failure") {
      failedBatches++;
      continue;
    }
    for (const plan of parseOrganizeAnswer(answer.success, inputs, before.state.categories)) {
      plans.push(plan);
      topics.add(plan.topic);
      if (plan.group !== "") groups.add(`${plan.category}/${plan.group}`);
    }
  }

  const taken = new Set(before.state.docs.map((doc) => doc.path));
  const docs = { ...before.store.docs };
  const moves: Array<{ from: string; to: string }> = [];
  for (const plan of plans) {
    const fileName = plan.file.slice(plan.file.lastIndexOf("/") + 1);
    const target = uniquePath(organizedPath(plan, extensionOf(fileName)), taken);
    const moved = yield* fs.makeDirectory(path.dirname(absolute(target)), { recursive: true }).pipe(
      Effect.andThen(fs.rename(absolute(plan.file), absolute(target))),
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );
    if (!moved) continue;
    taken.delete(plan.file);
    taken.add(target);
    docs[target] = {
      originalPath: plan.file,
      category: plan.category,
      group: plan.group,
      topic: plan.topic,
      version: plan.version,
      date: plan.date,
      audience: plan.audience,
      summary: plan.summary,
    };
    moves.push({ from: plan.file, to: target });
  }

  const movedFrom = new Set(moves.map((move) => move.from));
  const store: Store = {
    version: 1,
    docs,
    held: before.store.held.filter((key) => !movedFrom.has(key)),
    log:
      moves.length === 0
        ? before.store.log
        : [{ id: now, at: now, moves, undone: false }, ...before.store.log].slice(0, MAX_LOG),
  };
  const json = yield* encodeStore(store).pipe(Effect.mapError(fail("保存整理记录失败")));
  yield* writeText(path.join(folder, STORE_DIR, STORE_FILE), `${json}\n`);
  yield* carryFeishuRecords(folder, moves);
  const after = yield* buildState(config, paths.defaultFolder);
  yield* persist(folder, after.store, after.state.docs);
  const left = pending.length - moves.length;
  return done(
    after.state,
    moves.length,
    left === 0
      ? null
      : failedBatches > 0
        ? `小模型这次没答上来，${left} 个文件留在“待整理”。`
        : `有 ${left} 个文件小模型没给出可用的名字，留在“待整理”。`,
  );
});

/** Removes `dir` and its parents up to the knowledge folder, stopping at the first that has anything in it. */
const removeEmptyFolders = Effect.fn("VibeBossKnowledge.removeEmptyFolders")(function* (
  folder: string,
  dir: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  let current = dir;
  while (current !== folder && current.startsWith(folder)) {
    const names = yield* fs.readDirectory(current).pipe(Effect.orElseSucceed(() => [""]));
    if (names.some((name) => name !== ".DS_Store")) return;
    yield* fs.remove(current, { recursive: true }).pipe(Effect.ignore);
    current = path.dirname(current);
  }
});

/** Puts every file of one organizer run back where it was, under its old name. */
export const undo = Effect.fn("VibeBossKnowledge.undo")(function* (logId: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const paths = yield* resolvePaths;
  const config = yield* loadConfig(paths.configPath);
  const before = yield* buildState(config, paths.defaultFolder);
  const folder = config.folder;
  const entry = before.store.log.find((item) => item.id === logId);
  if (folder === null || entry === undefined || entry.undone) return before.state;
  const absolute = (relative: string) => path.join(folder, ...relative.split("/"));
  const docs = { ...before.store.docs };
  const held = new Set(before.store.held);
  const restoredMoves: Array<{ from: string; to: string }> = [];
  for (const move of entry.moves.toReversed()) {
    const record = docs[move.to];
    if (record === undefined) continue;
    const taken = yield* fs.exists(absolute(move.from)).pipe(Effect.orElseSucceed(() => true));
    if (taken) continue;
    const restored = yield* fs
      .makeDirectory(path.dirname(absolute(move.from)), { recursive: true })
      .pipe(
        Effect.andThen(fs.rename(absolute(move.to), absolute(move.from))),
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      );
    if (!restored) continue;
    delete docs[move.to];
    held.add(move.from);
    restoredMoves.push({ from: move.to, to: move.from });
    yield* removeEmptyFolders(folder, path.dirname(absolute(move.to)));
  }
  const store: Store = {
    version: 1,
    docs,
    held: [...held],
    log: before.store.log.map((item) => (item.id === logId ? { ...item, undone: true } : item)),
  };
  const json = yield* encodeStore(store).pipe(Effect.mapError(fail("保存整理记录失败")));
  yield* writeText(path.join(folder, STORE_DIR, STORE_FILE), `${json}\n`);
  yield* carryFeishuRecords(folder, restoredMoves);
  const after = yield* buildState(config, paths.defaultFolder);
  yield* persist(folder, after.store, after.state.docs);
  return after.state;
});

/** What the conversation that uploads to Feishu is told, with the files it has to handle. */
function feishuSyncTask(
  folder: string,
  logPath: string,
  rootPath: string,
  pending: ReadonlyArray<VibeBossKnowledgeDoc>,
  tokens: ReadonlyMap<string, string>,
): string {
  return [
    "# 把知识库同步到飞书",
    "",
    `知识库文件夹：${folder}`,
    "",
    "用你手上的飞书工具，逐个处理下面“待同步”清单里的文件：",
    "",
    "- Markdown（.md）：建成飞书文档，标题用文件名（不带扩展名）。",
    "- HTML（.html）：建一篇同名飞书文档，把这个 HTML 文件插入文档；工具做不到插入时，把它作为文件上传。",
    "- 其他格式（PPT、Word、Excel、PDF 等）：作为文件上传到飞书云空间。",
    "- 清单里标了“有更新”的文件上次传过：按它的 token 更新原来那一份，不另建；找不到原件才新建。",
    "- 新文件上传前，先看目标子文件夹里有没有同名文件：有就更新它，不要传出第二份。",
    "- 这是单向同步：本地是唯一的原件，只把本地传到飞书，不改、不删本地文件，也不把飞书上的改动拿回来。",
    "",
    "## 放在哪",
    "",
    `只在一个飞书文件夹里操作，它的链接记在 ${rootPath}：`,
    "",
    "- 这个文件存在：就用里面记的文件夹，不另找、不另建。",
    '- 这个文件不存在：在用户“我的空间”根目录下新建文件夹“VibeBoss 知识库”（已有同名的就用它），权限保持默认的仅自己可见，不要分享给别人；然后把它写进这个文件，内容是一行 JSON：`{"url":"文件夹链接","token":"文件夹 token"}`。',
    "- 在这个文件夹里按文件的“分类/分组”建子文件夹，没有就新建。不要动这个文件夹以外的任何飞书内容。",
    "",
    "## 记录",
    "",
    `每传完一个，立刻往 ${logPath} 追加一行 JSON（不要改已有的行）：`,
    "",
    '`{"path":"清单里的相对路径，一字不差","url":"飞书链接","token":"飞书里这份文件或文档的 token","at":"当前时间，ISO 8601 格式"}`',
    "",
    "某个文件传不上去就跳过，接着传下一个，最后把没传成的列出来并说明原因。中途被打断也没关系，下次只会列出还没同步的。",
    "没有可用的飞书工具时，直接告诉用户需要先装好飞书 MCP，不要用别的办法代替。",
    "",
    `## 待同步（${pending.length} 个）`,
    "",
    ...pending.map((doc) =>
      doc.feishu === "changed"
        ? `- \`${doc.path}\`（有更新，原链接：${doc.feishuUrl ?? "未知"}，token：${tokens.get(doc.path) ?? "未知"}）`
        : `- \`${doc.path}\``,
    ),
    "",
  ].join("\n");
}

/** Writes the task file for the files not yet on Feishu and returns the message that starts the upload. */
export const prepareFeishuSync = Effect.fn("VibeBossKnowledge.prepareFeishuSync")(function* (
  /** The Feishu folder feeds a cloud library, so the agent ends by saying when that updates. */
  feedsCloudLibrary = false,
) {
  const path = yield* Path.Path;
  const paths = yield* resolvePaths;
  const config = yield* loadConfig(paths.configPath);
  const folder = config.folder;
  if (folder === null) return yield* new VibeBossError({ detail: "还没有设置知识库位置。" });
  const { state } = yield* buildState(config, paths.defaultFolder);
  const pending = state.docs.filter((doc) => doc.organized && doc.feishu !== "synced");
  const taskPath = path.join(folder, STORE_DIR, FEISHU_TASK_FILE);
  yield* writeText(
    taskPath,
    feishuSyncTask(
      folder,
      path.join(folder, STORE_DIR, FEISHU_LOG_FILE),
      path.join(folder, STORE_DIR, FEISHU_ROOT_FILE),
      pending,
      new Map(
        [...(yield* loadFeishuRecords(folder)).values()].flatMap((record) =>
          record.token === undefined ? [] : [[record.path, record.token] as const],
        ),
      ),
    ),
  );
  return {
    pending: pending.length,
    prompt: `按 ${taskPath} 里的说明，把知识库里待同步的 ${pending.length} 个文件同步到飞书。${
      feedsCloudLibrary
        ? "同步完最后告诉我一句：云端库会按它自己的周期自动更新，要立即生效可在程小帮控制台重建。"
        : ""
    }`,
  };
});
