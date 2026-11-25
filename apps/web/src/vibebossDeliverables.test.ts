import { describe, expect, it } from "vite-plus/test";

import { deliverableKind, isDeliverable, memberForDelegation } from "./vibebossDeliverables";

describe("deliverables", () => {
  it("keeps files a person opens and drops code, rules and code-folder assets", () => {
    expect(deliverableKind("docs/方案.html")).toBe("page");
    expect(deliverableKind("release/VibeBoss.dmg")).toBe("package");
    expect(deliverableKind("src/pages/Pricing.tsx")).toBeNull();
    expect(isDeliverable("docs/claude建议/定价页.html", "created")).toBe(true);
    expect(isDeliverable("apps/web/public/icon.png", "created")).toBe(false);
    expect(isDeliverable("apps/web/public/icon.png", "mentioned")).toBe(true);
    expect(isDeliverable("AGENTS.md", "mentioned")).toBe(false);
    expect(isDeliverable(".codex-memory/current.md", "created")).toBe(false);
    expect(isDeliverable("scripts/build.sh", "mentioned")).toBe(false);
  });
});

describe("memberForDelegation", () => {
  const members = [
    { id: "r", name: "reviewer", providerInstanceId: "antigravity", model: "gemini-4-neon" },
    { id: "f", name: "frontend", providerInstanceId: "codex", model: "gpt-6.2-sol" },
    { id: "b", name: "backend", providerInstanceId: "codex", model: "gpt-6.2-astra" },
  ];

  it("reads the member from the @name prefix and strips it from the title", () => {
    expect(
      memberForDelegation(
        { title: "@backend：年付价格接口", providerInstanceId: "codex", model: null },
        members,
      ),
    ).toEqual({ member: members[2], title: "年付价格接口" });
  });

  it("falls back to agent and model, then to the only member on that agent", () => {
    expect(
      memberForDelegation(
        { title: "定价页前端", providerInstanceId: "codex", model: "gpt-6.2-sol" },
        members,
      ).member,
    ).toBe(members[1]);
    expect(
      memberForDelegation(
        { title: "review", providerInstanceId: "antigravity", model: null },
        members,
      ).member,
    ).toBe(members[0]);
    expect(
      memberForDelegation({ title: "x", providerInstanceId: "codex", model: null }, members).member,
    ).toBeNull();
  });
});
