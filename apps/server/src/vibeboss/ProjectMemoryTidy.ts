// VibeBoss: tidying project memory, in the spirit of Claude's "dream". A small model rewrites
// current.md to what still holds and names finished tasks. It never touches decisions or project
// specs, and what leaves current.md is appended to the archive rather than dropped. The whole
// tidy is one logged change, so it can be undone like any other.
import { VibeBossError } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ProjectMemory from "./ProjectMemory.ts";

const SESSIONS_BETWEEN = 5;
const HOURS_BETWEEN = 24;
const TASK_EXCERPT = 2000;
/** A line that left current.md must reappear this closely in what the model kept or moved. */
const KEPT_SIMILARITY = 0.6;
const EXPIRED_FILE = "archive/过期进度.md";
const LOCAL_DAY = new Intl.DateTimeFormat("sv-SE", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const isVibeBossError = Schema.is(VibeBossError);

export type Ask = (prompt: string) => Effect.Effect<string, VibeBossError>;

interface TidyInput {
  readonly today: string;
  readonly current: string;
  readonly tasks: ReadonlyArray<{ readonly name: string; readonly content: string }>;
}

function tidyPrompt(input: TidyInput): string {
  return [
    `你在整理一个软件项目的项目记忆。今天是 ${input.today}。`,
    "规则：",
    "- current.md 只留当前仍有效的内容：正在做什么、下一步、关键位置。已经完成或过期的进度从 current.md 里移出，原文放进 expired。",
    "- 完全重复的条目只留一条。",
    "- “今天”“昨天”“下周”这类相对日期，按今天的日期改成具体日期。",
    "- 不新增事实，不改写意思，不删掉仍有效的内容；拿不准就保留。",
    "- 任务文件里写明已完成、或 current.md 说已完成的任务，把它的名字放进 done；没把握就不放。",
    '只输出一个 JSON：{"current": "整理后的 current.md 全文", "expired": "从 current.md 移出的原文，没有就是空字符串", "done": ["已完成的任务名"]}',
    "--- current.md ---",
    input.current,
    "--- 任务 ---",
    ...input.tasks.map((task) => `### ${task.name}\n${task.content.slice(0, TASK_EXCERPT)}`),
  ].join("\n");
}

export interface TidyAnswer {
  readonly current: string;
  readonly expired: string;
  readonly done: ReadonlyArray<string>;
}

const normalize = (line: string) =>
  line
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
    .replace(/\s+/g, "")
    .toLowerCase();

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

/** Lines of the old current.md that the answer neither kept nor moved, so would be lost. */
function lostLines(before: string, answer: TidyAnswer): Array<string> {
  const kept = `${answer.current}\n${answer.expired}`
    .split("\n")
    .map(normalize)
    .filter((line) => line !== "");
  return before
    .split("\n")
    .filter((line) => line.trim() !== "" && !line.trim().startsWith("#"))
    .filter((line) => {
      const target = normalize(line);
      return !kept.some((candidate) => similarity(target, candidate) >= KEPT_SIMILARITY);
    });
}

/** The model's answer, or why it cannot be used. */
export function parseTidyAnswer(
  text: string,
  before: string,
  taskNames: ReadonlyArray<string>,
): TidyAnswer | string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return "模型没有给出 JSON";
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return "模型给出的 JSON 无法解析";
  }
  if (raw === null || typeof raw !== "object") return "模型给出的 JSON 不是对象";
  const record = raw as Record<string, unknown>;
  const current = typeof record.current === "string" ? record.current : before;
  const expired = typeof record.expired === "string" ? record.expired.trim() : "";
  const done = Array.isArray(record.done)
    ? record.done.filter(
        (name): name is string => typeof name === "string" && taskNames.includes(name),
      )
    : [];
  if (before.trim() !== "" && current.trim() === "") return "整理后的现状是空的";
  const answer = { current, expired, done: [...new Set(done)] };
  const lost = lostLines(before, answer);
  if (lost.length > 0) return `整理结果丢了内容：${lost.slice(0, 3).join(" / ")}`;
  return answer;
}

/**
 * Tidies one project's memory. Returns what changed in the user's words, null when nothing did,
 * and fails with a reason when the model's answer is unusable; either way the clock restarts so
 * a bad answer is not retried every half hour.
 */
export const tidy = Effect.fn("VibeBossMemoryTidy.tidy")(
  function* (root: string, ask: Ask, source: string) {
    const path = yield* Path.Path;
    const folder = yield* ProjectMemory.folderOf(root);
    const restartClock = Effect.gen(function* () {
      const meta = yield* ProjectMemory.readMeta(root);
      yield* ProjectMemory.writeMeta({
        ...meta,
        lastTidyAt: DateTime.formatIso(yield* DateTime.now),
        sessions: 0,
      });
    });
    const current = (yield* ProjectMemory.readOptional(path.join(folder, "current.md"))) ?? "";
    const taskFiles = (yield* ProjectMemory.listFiles(folder)).filter(
      (file) => file.kind === "task",
    );
    const tasks: Array<{ name: string; content: string; path: string }> = [];
    for (const file of taskFiles) {
      const content = yield* ProjectMemory.readOptional(path.join(folder, file.path));
      if (content !== null) tasks.push({ name: file.title, content, path: file.path });
    }
    if (current.replace(/^#.*$/gm, "").trim() === "" && tasks.length === 0) {
      yield* restartClock;
      return null;
    }
    // The user's calendar day, not UTC's: the archive heading and relative dates read locally.
    const today = LOCAL_DAY.format(DateTime.toEpochMillis(yield* DateTime.now));
    const answerText = yield* ask(tidyPrompt({ today, current, tasks })).pipe(
      Effect.tapError(() => restartClock),
    );
    const answer = parseTidyAnswer(
      answerText,
      current,
      tasks.map((task) => task.name),
    );
    if (typeof answer === "string") {
      yield* restartClock;
      return yield* new VibeBossError({ detail: answer });
    }

    const files: Array<{ path: string; content: string | null }> = [];
    const parts: Array<string> = [];
    if (answer.current.trim() !== current.trim()) {
      files.push({ path: "current.md", content: answer.current });
      parts.push("现状");
    }
    if (answer.expired !== "") {
      const archived = (yield* ProjectMemory.readOptional(path.join(folder, EXPIRED_FILE))) ?? "";
      files.push({
        path: EXPIRED_FILE,
        content: `${archived === "" ? "# 过期进度\n" : archived.trimEnd() + "\n"}\n## ${today}\n\n${answer.expired}\n`,
      });
    }
    for (const name of answer.done) {
      const task = tasks.find((candidate) => candidate.name === name)!;
      let target = `archive/${name}.md`;
      for (
        let n = 2;
        (yield* ProjectMemory.readOptional(path.join(folder, target))) !== null;
        n += 1
      ) {
        target = `archive/${name}-${n}.md`;
      }
      files.push({ path: target, content: task.content }, { path: task.path, content: null });
      parts.push(`归档任务“${name}”`);
    }
    yield* restartClock;
    if (files.length === 0) return null;
    const summary = `整理：${parts.length > 0 ? parts.join("、") : "移出过期进度"}`;
    yield* ProjectMemory.applyChange(root, { author: "system", summary, source, files });
    return summary;
  },
  (effect) =>
    Effect.mapError(effect, (cause) =>
      isVibeBossError(cause) ? cause : new VibeBossError({ detail: "整理项目记忆失败", cause }),
    ),
);

/** Projects due for an automatic tidy: a day since the last one and five main conversations. */
export const dueRoots = Effect.fn("VibeBossMemoryTidy.dueRoots")(function* () {
  const now = DateTime.toEpochMillis(yield* DateTime.now);
  const due: Array<string> = [];
  for (const meta of yield* ProjectMemory.listMetas()) {
    const age = now - Date.parse(meta.lastTidyAt);
    if (
      meta.sessions >= SESSIONS_BETWEEN &&
      age >= Duration.toMillis(Duration.hours(HOURS_BETWEEN))
    ) {
      due.push(meta.root);
    }
  }
  return due;
});
