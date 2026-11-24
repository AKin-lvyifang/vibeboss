import type { ServerProvider, VibeBossConfig } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";

import { enabledRuleTargets, migrateLegacyConfig, renderRuleFile } from "./VibeBoss.ts";

const provider = (instanceId: string, driver: string, extra: Partial<ServerProvider> = {}) =>
  ({ instanceId, driver, enabled: true, ...extra }) as unknown as ServerProvider;

const providers = [
  provider("claudeAgent", "claudeAgent"),
  provider("codex", "codex"),
  provider("antigravity", "antigravity", { enabled: false }),
  provider("hermes-agent", "acpRegistry", { displayName: "Hermes" } as Partial<ServerProvider>),
  provider("other-acp", "acpRegistry"),
];

const config: VibeBossConfig = {
  version: 2,
  leadRules: "- 写后端交给 @worker",
  perAgent: { claude: "# 原来的 CLAUDE.md\n\n- 改全再说做完", codex: "- 汇报先写结论" },
  lead: { providerInstanceId: "claudeAgent", note: "和用户对话" },
  members: [
    {
      id: "w",
      name: "worker",
      providerInstanceId: "codex",
      model: "GPT-6.2 Astra",
      effort: "xhigh",
      note: "只给人看的备注",
    },
  ],
};

it("lists a rule file for each enabled agent whose file is known, Hermes included", () => {
  assert.deepStrictEqual(
    enabledRuleTargets(providers).map((target) => target.id),
    ["claude", "codex", "hermes"],
  );
});

it("writes lead rules only into the lead's file and keeps each agent's own rules verbatim", () => {
  const claude = renderRuleFile(config, "claude", true, providers);
  const codex = renderRuleFile(config, "codex", false, providers);
  assert.include(claude, "# 原来的 CLAUDE.md\n\n- 改全再说做完");
  assert.include(claude, "## 主控规则");
  assert.notInclude(codex, "## 主控规则");
  assert.include(codex, "收到主控派来的任务时");
  assert.notInclude(claude, "只给人看的备注");
});

it("writes shared rules once into every agent's file, ahead of that agent's own rules", () => {
  const shared = { ...config, sharedRules: "- 回复用中文" };
  for (const [target, isLead] of [
    ["claude", true],
    ["codex", false],
  ] as const) {
    const text = renderRuleFile(shared, target, isLead, providers);
    assert.include(text, "- 回复用中文");
    assert.isBelow(text.indexOf("- 回复用中文"), text.indexOf(shared.perAgent[target]!));
  }
});

it("expands @member to its current agent and delegate call, so swapping agents needs no edit", () => {
  const claude = renderRuleFile(config, "claude", true, providers);
  assert.include(claude, "@worker（派给 Codex）");
  assert.include(claude, '"providerInstanceId":"codex"');
  const swapped = renderRuleFile(
    { ...config, members: [{ ...config.members[0]!, providerInstanceId: "claudeAgent" }] },
    "claude",
    true,
    providers,
  );
  assert.include(swapped, "@worker（派给 Claude）");
  assert.include(swapped, '"providerInstanceId":"claudeAgent"');
});

it("migrates the first config version without losing an agent's own rules", () => {
  const migrated = migrateLegacyConfig({
    shared: "",
    coop: "- 收到别人派来的任务时，只做这件事，不再往下派。",
    perAgent: { claude: "原样保留" },
    lead: { id: "lead", kind: "claude", model: "", effort: "", use: "对话" },
    helpers: [{ id: "codex-backend", kind: "codex", model: "m", effort: "xhigh", use: "后端" }],
  });
  assert.strictEqual(migrated.perAgent.claude, "原样保留");
  assert.strictEqual(migrated.lead.providerInstanceId, "claudeAgent");
  assert.strictEqual(migrated.members[0]?.name, "backend");
  assert.include(migrated.leadRules, "@backend");
});

it("marks the file as generated so a later import does not treat it as hand-written", () => {
  assert.isTrue(
    renderRuleFile(config, "codex", false, providers).startsWith("<!-- 由 VibeBoss 生成"),
  );
});

it("passes the member's model slug and effort option straight into delegate_task", () => {
  const withModels = providers.map((item) =>
    item.instanceId === "codex"
      ? ({
          ...item,
          models: [
            {
              slug: "gpt-6.2-astra",
              name: "GPT-6.2 Astra",
              isCustom: false,
              capabilities: {
                optionDescriptors: [
                  {
                    id: "reasoningEffort",
                    label: "Reasoning",
                    type: "select",
                    options: [
                      { id: "high", label: "High" },
                      { id: "xhigh", label: "Extra high" },
                    ],
                  },
                ],
              },
            },
          ],
        } as unknown as ServerProvider)
      : item,
  );
  const claude = renderRuleFile(config, "claude", true, withModels);
  assert.include(
    claude,
    '{"providerInstanceId":"codex","model":"gpt-6.2-astra","options":[{"id":"reasoningEffort","value":"xhigh"}]}',
  );
  assert.notInclude(claude, "按 orchestrator_capabilities");
});
