import type { VibeBossConfig } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";

import { renderRuleFile } from "./VibeBoss.ts";

const config: VibeBossConfig = {
  shared: "- 用中文回答",
  coop: "- 小事自己做",
  perAgent: {
    claude: "# 原来的 CLAUDE.md\n\n- 改全再说做完",
    codex: "- 汇报先写结论",
    agy: "",
  },
  lead: { id: "lead", kind: "claude", model: "", effort: "", use: "和用户对话" },
  helpers: [{ id: "a", kind: "codex", model: "GPT-6.2 Astra", effort: "xhigh", use: "写后端" }],
};

it("keeps each agent's own rules verbatim after the shared parts", () => {
  const claude = renderRuleFile(config, "claude");
  assert.include(claude, "# 原来的 CLAUDE.md\n\n- 改全再说做完");
  assert.include(claude, "- 用中文回答");
  assert.isBelow(claude.indexOf("- 用中文回答"), claude.indexOf("# 原来的 CLAUDE.md"));
  assert.notInclude(claude, "- 汇报先写结论");
});

it("lists the agent table under the collaboration guide", () => {
  const codex = renderRuleFile(config, "codex");
  assert.include(codex, "## 协作说明\n\n- 小事自己做");
  assert.include(codex, "- 主控：Claude（和用户对话）");
  assert.include(codex, "- Codex GPT-6.2 Astra xhigh：写后端");
});

it("marks the file as generated so a later import does not treat it as hand-written", () => {
  assert.isTrue(renderRuleFile(config, "agy").startsWith("<!-- 由 VibeBoss 生成"));
});
