// VibeBoss: project memory. Plain Markdown in `<project>/.vibeboss-memory/`, shared by every agent
// on the project. The main agent writes it through a tool and the user through Settings; members
// only read it. Every write is logged with the previous content, so it can be undone for 90 days.
// The log and the backups live in the server's state folder, not in the project.
// @effect-diagnostics nodeBuiltinImport:off - small synchronous hashes and ids.
import * as NodeCrypto from "node:crypto";

import type {
  VibeBossMemoryAuthor,
  VibeBossMemoryFile,
  VibeBossMemoryKind,
  VibeBossMemoryLogEntry,
  VibeBossMemoryState,
} from "@t3tools/contracts";
import { VibeBossError } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";

export const MEMORY_FOLDER = ".vibeboss-memory";
const LEGACY_FOLDER = ".codex-memory";
const MAX_FILE_BYTES = 64 * 1024;
const KEEP_DAYS = 90;
const RECENT = 5;
/** How much of current.md the first prompt of a conversation carries. */
const CURRENT_IN_PROMPT = 4000;

const fail = (detail: string, cause?: unknown) =>
  new VibeBossError({ detail, ...(cause === undefined ? {} : { cause }) });
/** Keeps a VibeBossError's own wording; anything else becomes `detail`. */
const isVibeBossError = Schema.is(VibeBossError);
const failsAs =
  (detail: string) =>
  <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, VibeBossError, R> =>
    Effect.mapError(self, (cause) => (isVibeBossError(cause) ? cause : fail(detail, cause)));

const KIND_TITLES: Record<VibeBossMemoryKind, string> = {
  current: "现状",
  decisions: "决策",
  spec: "项目规范",
  task: "任务",
  archive: "归档",
};

/**
 * The memory file a relative path names, or an error a user or agent can act on. Only
 * `current.md`, `decisions.md`, `tasks/<name>.md` and Markdown under `spec/` and `archive/` exist.
 */
export function classifyPath(input: string): { path: string; kind: VibeBossMemoryKind } | string {
  const parts = input
    .replaceAll("\\", "/")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part !== "" && part !== ".");
  if (parts.length === 0) return "缺少文件路径";
  if (parts.some((part) => part === ".." || part.startsWith("."))) {
    return `路径 ${input} 不能含 .. 或以点开头的部分`;
  }
  const path = parts.join("/");
  if (!path.endsWith(".md")) return `只能写 Markdown 文件（.md）：${input}`;
  if (path === "current.md") return { path, kind: "current" };
  if (path === "decisions.md") return { path, kind: "decisions" };
  if (parts[0] === "spec" && parts.length >= 2) return { path, kind: "spec" };
  if (parts[0] === "tasks" && parts.length === 2) return { path, kind: "task" };
  if (parts[0] === "archive" && parts.length >= 2) return { path, kind: "archive" };
  return `${input} 不在项目记忆里：只能是 current.md、decisions.md、tasks/<名称>.md，或 spec/、archive/ 下的 .md`;
}

const titleOf = (path: string) => path.split("/").at(-1)!.replace(/\.md$/, "");

/** How a change reads in the update log: "现状", "项目规范“界面/文案”". */
function describePath(path: string, kind: VibeBossMemoryKind): string {
  if (kind === "current" || kind === "decisions") return KIND_TITLES[kind];
  const name = path.split("/").slice(1).join("/").replace(/\.md$/, "");
  return `${KIND_TITLES[kind]}“${name}”`;
}

/** Decisions are only added to: an agent's new text must keep every earlier line in order. */
export function keepsEarlierText(before: string, after: string): boolean {
  return after.trimEnd().startsWith(before.trimEnd());
}

const SKELETON: ReadonlyArray<readonly [string, string]> = [
  ["current.md", "# 现状\n\n## 正在做\n\n## 下一步\n"],
  ["decisions.md", "# 决策\n\n"],
];

const LogEntry = Schema.Struct({
  id: Schema.String,
  at: Schema.String,
  author: Schema.Literals(["agent", "user", "system"]),
  summary: Schema.String,
  source: Schema.String,
  /** Each changed file with its content before (null: it did not exist) and a hash after. */
  changes: Schema.Array(
    Schema.Struct({
      path: Schema.String,
      before: Schema.NullOr(Schema.String),
      afterHash: Schema.NullOr(Schema.String),
    }),
  ),
  undone: Schema.Boolean,
});
type LogEntry = typeof LogEntry.Type;
const decodeLine = Schema.decodeUnknownOption(Schema.fromJsonString(LogEntry));
const encodeLine = Schema.encodeSync(Schema.fromJsonString(LogEntry));

const hashOf = (content: string) => NodeCrypto.createHash("sha256").update(content).digest("hex");

const logFile = Effect.fn("VibeBossMemory.logFile")(function* (root: string) {
  const config = yield* ServerConfig.ServerConfig;
  const path = yield* Path.Path;
  const key = NodeCrypto.createHash("sha256").update(root).digest("hex").slice(0, 16);
  return path.join(config.stateDir, "vibeboss", "memory", `${key}.jsonl`);
});

const readLog = Effect.fn("VibeBossMemory.readLog")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const raw = yield* fs.readFileString(yield* logFile(root)).pipe(Effect.orElseSucceed(() => ""));
  const entries: Array<LogEntry> = [];
  for (const line of raw.split("\n")) {
    const entry = decodeLine(line);
    if (Option.isSome(entry)) entries.push(entry.value);
  }
  return entries;
});

const writeLog = Effect.fn("VibeBossMemory.writeLog")(function* (
  root: string,
  entries: ReadonlyArray<LogEntry>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = yield* logFile(root);
  const cutoff = (yield* Clock.currentTimeMillis) - KEEP_DAYS * 24 * 60 * 60 * 1000;
  const kept = entries.filter((entry) => Date.parse(entry.at) >= cutoff);
  yield* fs.makeDirectory(path.dirname(file), { recursive: true });
  yield* fs.writeFileString(file, kept.map((entry) => `${encodeLine(entry)}\n`).join(""));
});

const publicEntry = (entry: LogEntry): VibeBossMemoryLogEntry => ({
  id: entry.id,
  at: entry.at,
  author: entry.author,
  summary: entry.summary,
  source: entry.source,
  paths: entry.changes.map((change) => change.path),
  undone: entry.undone,
});

const folderOf = Effect.fn("VibeBossMemory.folderOf")(function* (root: string) {
  return (yield* Path.Path).join(root, MEMORY_FOLDER);
});

const readOptional = Effect.fn("VibeBossMemory.readOptional")(function* (file: string) {
  const fs = yield* FileSystem.FileSystem;
  return Option.getOrNull(yield* fs.readFileString(file).pipe(Effect.option));
});

const listMarkdown = Effect.fn("VibeBossMemory.listMarkdown")(function* (base: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const found: Array<{ path: string; size: number; modifiedAt: string }> = [];
  const pending = [""];
  while (pending.length > 0) {
    const dir = pending.shift()!;
    const names = yield* fs
      .readDirectory(path.join(base, dir))
      .pipe(Effect.orElseSucceed(() => []));
    for (const name of names.toSorted((a, b) => a.localeCompare(b))) {
      if (name.startsWith(".")) continue;
      const rel = dir === "" ? name : `${dir}/${name}`;
      const info = yield* fs.stat(path.join(base, rel)).pipe(Effect.option);
      if (Option.isNone(info)) continue;
      if (info.value.type === "Directory") pending.push(rel);
      else if (name.endsWith(".md")) {
        found.push({
          path: rel,
          size: Number(info.value.size),
          modifiedAt: Option.match(info.value.mtime, {
            onNone: () => "1970-01-01T00:00:00.000Z",
            onSome: (time) => time.toISOString(),
          }),
        });
      }
    }
  }
  return found.toSorted((a, b) => a.path.localeCompare(b.path));
});

const listFiles = Effect.fn("VibeBossMemory.listFiles")(function* (folder: string) {
  const files: Array<VibeBossMemoryFile> = [];
  for (const entry of yield* listMarkdown(folder)) {
    const known = classifyPath(entry.path);
    if (typeof known === "string") continue;
    files.push({ ...entry, kind: known.kind, title: titleOf(entry.path) });
  }
  return files;
});

/** Writes or deletes files and logs the change with what each held before. */
const applyChange = Effect.fn("VibeBossMemory.applyChange")(function* (
  root: string,
  change: {
    readonly author: VibeBossMemoryAuthor;
    readonly summary: string;
    readonly source: string;
    readonly files: ReadonlyArray<{ readonly path: string; readonly content: string | null }>;
  },
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const folder = yield* folderOf(root);
  const changes: Array<LogEntry["changes"][number]> = [];
  for (const file of change.files) {
    const absolute = path.join(folder, file.path);
    const before = yield* readOptional(absolute);
    if (before === file.content) continue;
    if (file.content === null) {
      yield* fs.remove(absolute).pipe(Effect.ignore);
    } else {
      yield* fs.makeDirectory(path.dirname(absolute), { recursive: true });
      yield* fs.writeFileString(absolute, file.content);
    }
    changes.push({
      path: file.path,
      before,
      afterHash: file.content === null ? null : hashOf(file.content),
    });
  }
  if (changes.length === 0) return null;
  const entry: LogEntry = {
    id: NodeCrypto.randomUUID(),
    at: DateTime.formatIso(yield* DateTime.now),
    author: change.author,
    summary: change.summary,
    source: change.source,
    changes,
    undone: false,
  };
  yield* writeLog(root, [...(yield* readLog(root)), entry]);
  return entry;
});

/**
 * Copies a `.codex-memory/` folder's Markdown into the new layout and leaves the old folder as it
 * is: current.md stays current.md, spec/ stays spec/, each task folder becomes one task file.
 */
export function planLegacyImport(
  files: ReadonlyArray<{ readonly path: string; readonly content: string }>,
): Array<{ path: string; content: string }> {
  const out = new Map<string, string>();
  const tasks = new Map<string, Array<string>>();
  for (const file of files) {
    const parts = file.path.split("/");
    if (file.path === "current.md") out.set("current.md", file.content);
    else if (parts[0] === "spec" && parts.length >= 2) out.set(file.path, file.content);
    else if (parts[0] === "archive" && parts.length >= 2) out.set(file.path, file.content);
    else if (parts[0] === "tasks" && parts[1] === "active" && parts.length >= 4) {
      const section = `## ${titleOf(parts.slice(3).join("/"))}\n\n${file.content.trim()}\n`;
      tasks.set(parts[2]!, [...(tasks.get(parts[2]!) ?? []), section]);
    } else if (parts[0] === "tasks" && parts[1] === "archive" && parts.length >= 4) {
      out.set(`archive/${parts.slice(2).join("/")}`, file.content);
    }
  }
  for (const [name, sections] of tasks) out.set(`tasks/${name}.md`, sections.join("\n"));
  return [...out].map(([path, content]) => ({ path, content }));
}

const readLegacy = Effect.fn("VibeBossMemory.readLegacy")(function* (root: string) {
  const path = yield* Path.Path;
  const base = path.join(root, LEGACY_FOLDER);
  const files: Array<{ path: string; content: string }> = [];
  for (const entry of yield* listMarkdown(base)) {
    const content = yield* readOptional(path.join(base, entry.path));
    if (content !== null) files.push({ path: entry.path, content });
  }
  return files;
});

const isDirectory = Effect.fn("VibeBossMemory.isDirectory")(function* (dir: string) {
  const fs = yield* FileSystem.FileSystem;
  const info = yield* fs.stat(dir).pipe(Effect.option);
  return Option.isSome(info) && info.value.type === "Directory";
});

export const getState = Effect.fn("VibeBossMemory.getState")(function* (root: string | undefined) {
  const path = yield* Path.Path;
  const empty: VibeBossMemoryState = {
    available: false,
    exists: false,
    folder: "",
    legacy: false,
    files: [],
    recent: [],
    logCount: 0,
  };
  if (root === undefined || !(yield* isDirectory(root))) return empty;
  const folder = yield* folderOf(root);
  const exists = yield* isDirectory(folder);
  const log = (yield* readLog(root)).toReversed();
  return {
    available: true,
    exists,
    folder,
    legacy: yield* isDirectory(path.join(root, LEGACY_FOLDER)),
    files: exists ? yield* listFiles(folder) : [],
    recent: log.slice(0, RECENT).map(publicEntry),
    logCount: log.length,
  } satisfies VibeBossMemoryState;
}, failsAs("读取项目记忆失败"));

/**
 * Creates the folder with an empty current.md and decisions.md, copying in a `.codex-memory/`
 * folder when the project has one. Does nothing when the folder is already there.
 */
export const ensure = Effect.fn("VibeBossMemory.ensure")(function* (
  root: string,
  source: string,
  author: VibeBossMemoryAuthor,
) {
  const folder = yield* folderOf(root);
  if (yield* isDirectory(folder)) return false;
  const legacy = planLegacyImport(yield* readLegacy(root));
  const files = new Map<string, string>(SKELETON);
  for (const file of legacy) files.set(file.path, file.content);
  yield* (yield* FileSystem.FileSystem).makeDirectory(folder, { recursive: true });
  yield* applyChange(root, {
    author,
    summary: legacy.length > 0 ? "建立项目记忆，照搬 Codex 旧记忆" : "建立项目记忆",
    source,
    files: [...files].map(([path, content]) => ({ path, content })),
  });
  return true;
}, failsAs("建立项目记忆失败"));

export const readFile = Effect.fn("VibeBossMemory.readFile")(function* (
  root: string,
  input: string,
) {
  const known = classifyPath(input);
  if (typeof known === "string") return yield* fail(known);
  const content = yield* readOptional((yield* Path.Path).join(yield* folderOf(root), known.path));
  if (content === null) return yield* fail(`没有这份文件：${known.path}`);
  return { path: known.path, content };
}, failsAs("读取项目记忆失败"));

export const writeFile = Effect.fn("VibeBossMemory.writeFile")(function* (
  root: string,
  input: { readonly path: string; readonly content: string },
  by: { readonly author: VibeBossMemoryAuthor; readonly source: string },
) {
  const known = classifyPath(input.path);
  if (typeof known === "string") return yield* fail(known);
  if (Buffer.byteLength(input.content) > MAX_FILE_BYTES) {
    return yield* fail(`${known.path} 超过 64KB，请拆成几份或把过期内容移到归档`);
  }
  if (!(yield* isDirectory(yield* folderOf(root)))) yield* ensure(root, by.source, "system");
  const absolute = (yield* Path.Path).join(yield* folderOf(root), known.path);
  const before = yield* readOptional(absolute);
  if (
    by.author === "agent" &&
    known.kind === "decisions" &&
    before !== null &&
    !keepsEarlierText(before, input.content)
  ) {
    return yield* fail("决策只能往后追加：保留原有全文，把新决策加在末尾");
  }
  const created = before === null && known.kind !== "current" && known.kind !== "decisions";
  const entry = yield* applyChange(root, {
    ...by,
    summary: `${created ? "新建" : ""}${describePath(known.path, known.kind)}`,
    files: [{ path: known.path, content: input.content }],
  });
  return { path: known.path, logId: entry?.id ?? null };
}, failsAs("保存项目记忆失败"));

/** Moves a finished task to the archive, numbering the name when it is taken. */
export const archiveTask = Effect.fn("VibeBossMemory.archiveTask")(function* (
  root: string,
  input: string,
  by: { readonly author: VibeBossMemoryAuthor; readonly source: string },
) {
  const known = classifyPath(input);
  if (typeof known === "string") return yield* fail(known);
  if (known.kind !== "task") return yield* fail("只有任务能归档");
  const path = yield* Path.Path;
  const folder = yield* folderOf(root);
  const content = yield* readOptional(path.join(folder, known.path));
  if (content === null) return yield* fail(`没有这份文件：${known.path}`);
  const name = titleOf(known.path);
  let target = `archive/${name}.md`;
  for (let n = 2; (yield* readOptional(path.join(folder, target))) !== null; n += 1) {
    target = `archive/${name}-${n}.md`;
  }
  yield* applyChange(root, {
    ...by,
    summary: `归档任务“${name}”`,
    files: [
      { path: target, content },
      { path: known.path, content: null },
    ],
  });
  return { path: target };
}, failsAs("归档任务失败"));

/**
 * Puts back what one change replaced. Refused when a file changed again afterwards, so an undo
 * never throws away a later edit.
 */
export const undo = Effect.fn("VibeBossMemory.undo")(function* (root: string, logId: string) {
  const path = yield* Path.Path;
  const folder = yield* folderOf(root);
  const log = yield* readLog(root);
  const entry = log.find((candidate) => candidate.id === logId);
  if (entry === undefined) return yield* fail("找不到这条更新记录");
  if (entry.undone) return yield* fail("这条更新已经撤销过了");
  for (const change of entry.changes) {
    const now = yield* readOptional(path.join(folder, change.path));
    if ((now === null ? null : hashOf(now)) !== change.afterHash) {
      return yield* fail(`${change.path} 之后又改过，不能单独撤销这一条`);
    }
  }
  const fs = yield* FileSystem.FileSystem;
  for (const change of entry.changes) {
    const absolute = path.join(folder, change.path);
    if (change.before === null) yield* fs.remove(absolute).pipe(Effect.ignore);
    else {
      yield* fs.makeDirectory(path.dirname(absolute), { recursive: true });
      yield* fs.writeFileString(absolute, change.before);
    }
  }
  yield* writeLog(
    root,
    log.map((candidate) => (candidate.id === logId ? { ...candidate, undone: true } : candidate)),
  );
}, failsAs("撤销失败"));

export const getLog = Effect.fn("VibeBossMemory.getLog")(function* (root: string | undefined) {
  if (root === undefined) return { entries: [] };
  return { entries: (yield* readLog(root)).toReversed().map(publicEntry) };
}, failsAs("读取更新记录失败"));

export type MemoryRole = "main" | "member";

/** The note a conversation's prompt carries; pure so the wording can be tested. */
export function memoryNote(input: {
  readonly folder: string;
  readonly role: MemoryRole;
  /** The first prompt of a conversation carries the file list and the current state. */
  readonly full: boolean;
  readonly files: ReadonlyArray<string>;
  readonly current: string | null;
  readonly justCreated: boolean;
}): string {
  const layout =
    "current.md（现状）、decisions.md（决策）、spec/（项目规范，可分文件夹）、tasks/（进行中的任务）、archive/（归档）";
  const lines = [
    "<project_memory>",
    `这个项目的记忆在 ${input.folder}，所有智能体共用：${layout}。`,
  ];
  if (input.full) {
    if (input.files.length > 0) lines.push(`现有文件：${input.files.join("、")}`);
    const current = input.current?.trim() ?? "";
    if (current !== "") {
      lines.push(
        "现状（current.md）：",
        current.length > CURRENT_IN_PROMPT
          ? `${current.slice(0, CURRENT_IN_PROMPT)}\n……（太长，余下的直接读文件）`
          : current,
      );
    }
    lines.push("动手前按需读和任务相关的项目规范、任务文件；上面已给出的不用再读。");
  }
  if (input.role === "member") {
    lines.push(
      "你是被派活的成员：项目记忆只读，不要修改。值得记下的结论写进交回结果，由主控决定是否并入。",
    );
  } else {
    if (input.justCreated) {
      lines.push(
        "项目记忆刚建好，现状还是空的：弄清这次要做什么后，先用 project_memory_write 写好 current.md。",
      );
    }
    lines.push(
      input.full
        ? [
            "你是主控，负责维护项目记忆，只用 project_memory_write 写（不要直接改文件，用户要能看到记录并撤销），任务做完用 project_memory_archive 归档。这些时候要写：",
            "- 进度或下一步变了：改 current.md，只留当前有效的，过期进度删掉或移到归档。",
            "- 用户确认了以后要照做的决定：追加进 decisions.md，带日期，不删旧的。",
            "- 定下了项目长期要守的规则，或踩到值得记的坑：写进 spec/ 下合适的文件。",
            "- 开始、完成或改了范围的跨会话任务：tasks/<名称>.md。",
            "- 成员交回的结论：你判断后再并入。",
            "不记：闲聊、没确认的想法、能从代码或 git 直接看出来的内容、密钥。",
          ].join("\n")
        : "你是主控：进度、用户确认的决定、长期规则或任务有变化时，用 project_memory_write 更新项目记忆。",
    );
  }
  lines.push("</project_memory>");
  return lines.join("\n");
}

/**
 * The note for one prompt, creating the memory on a project's first main conversation. Empty when
 * the project folder is unreachable, or for a member when the project has no memory yet.
 */
export const promptNote = Effect.fn("VibeBossMemory.promptNote")(
  function* (input: {
    readonly root: string | undefined;
    readonly role: MemoryRole;
    readonly full: boolean;
    readonly source: string;
  }) {
    // Without an absolute state folder (some tests) the update log would land in the cwd.
    const { stateDir } = yield* ServerConfig.ServerConfig;
    if (!(yield* Path.Path).isAbsolute(stateDir)) return "";
    if (input.root === undefined || !(yield* isDirectory(input.root))) return "";
    const folder = yield* folderOf(input.root);
    let justCreated = false;
    if (!(yield* isDirectory(folder))) {
      if (input.role === "member") return "";
      justCreated = yield* ensure(input.root, input.source, "system");
    }
    const full = input.full || justCreated;
    const files = full ? (yield* listFiles(folder)).map((file) => file.path) : [];
    const current = full
      ? yield* readOptional((yield* Path.Path).join(folder, "current.md"))
      : null;
    const emptyCurrent = (current ?? "").replace(/^#.*$/gm, "").trim() === "";
    return memoryNote({
      folder,
      role: input.role,
      full,
      files,
      current: emptyCurrent ? null : current,
      justCreated: justCreated && emptyCurrent,
    });
  },
  Effect.orElseSucceed(() => ""),
);
