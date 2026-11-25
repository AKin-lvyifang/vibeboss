import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { checkRules, parseModelReview, reviewRules, type RuleSection } from "./RuleReview.ts";

const sections: ReadonlyArray<RuleSection> = [
  { target: "shared", label: "公共规则", text: "- 回复用中文" },
  { target: "lead", label: "主控规则", text: "- 前端交给 @frontend" },
  {
    target: "claude",
    label: "Claude 专属",
    text: [
      "- 回复用中文",
      '- 调用：`agy -p "<任务>" --model x`，长任务放后台',
      "- 先给结论",
      "- 让 Antigravity 在后台独立出一版",
    ].join("\n"),
  },
  { target: "codex", label: "Codex 专属", text: "- 先给结论\n- 改完跑测试" },
];

it("flags CLI dispatch, copies of shared rules and lines every agent repeats", () => {
  const found = checkRules(sections);
  assert.deepStrictEqual(
    found.map((suggestion) => [suggestion.kind, suggestion.target, suggestion.line]),
    [
      ["cli", "claude", '- 调用：`agy -p "<任务>" --model x`，长任务放后台'],
      ["duplicate", "claude", "- 回复用中文"],
      ["shared", "shared", "- 先给结论"],
    ],
  );
  assert.deepStrictEqual(found[2]!.targets, ["claude", "codex"]);
});

it("keeps model findings only when they quote a real line not already found", () => {
  const fixed = checkRules(sections);
  const answer = JSON.stringify([
    {
      target: "claude",
      line: "- 让 Antigravity 在后台独立出一版",
      kind: "cli",
      reason: "绕开派活",
      replacement: "- 设计方案派给 @reviewer",
    },
    {
      target: "claude",
      line: "- 一句不存在的规则",
      kind: "conflict",
      reason: "x",
      replacement: null,
    },
    {
      target: "claude",
      line: "- 回复用中文",
      kind: "duplicate",
      reason: "重复",
      replacement: null,
    },
  ]);
  const found = parseModelReview(`结果：${answer}`, sections, fixed);
  assert.deepStrictEqual(
    found.map((suggestion) => [suggestion.kind, suggestion.line, suggestion.replacement]),
    [["cli", "- 让 Antigravity 在后台独立出一版", "- 设计方案派给 @reviewer"]],
  );
});

it.effect("returns the fixed checks when the model fails", () =>
  Effect.gen(function* () {
    const review = yield* reviewRules(sections, () => Effect.fail("offline"));
    assert.strictEqual(review.suggestions.length, 3);
    assert.isNotNull(review.modelError);
  }),
);
