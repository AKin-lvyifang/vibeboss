// VibeBoss: applies accepted rules-check suggestions to the Rules page's draft config.
import type { VibeBossConfig, VibeBossRuleSuggestion } from "@t3tools/contracts";

function textOf(config: VibeBossConfig, target: string): string {
  if (target === "shared") return config.sharedRules ?? "";
  if (target === "lead") return config.leadRules;
  return config.perAgent[target] ?? "";
}

function withText(config: VibeBossConfig, target: string, text: string): VibeBossConfig {
  if (target === "shared") return { ...config, sharedRules: text };
  if (target === "lead") return { ...config, leadRules: text };
  return { ...config, perAgent: { ...config.perAgent, [target]: text } };
}

function editLines(
  text: string,
  matches: (line: string) => boolean,
  replacement: string | null,
): string {
  return text
    .split("\n")
    .flatMap((line) => (matches(line) ? (replacement === null ? [] : [replacement]) : [line]))
    .join("\n");
}

export function applyRuleSuggestion(
  config: VibeBossConfig,
  suggestion: VibeBossRuleSuggestion,
): VibeBossConfig {
  if (suggestion.kind === "shared") {
    const cleaned = suggestion.removals.reduce(
      (next, removal) =>
        withText(
          next,
          removal.target,
          editLines(
            textOf(next, removal.target),
            (line) => line.trim() === removal.line.trim(),
            null,
          ),
        ),
      config,
    );
    const shared = textOf(cleaned, "shared").trimEnd();
    return withText(
      cleaned,
      "shared",
      shared === "" ? suggestion.line : `${shared}\n${suggestion.line}`,
    );
  }
  return withText(
    config,
    suggestion.target,
    editLines(
      textOf(config, suggestion.target),
      (line) => line.trim() === suggestion.line.trim(),
      suggestion.replacement,
    ),
  );
}
