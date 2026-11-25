// VibeBoss: the Rules page's check. Fixed checks catch what can be matched exactly; a small model
// then finds what is worded differently. Every model finding must quote a line that exists, so it
// cannot invent rules to change.
import type {
  VibeBossConfig,
  VibeBossRuleReview,
  VibeBossRuleSuggestion,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { agentCliInCommand } from "./AgentCliGuard.ts";

type Suggestion = VibeBossRuleSuggestion;

export interface RuleSection {
  /** "shared", "lead" or an agent's rule target id. */
  readonly target: string;
  readonly label: string;
  readonly text: string;
}

export function ruleSections(
  config: VibeBossConfig,
  agents: ReadonlyArray<{ readonly id: string; readonly label: string }>,
): ReadonlyArray<RuleSection> {
  return [
    { target: "shared", label: "公共规则", text: config.sharedRules ?? "" },
    { target: "lead", label: "主控规则", text: config.leadRules },
    ...agents.map((agent) => ({
      target: agent.id,
      label: `${agent.label} 专属`,
      text: config.perAgent[agent.id] ?? "",
    })),
  ];
}

function linesOf(text: string): ReadonlyArray<string> {
  return text.split("\n").filter((line) => line.trim() !== "");
}

/** Bullets and spacing differ between copies of the same rule. */
function normalized(line: string): string {
  return line
    .trim()
    .replace(/^[-*+]\s+|^\d+[.)]\s+/, "")
    .replace(/\s+/g, " ");
}

const CLI_CALL = /\b(agy|antigravity|codex|claude|gemini)\s+(-p|--print|--prompt|exec)\b/;

function namesAgentCli(line: string): boolean {
  if (CLI_CALL.test(line)) return true;
  return [...line.matchAll(/`([^`]+)`/g)].some((match) => agentCliInCommand(match[1]!) !== null);
}

/** Findings that need no model: CLI calls, copies of shared rules, and lines every agent repeats. */
export function checkRules(sections: ReadonlyArray<RuleSection>): ReadonlyArray<Suggestion> {
  const suggestions: Suggestion[] = [];
  const add = (suggestion: Omit<Suggestion, "id" | "source">) =>
    suggestions.push({ ...suggestion, id: `check:${suggestions.length}`, source: "check" });

  for (const section of sections) {
    for (const line of linesOf(section.text)) {
      if (namesAgentCli(line)) {
        add({
          kind: "cli",
          target: section.target,
          line,
          reason: "让智能体用命令行直接调别的智能体，会绕开 VibeBoss 的派活和子会话。",
          replacement: null,
          targets: [],
        });
      }
    }
  }

  const shared = new Set(
    linesOf(sections.find((section) => section.target === "shared")?.text ?? "").map(normalized),
  );
  const agents = sections.filter(
    (section) => section.target !== "shared" && section.target !== "lead",
  );
  const flagged = new Set(
    suggestions.map((suggestion) => `${suggestion.target}\0${suggestion.line}`),
  );
  for (const section of agents) {
    for (const line of linesOf(section.text)) {
      if (shared.has(normalized(line)) && !flagged.has(`${section.target}\0${line}`)) {
        add({
          kind: "duplicate",
          target: section.target,
          line,
          reason: "公共规则里已经有这一句，这里重复了。",
          replacement: null,
          targets: [],
        });
      }
    }
  }

  if (agents.length >= 2) {
    const [first, ...rest] = agents;
    for (const line of linesOf(first!.text)) {
      const key = normalized(line);
      if (shared.has(key) || namesAgentCli(line)) continue;
      if (
        rest.every((section) => linesOf(section.text).some((other) => normalized(other) === key))
      ) {
        add({
          kind: "shared",
          target: "shared",
          line,
          reason: "每一家都写了这一句，挪进公共规则只写一次。",
          replacement: null,
          targets: agents.map((section) => section.target),
        });
      }
    }
  }
  return suggestions;
}

function reviewRulesPrompt(sections: ReadonlyArray<RuleSection>): string {
  const body = sections
    .map(
      (section) =>
        `### ${section.label}（target: ${section.target}）\n${section.text.trim() || "（空）"}`,
    )
    .join("\n\n");
  return [
    "你在检查 VibeBoss 的多智能体协作规则。VibeBoss 里，主控只能用 delegate_task 工具派活给别的智能体，任务会显示成子会话。公共规则写进每一家，主控规则只给主控，专属规则只给那一家。",
    "找出这些问题：",
    "1. cli：让智能体用命令行或后台进程直接调用别的智能体（包括没写命令、只是换了说法的，比如“让 Antigravity 在后台独立出一版”），绕开了 delegate_task。",
    "2. duplicate：和公共规则意思相同、只是措辞不同的专属规则。",
    "3. conflict：互相矛盾的规则。",
    "4. outdated：明显过时或已不适用的写法。",
    "只报有把握的问题，不要改动正常规则。line 必须一字不差地复制原文中的完整一行。replacement 写改好后的这一行，删除就写 null。",
    '把结果写成 JSON 数组放进 transcription 字段，不要别的文字：[{"target":"...","line":"...","kind":"cli|duplicate|conflict|outdated","reason":"一句话中文说明","replacement":"..." 或 null}]。没有问题就写 []。',
    "",
    body,
  ].join("\n");
}

const MODEL_KINDS = new Set<Suggestion["kind"]>(["cli", "duplicate", "conflict", "outdated"]);

/** Keeps only findings that quote a real line and are not already in the fixed checks. */
export function parseModelReview(
  text: string,
  sections: ReadonlyArray<RuleSection>,
  existing: ReadonlyArray<Suggestion>,
): ReadonlyArray<Suggestion> {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end < start) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const seen = new Set(
    existing.map((suggestion) => `${suggestion.target}\0${suggestion.line.trim()}`),
  );
  const found: Suggestion[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object") continue;
    const target = Reflect.get(entry, "target");
    const line = Reflect.get(entry, "line");
    const kind = Reflect.get(entry, "kind");
    const reason = Reflect.get(entry, "reason");
    const replacement = Reflect.get(entry, "replacement");
    if (typeof target !== "string" || typeof line !== "string" || typeof reason !== "string")
      continue;
    if (!MODEL_KINDS.has(kind as Suggestion["kind"])) continue;
    const section = sections.find((candidate) => candidate.target === target);
    const original =
      section && linesOf(section.text).find((candidate) => candidate.trim() === line.trim());
    if (original === undefined) continue;
    const key = `${target}\0${original.trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({
      id: `model:${found.length}`,
      source: "model",
      kind: kind as Suggestion["kind"],
      target,
      line: original,
      reason,
      replacement:
        typeof replacement === "string" && replacement.trim() !== "" ? replacement : null,
      targets: [],
    });
  }
  return found;
}

/** Fixed checks always return; the model's findings are added when it answers. */
export const reviewRules = Effect.fn("VibeBoss.reviewRules")(function* (
  sections: ReadonlyArray<RuleSection>,
  generate: ((prompt: string) => Effect.Effect<string, unknown>) | null,
) {
  const fixed = checkRules(sections);
  if (generate === null) {
    const review: VibeBossRuleReview = {
      suggestions: fixed,
      modelError: "没有可用的小模型，只做了固定检查。",
    };
    return review;
  }
  const answer = yield* generate(reviewRulesPrompt(sections)).pipe(Effect.result);
  if (answer._tag === "Failure") {
    const review: VibeBossRuleReview = {
      suggestions: fixed,
      modelError: "小模型这次没查成，只显示固定检查的结果。",
    };
    return review;
  }
  const review: VibeBossRuleReview = {
    suggestions: [...fixed, ...parseModelReview(answer.success, sections, fixed)],
    modelError: null,
  };
  return review;
});
