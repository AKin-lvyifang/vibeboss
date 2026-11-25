import type { VibeBossConfig, VibeBossRuleSuggestion } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { applyRuleSuggestion } from "./vibebossRuleEdits";

const config: VibeBossConfig = {
  version: 2,
  sharedRules: "- 回复用中文",
  leadRules: "- 前端交给 @frontend",
  perAgent: {
    claude: "- 先给结论\n- 调用：`agy -p x`\n- 回复用中文",
    codex: "* 先给结论\n- 改完跑测试",
  },
  lead: { providerInstanceId: "claudeAgent", note: "" },
  members: [],
};

const suggestion = (patch: Partial<VibeBossRuleSuggestion>): VibeBossRuleSuggestion => ({
  id: "s",
  source: "check",
  kind: "cli",
  target: "claude",
  line: "",
  reason: "",
  replacement: null,
  removals: [],
  ...patch,
});

describe("applyRuleSuggestion", () => {
  it("removes or rewrites the quoted line in its own section", () => {
    expect(
      applyRuleSuggestion(config, suggestion({ line: "- 调用：`agy -p x`" })).perAgent.claude,
    ).toBe("- 先给结论\n- 回复用中文");
    expect(
      applyRuleSuggestion(
        config,
        suggestion({ line: "- 调用：`agy -p x`", replacement: "- 评审派给 @reviewer" }),
      ).perAgent.claude,
    ).toBe("- 先给结论\n- 评审派给 @reviewer\n- 回复用中文");
  });

  it("moves a line every agent repeats into the shared rules", () => {
    const next = applyRuleSuggestion(
      config,
      suggestion({
        kind: "shared",
        target: "shared",
        line: "- 先给结论",
        removals: [
          { target: "claude", line: "- 先给结论" },
          { target: "codex", line: "* 先给结论" },
        ],
      }),
    );
    expect(next.sharedRules).toBe("- 回复用中文\n- 先给结论");
    expect(next.perAgent.claude).toBe("- 调用：`agy -p x`\n- 回复用中文");
    expect(next.perAgent.codex).toBe("- 改完跑测试");
  });
});
