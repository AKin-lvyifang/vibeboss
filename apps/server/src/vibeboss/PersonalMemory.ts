// VibeBoss: personal memory. One text about the user and how they like to work, written first into
// every agent's rule file (the config's `sharedRules`). The main agent adds to it with a tool,
// a model builds it from past conversations and tidies it once a day, and every change is logged
// so the user can see who wrote what. There is no undo: the user corrects it by talking or editing.
// @effect-diagnostics nodeBuiltinImport:off - ids for log entries.
import * as NodeCrypto from "node:crypto";

import {
  type ServerProvider,
  type VibeBossConfig,
  VibeBossError,
  type VibeBossPersonalMemoryLogEntry,
  VibeBossPersonalMemoryLogEntry as LogEntrySchema,
  type VibeBossPersonalMemoryRun,
  type VibeBossPersonalMemoryRunMode,
  type VibeBossPersonalMemoryState,
  type VibeBossState,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import type * as SqlClient from "effect/sql/SqlClient";

import * as ServerConfig from "../config.ts";
import * as VibeBoss from "./VibeBoss.ts";

const SOFT_LIMIT = 6000;
const HARD_LIMIT = 16000;
const LOG_KEEP = 500;
const LOG_SHOWN = 100;
const BATCH_CHARS = 30000;
const MESSAGE_CHARS = 1200;
/** Longer messages are pasted documents or logs, not the user talking. */
const MESSAGE_SKIP_OVER = 6000;
const NATIVE_FILE_CHARS = 4000;
const NATIVE_TOTAL_CHARS = 30000;
const KEPT_SIMILARITY = 0.6;
const TIDY_HOURS = 24;
const TIDY_MIN_CONVERSATIONS = 3;

export type Ask = (prompt: string) => Effect.Effect<string, VibeBossError>;
type Author = VibeBossPersonalMemoryLogEntry["author"];

const fail = (detail: string) => (cause: unknown) => new VibeBossError({ detail, cause });

const isContent = (line: string) => line.trim() !== "";
const normalize = (line: string) =>
  line
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
    .replace(/\s+/g, "")
    .toLowerCase();

/** Lines that appeared and disappeared, ignoring blank lines and order. */
export function diffLines(
  before: string,
  after: string,
): { added: Array<string>; removed: Array<string> } {
  const old = before.split("\n").filter(isContent);
  const next = after.split("\n").filter(isContent);
  const oldSet = new Set(old.map((line) => line.trim()));
  const nextSet = new Set(next.map((line) => line.trim()));
  return {
    added: next.map((line) => line.trim()).filter((line) => !oldSet.has(line)),
    removed: old.map((line) => line.trim()).filter((line) => !nextSet.has(line)),
  };
}

function bigrams(text: string): Map<string, number> {
  const grams = new Map<string, number>();
  for (let i = 0; i < text.length - 1; i += 1) {
    const gram = text.slice(i, i + 2);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  return grams;
}

/** Dice coefficient over character pairs: 1 for the same text, near 0 for unrelated text. */
function similarity(left: string, right: string): number {
  if (left === right) return 1;
  if (left.length < 2 || right.length < 2) return 0;
  const a = bigrams(left);
  const b = bigrams(right);
  let shared = 0;
  for (const [gram, count] of a) shared += Math.min(count, b.get(gram) ?? 0);
  return (2 * shared) / (left.length - 1 + right.length - 1);
}

const bullet = (line: string) => {
  const text = line.trim();
  return /^(?:[-*+]|\d+[.)])\s/.test(text) ? text : `- ${text}`;
};

export interface UpdateInput {
  readonly section?: string | undefined;
  readonly add?: ReadonlyArray<string> | undefined;
  readonly remove?: ReadonlyArray<string> | undefined;
}

/**
 * Applies an agent's edit: removed lines must exist; added lines go under `section` (a level-2
 * heading, created at the end when missing), or at the end. Returns the new text or why not.
 */
export function applyUpdate(text: string, input: UpdateInput): string {
  const add = (input.add ?? []).map((line) => line.trim()).filter((line) => line !== "");
  const remove = (input.remove ?? []).map((line) => line.trim()).filter((line) => line !== "");
  if (add.length === 0 && remove.length === 0) throw new Error("Nothing to add or remove.");
  let lines = text.split("\n");
  const missing: Array<string> = [];
  for (const target of remove) {
    const wanted = normalize(target);
    const index = lines.findIndex((line) => isContent(line) && normalize(line) === wanted);
    if (index < 0) missing.push(target);
    else lines.splice(index, 1);
  }
  if (missing.length > 0) {
    throw new Error(
      `These lines are not in personal memory, so nothing was changed: ${missing.join(" | ")}`,
    );
  }
  const existing = new Set(lines.filter(isContent).map(normalize));
  const fresh = add.map(bullet).filter((line) => !existing.has(normalize(line)));
  if (fresh.length > 0) {
    const heading = input.section?.trim().replace(/^#+\s*/, "") ?? "";
    if (heading === "") {
      lines = [...trimEnd(lines), ...fresh];
    } else {
      const at = lines.findIndex(
        (line) => /^##\s/.test(line) && line.replace(/^#+\s*/, "").trim() === heading,
      );
      if (at < 0) {
        lines = [
          ...trimEnd(lines),
          ...(lines.some(isContent) ? [""] : []),
          `## ${heading}`,
          ...fresh,
        ];
      } else {
        let end = at + 1;
        while (end < lines.length && !/^#{1,2}\s/.test(lines[end] ?? "")) end += 1;
        while (end > at + 1 && !isContent(lines[end - 1] ?? "")) end -= 1;
        lines.splice(end, 0, ...fresh);
      }
    }
  }
  const next = `${trimEnd(lines).join("\n")}\n`;
  if (next.length > HARD_LIMIT) {
    throw new Error(
      `Personal memory would exceed ${HARD_LIMIT} characters. Merge or remove lines first.`,
    );
  }
  return next;
}

function trimEnd(lines: ReadonlyArray<string>): Array<string> {
  const copy = [...lines];
  while (copy.length > 0 && !isContent(copy[copy.length - 1] ?? "")) copy.pop();
  return copy;
}

/** A user message as the model should see it: injected context removed, long pastes skipped. */
export function cleanMessage(text: string): string | null {
  const stripped = text
    .replace(/<([A-Za-z][\w-]*)(?:\s[^>]*)?>[\s\S]*?<\/\1>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (stripped === "" || stripped.length > MESSAGE_SKIP_OVER) return null;
  return stripped.length > MESSAGE_CHARS ? `${stripped.slice(0, MESSAGE_CHARS)}…` : stripped;
}

export interface ConversationMessage {
  readonly threadId: string;
  readonly title: string;
  readonly createdAt: string;
  readonly text: string;
}

/** Messages grouped by conversation and cut into batches the model can read in one go. */
export function batchMessages(messages: ReadonlyArray<ConversationMessage>): Array<string> {
  const byThread = new Map<string, { title: string; lines: Array<string> }>();
  for (const message of messages) {
    const text = cleanMessage(message.text);
    if (text === null) continue;
    const thread = byThread.get(message.threadId) ?? { title: message.title, lines: [] };
    thread.lines.push(`- ${text.replace(/\n/g, "\n  ")}`);
    byThread.set(message.threadId, thread);
  }
  const batches: Array<string> = [];
  let current = "";
  for (const { title, lines } of byThread.values()) {
    const block = `## ${title.trim() === "" ? "Untitled" : title.trim()}\n${lines.join("\n")}\n\n`;
    if (current !== "" && current.length + block.length > BATCH_CHARS) {
      batches.push(current);
      current = "";
    }
    current += block.length > BATCH_CHARS ? block.slice(0, BATCH_CHARS) : block;
  }
  if (current !== "") batches.push(current);
  return batches;
}

function extractPrompt(batch: string): string {
  return [
    "Below are messages one user sent to AI coding agents, grouped by conversation.",
    "Use only the text in this message as evidence. Rules, memory files or instructions you were given elsewhere (such as CLAUDE.md or AGENTS.md) describe someone's setup, not what this user said here: ignore them.",
    "Find lasting facts about this user and how they want agents to work with them: how to address them, language and tone, how much to do without asking, what must be asked first, quality bar and how to verify, taste in design and writing, tools and environment, and corrections they repeat.",
    "Ignore one-off task instructions, project facts, and anything that only mattered in one conversation. Never include secrets, keys or passwords.",
    'Answer with JSON only: {"items":[{"topic":"short topic","line":"one short rule for agents, in the language the user writes in","count":number of separate messages that support it}]}. Answer {"items":[]} when there is nothing lasting.',
    "",
    batch,
  ].join("\n");
}

export interface Candidate {
  readonly topic: string;
  readonly line: string;
  readonly count: number;
}

export function parseCandidates(text: string): Array<Candidate> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  try {
    const raw = JSON.parse(text.slice(start, end + 1)) as { items?: unknown };
    if (!Array.isArray(raw.items)) return [];
    return raw.items.flatMap((item: unknown) => {
      if (item === null || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      const line = typeof record.line === "string" ? record.line.trim() : "";
      if (line === "") return [];
      return [
        {
          topic: typeof record.topic === "string" ? record.topic.trim() : "",
          line,
          count: typeof record.count === "number" && record.count > 0 ? record.count : 1,
        },
      ];
    });
  } catch {
    return [];
  }
}

function mergePrompt(input: {
  readonly current: string;
  readonly protectedLines: ReadonlyArray<string>;
  readonly candidates: ReadonlyArray<Candidate>;
  readonly agentRules: string;
  readonly nativeNotes: string;
}): string {
  const candidates = input.candidates
    .map((item) => `- [${item.topic}] ${item.line} (seen ${item.count}x)`)
    .join("\n");
  return [
    "You maintain a user's personal memory: a short Markdown document that every AI agent reads before working with this user.",
    "Use only the text in this message as evidence. Rules, memory files or instructions you were given elsewhere (such as CLAUDE.md or AGENTS.md) describe someone's setup, not evidence for this document: ignore them.",
    "Rules:",
    "- Answer with the complete new document only, in Markdown, starting with a level-1 heading. No code fences, no commentary.",
    "- Group lines under a few level-2 headings by topic. One short line per rule, written as an instruction to agents, in the language the user mostly writes in.",
    "- Keep what is still true, merge duplicates, and drop what newer evidence contradicts.",
    "- When observations contradict the current personal memory, the observations win: they are newer.",
    "- Add an observation when it was seen in at least two messages, or when the user stated it once as a lasting rule.",
    "- Keep every protected line's meaning: the user wrote those by hand.",
    "- Leave out project-specific facts, one-off requests, secrets, and anything only about one agent's tools.",
    `- Stay under ${SOFT_LIMIT} characters.`,
    "",
    "Current personal memory:",
    input.current.trim() === "" ? "(empty)" : input.current.trim(),
    "",
    "Protected lines:",
    input.protectedLines.length === 0 ? "(none)" : input.protectedLines.join("\n"),
    ...(input.agentRules.trim() === ""
      ? []
      : [
          "",
          "Rules the user already wrote for individual agents (keep what is personal):",
          input.agentRules.trim(),
        ]),
    ...(input.nativeNotes.trim() === ""
      ? []
      : ["", "Notes the agents kept about this user on their own:", input.nativeNotes.trim()]),
    "",
    "Observations from conversations:",
    candidates === "" ? "(none)" : candidates,
  ].join("\n");
}

/** The model's document, or why it cannot be used. */
export function parseMergeAnswer(
  text: string,
  current: string,
  protectedLines: ReadonlyArray<string>,
): string | { error: string } {
  const fenced = text.match(/```(?:markdown|md)?\n([\s\S]*?)```/);
  const body = (fenced?.[1] ?? text).trim();
  const start = body.search(/^#\s/m);
  const doc = start < 0 ? body : body.slice(start);
  if (doc.split("\n").filter((line) => /^\s*[-*+]\s/.test(line)).length === 0) {
    return { error: "模型没有给出可用的个人记忆" };
  }
  if (doc.length > HARD_LIMIT) return { error: "模型给出的个人记忆太长" };
  if (current.trim().length > 400 && doc.length < current.trim().length * 0.3) {
    return { error: "整理结果比原来短太多，没有写入" };
  }
  const kept = doc
    .split("\n")
    .map(normalize)
    .filter((line) => line !== "");
  const lost = protectedLines.filter((line) => {
    const target = normalize(line);
    return !kept.some((candidate) => similarity(target, candidate) >= KEPT_SIMILARITY);
  });
  if (lost.length > 0)
    return { error: `整理结果丢了你手写的内容：${lost.slice(0, 2).join(" / ")}` };
  return `${doc.trim()}\n`;
}

const Meta = Schema.Struct({
  lastTidyAt: Schema.optional(Schema.String),
  /** created_at of the newest user message a generate or tidy has read. */
  watermark: Schema.optional(Schema.String),
});
type Meta = typeof Meta.Type;
const decodeMeta = Schema.decodeUnknownOption(Schema.fromJsonString(Meta));
const encodeMeta = Schema.encodeSync(Schema.fromJsonString(Meta));
const decodeEntry = Schema.decodeUnknownOption(Schema.fromJsonString(LogEntrySchema));
const encodeEntry = Schema.encodeSync(Schema.fromJsonString(LogEntrySchema));
const isVibeBossError = Schema.is(VibeBossError);

const files = Effect.gen(function* () {
  const { stateDir } = yield* ServerConfig.ServerConfig;
  const path = yield* Path.Path;
  const dir = path.join(stateDir, "vibeboss");
  return {
    dir,
    log: path.join(dir, "personal-memory.jsonl"),
    meta: path.join(dir, "personal-memory.meta.json"),
  };
});

const readText = Effect.fn("PersonalMemory.readText")(function* (file: string) {
  const fs = yield* FileSystem.FileSystem;
  if (!(yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false)))) return "";
  return yield* fs.readFileString(file).pipe(Effect.orElseSucceed(() => ""));
});

const writeText = Effect.fn("PersonalMemory.writeText")(function* (file: string, text: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs
    .makeDirectory(path.dirname(file), { recursive: true })
    .pipe(
      Effect.andThen(fs.writeFileString(file, text)),
      Effect.mapError(fail("保存个人记忆记录失败")),
    );
});

const readMeta = Effect.fn("PersonalMemory.readMeta")(function* () {
  const raw = yield* readText((yield* files).meta);
  const decoded = decodeMeta(raw);
  return decoded._tag === "Some" ? decoded.value : ({} as Meta);
});

const writeMeta = Effect.fn("PersonalMemory.writeMeta")(function* (meta: Meta) {
  yield* writeText((yield* files).meta, `${encodeMeta(meta)}\n`);
});

/** Log entries, newest first. */
const readLog = Effect.fn("PersonalMemory.readLog")(function* () {
  const raw = yield* readText((yield* files).log);
  return raw
    .split("\n")
    .filter((line) => line.trim() !== "")
    .flatMap((line) => {
      const decoded = decodeEntry(line);
      return decoded._tag === "Some" ? [decoded.value] : [];
    })
    .reverse();
});

const appendLog = Effect.fn("PersonalMemory.appendLog")(function* (
  entry: VibeBossPersonalMemoryLogEntry,
) {
  const entries = [entry, ...(yield* readLog())].slice(0, LOG_KEEP).reverse();
  yield* writeText((yield* files).log, `${entries.map((item) => encodeEntry(item)).join("\n")}\n`);
});

export interface Change {
  readonly author: Author;
  readonly source: string;
  readonly threadId?: string | undefined;
  readonly conversations?: number | undefined;
}

const logChange = Effect.fn("PersonalMemory.logChange")(function* (
  before: string,
  after: string,
  change: Change,
) {
  const { added, removed } = diffLines(before, after);
  if (added.length === 0 && removed.length === 0) return;
  yield* appendLog({
    id: NodeCrypto.randomUUID(),
    at: DateTime.formatIso(yield* DateTime.now),
    author: change.author,
    source: change.source,
    ...(change.threadId === undefined ? {} : { threadId: change.threadId }),
    ...(change.conversations === undefined ? {} : { conversations: change.conversations }),
    added,
    removed,
  });
});

/** Writes new personal memory for an agent, tidy or generate, then syncs every rule file. */
const commit = Effect.fn("PersonalMemory.commit")(function* (
  text: string,
  change: Change,
  providers: ReadonlyArray<ServerProvider>,
) {
  const config = yield* VibeBoss.readConfig();
  const before = config.sharedRules ?? "";
  if (before.trim() === text.trim()) return;
  yield* VibeBoss.saveConfig({ ...config, sharedRules: text }, providers);
  yield* VibeBoss.syncRules(providers);
  yield* logChange(before, text, change);
});

/** The Rules page's save: logs a hand edit of personal memory as the user's. */
export const saveUserConfig = Effect.fn("PersonalMemory.saveUserConfig")(function* (
  config: VibeBossConfig,
  providers: ReadonlyArray<ServerProvider>,
) {
  const before = (yield* VibeBoss.readConfig()).sharedRules ?? "";
  const state: VibeBossState = yield* VibeBoss.saveConfig(config, providers);
  yield* logChange(before, config.sharedRules ?? "", { author: "user", source: "" });
  return state;
});

/** An agent's edit through the tool; fails with a message the agent can act on. */
export const update = Effect.fn("PersonalMemory.update")(function* (
  input: UpdateInput,
  change: Change,
  providers: ReadonlyArray<ServerProvider>,
) {
  const before = (yield* VibeBoss.readConfig()).sharedRules ?? "";
  const next = yield* Effect.try({
    try: () => applyUpdate(before, input),
    catch: (cause) =>
      new VibeBossError({ detail: cause instanceof Error ? cause.message : String(cause) }),
  });
  yield* commit(next, change, providers);
  return { characters: next.length };
});

// One run at a time for the whole server; the page reads its progress.
let running: VibeBossPersonalMemoryRun | null = null;
let lastError: string | null = null;

export const getState = Effect.fn("PersonalMemory.getState")(function* () {
  const state: VibeBossPersonalMemoryState = {
    log: (yield* readLog()).slice(0, LOG_SHOWN),
    lastTidyAt: (yield* readMeta()).lastTidyAt ?? null,
    running,
    lastError,
  };
  return state;
});

interface MessageRow {
  readonly threadId: string;
  readonly title: string | null;
  readonly createdAt: string;
  readonly text: string | null;
}

/** The user's own messages in every conversation, oldest first; only newer ones when `since`. */
const readMessages = (sql: SqlClient.SqlClient, since: string | undefined) =>
  (since === undefined
    ? sql<MessageRow>`
        SELECT m.thread_id AS threadId, t.title AS title, m.created_at AS createdAt,
          json_extract(m.payload_json, '$.text') AS text
        FROM orchestration_v2_projection_messages AS m
        JOIN orchestration_v2_projection_threads AS t ON t.thread_id = m.thread_id
        WHERE m.role = 'user' AND json_extract(m.payload_json, '$.createdBy') = 'user'
          AND t.deleted_at IS NULL
        ORDER BY m.created_at`
    : sql<MessageRow>`
        SELECT m.thread_id AS threadId, t.title AS title, m.created_at AS createdAt,
          json_extract(m.payload_json, '$.text') AS text
        FROM orchestration_v2_projection_messages AS m
        JOIN orchestration_v2_projection_threads AS t ON t.thread_id = m.thread_id
        WHERE m.role = 'user' AND json_extract(m.payload_json, '$.createdBy') = 'user'
          AND t.deleted_at IS NULL AND m.created_at > ${since}
        ORDER BY m.created_at`
  ).pipe(
    Effect.map((rows) =>
      rows.flatMap((row): Array<ConversationMessage> =>
        typeof row.text === "string"
          ? [
              {
                threadId: row.threadId,
                title: row.title ?? "",
                createdAt: row.createdAt,
                text: row.text,
              },
            ]
          : [],
      ),
    ),
    Effect.mapError(fail("读取历史对话失败")),
  );

/** Conversations with new messages from the user since the last run, for the daily tidy. */
const newConversationCount = Effect.fn("PersonalMemory.newConversationCount")(function* (
  sql: SqlClient.SqlClient,
) {
  const meta = yield* readMeta();
  const messages = yield* readMessages(sql, meta.watermark);
  return new Set(
    messages.filter((item) => cleanMessage(item.text) !== null).map((item) => item.threadId),
  ).size;
});

/** Notes Claude Code and Codex keep about the user on their own, read only for a generate. */
const readNativeNotes = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const homes = yield* VibeBoss.agentHomes.pipe(Effect.orElseSucceed(() => null));
  if (homes === null) return "";
  const list = (dir: string) =>
    fs.readDirectory(dir).pipe(Effect.orElseSucceed((): Array<string> => []));
  const candidates: Array<string> = [];
  const claudeProjects = path.join(homes.claude, "projects");
  for (const project of yield* list(claudeProjects)) {
    const dir = path.join(claudeProjects, project, "memory");
    for (const name of yield* list(dir)) {
      if (name.endsWith(".md") && name !== "MEMORY.md") candidates.push(path.join(dir, name));
    }
  }
  const codexDir = path.join(homes.codex, "memories");
  for (const name of yield* list(codexDir)) {
    if (name.endsWith(".md")) candidates.push(path.join(codexDir, name));
  }
  let total = 0;
  const parts: Array<string> = [];
  for (const file of candidates) {
    if (total >= NATIVE_TOTAL_CHARS) break;
    const text = (yield* readText(file)).trim().slice(0, NATIVE_FILE_CHARS);
    if (text === "") continue;
    parts.push(text);
    total += text.length;
  }
  return parts.join("\n\n---\n\n");
});

/** Lines the user typed by hand since the last tidy; the model must keep their meaning. */
const protectedLines = Effect.gen(function* () {
  const meta = yield* readMeta();
  const since = meta.lastTidyAt ?? "";
  const current = new Set(
    ((yield* VibeBoss.readConfig()).sharedRules ?? "").split("\n").map((line) => line.trim()),
  );
  return [
    ...new Set(
      (yield* readLog())
        .filter((entry) => entry.author === "user" && entry.at > since)
        .flatMap((entry) => entry.added)
        .filter((line) => current.has(line) && !line.startsWith("#")),
    ),
  ];
});

export interface RunDeps {
  readonly ask: Ask;
  readonly modelLabel: string;
  readonly sql: SqlClient.SqlClient;
  readonly providers: Effect.Effect<ReadonlyArray<ServerProvider>>;
}

const runOnce = Effect.fn("PersonalMemory.runOnce")(function* (
  mode: VibeBossPersonalMemoryRunMode,
  deps: RunDeps,
  startedAt: string,
) {
  const meta = yield* readMeta();
  const messages = yield* readMessages(deps.sql, mode === "generate" ? undefined : meta.watermark);
  const batches = batchMessages(messages);
  const conversations = new Set(
    messages.filter((item) => cleanMessage(item.text) !== null).map((item) => item.threadId),
  ).size;
  running = { mode, phase: "reading", done: 0, total: batches.length, conversations, startedAt };
  const candidates: Array<Candidate> = [];
  for (const batch of batches) {
    const answer = yield* deps.ask(extractPrompt(batch));
    candidates.push(...parseCandidates(answer));
    if (running !== null) running = { ...running, done: running.done + 1 };
  }
  if (running !== null) running = { ...running, phase: "merging" };
  const config = yield* VibeBoss.readConfig();
  const current = config.sharedRules ?? "";
  if (mode === "tidy" && candidates.length === 0 && current.trim() === "") {
    return yield* new VibeBossError({ detail: "没有可以整理的内容" });
  }
  const keep = yield* protectedLines;
  const agentRules =
    mode === "generate"
      ? Object.values(config.perAgent)
          .map((text) => text.trim())
          .filter((text) => text !== "")
          .join("\n\n---\n\n")
      : "";
  const nativeNotes = mode === "generate" ? yield* readNativeNotes : "";
  const answer = yield* deps.ask(
    mergePrompt({ current, protectedLines: keep, candidates, agentRules, nativeNotes }),
  );
  const doc = parseMergeAnswer(answer, current, keep);
  const newest = messages.at(-1)?.createdAt ?? meta.watermark;
  yield* writeMeta({
    lastTidyAt: DateTime.formatIso(yield* DateTime.now),
    ...(newest === undefined ? {} : { watermark: newest }),
  });
  if (typeof doc !== "string") return yield* new VibeBossError({ detail: doc.error });
  yield* commit(
    doc,
    { author: mode, source: deps.modelLabel, conversations },
    yield* deps.providers,
  );
});

/** Starts a generate or tidy in the background; fails when one is already running. */
export const start = Effect.fn("PersonalMemory.start")(function* (
  mode: VibeBossPersonalMemoryRunMode,
  deps: RunDeps,
) {
  if (running !== null) return yield* new VibeBossError({ detail: "个人记忆正在整理中" });
  const startedAt = DateTime.formatIso(yield* DateTime.now);
  running = { mode, phase: "reading", done: 0, total: 0, conversations: 0, startedAt };
  lastError = null;
  const context = yield* Effect.context<
    FileSystem.FileSystem | Path.Path | ServerConfig.ServerConfig
  >();
  yield* runOnce(mode, deps, startedAt).pipe(
    Effect.catchCause((cause) =>
      Effect.sync(() => {
        const error = cause.reasons.find((reason) => reason._tag === "Fail");
        lastError =
          error !== undefined && error._tag === "Fail" && isVibeBossError(error.error)
            ? error.error.detail
            : "整理失败";
      }).pipe(Effect.andThen(Effect.logWarning("personal memory run failed", { mode, cause }))),
    ),
    Effect.ensuring(Effect.sync(() => (running = null))),
    Effect.provideContext(context),
    Effect.forkDetach,
  );
  return yield* getState();
});

/** Whether the daily tidy should run now. */
export const tidyDue = Effect.fn("PersonalMemory.tidyDue")(function* (sql: SqlClient.SqlClient) {
  if (running !== null) return false;
  const config = yield* VibeBoss.readConfig();
  if (config.memoryAutoTidy !== true || config.memoryApi === undefined) return false;
  if ((config.sharedRules ?? "").trim() === "") return false;
  const meta = yield* readMeta();
  if (meta.lastTidyAt !== undefined) {
    const now = DateTime.toEpochMillis(yield* DateTime.now);
    const hours = (now - Date.parse(meta.lastTidyAt)) / 3_600_000;
    if (hours < TIDY_HOURS) return false;
  }
  return (yield* newConversationCount(sql)) >= TIDY_MIN_CONVERSATIONS;
});
