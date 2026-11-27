import { describe, expect, it } from "vite-plus/test";

import type { MessageResolver } from "./i18n/messages";
import {
  buildHudSnapshot,
  hudDoneKey,
  type HudSnapshotInput,
  type HudThread,
} from "./vibebossHud.logic";

// Fills `{name}` placeholders so assertions read like the bar does.
const resolve = ((message: string, variables?: Record<string, unknown>) =>
  String(message).replace(/\{(\w+)\}/g, (_, name: string) =>
    String(variables?.[name] ?? ""),
  )) as unknown as MessageResolver;

function thread(id: string, overrides: Partial<HudThread> = {}): HudThread {
  return {
    thread: {
      environmentId: "env",
      id,
      title: id,
      providerInstanceId: "claudeAgent",
      lineage: null,
      delegatedFrom: null,
      runtime: { providerName: "Claude", status: "idle", lastError: null },
      latestRun: { completedAt: "2026-11-28T08:00:00.000Z" },
    } as unknown as HudThread["thread"],
    status: "ready",
    unseenCompletion: false,
    shownUnderParent: false,
    ownsPendingRequest: false,
    requests: null,
    steps: null,
    ...overrides,
  };
}

function snapshot(threads: HudThread[], overrides: Partial<HudSnapshotInput> = {}) {
  return buildHudSnapshot({
    threads,
    watchedThreadKey: null,
    dismissedDoneKeys: new Set(),
    usage: [],
    appearance: { enabled: true, doNotDisturb: false, avatar: null, avatarShape: "square" },
    resolve,
    ...overrides,
  });
}

const rows = (result: ReturnType<typeof snapshot>, kind: string) =>
  result.groups.find((group) => group.kind === kind)?.rows ?? [];

describe("buildHudSnapshot", () => {
  it("puts a waiting thread ahead of failures and work in the closed bar", () => {
    const result = snapshot([
      thread("asks", { status: "approval", ownsPendingRequest: true }),
      thread("broken", { status: "failed" }),
      thread("busy", { status: "working" }),
    ]);
    expect(result.collapsed).toEqual({
      tone: "attention",
      left: "Claude needs approval",
      right: "1 waiting · 1 at work",
    });
  });

  it("offers approve only while the provider can still take the answer", () => {
    const approval = (responseCapability: string) =>
      thread("asks", {
        status: "approval",
        ownsPendingRequest: true,
        requests: {
          approvals: [
            {
              requestId: "r1",
              requestKind: "command",
              detail: "pnpm db:migrate",
              responseCapability,
            },
          ],
          userInputs: [],
        } as unknown as HudThread["requests"],
      });
    expect(rows(snapshot([approval("live")]), "attention")[0]).toMatchObject({
      code: "pnpm db:migrate",
      approvalRequestId: "r1",
    });
    expect(rows(snapshot([approval("not_resumable")]), "attention")[0]).not.toHaveProperty(
      "approvalRequestId",
    );
  });

  it("leaves a question with many choices to be answered in the thread", () => {
    const question = (count: number) =>
      thread("asks", {
        status: "input",
        ownsPendingRequest: true,
        requests: {
          approvals: [],
          userInputs: [
            {
              requestId: "r1",
              responseCapability: "live",
              questions: [
                {
                  id: "q1",
                  question: "Discount yearly plans?",
                  multiSelect: false,
                  options: Array.from({ length: count }, (_, index) => ({
                    label: `Option ${index}`,
                  })),
                },
              ],
            },
          ],
        } as unknown as HudThread["requests"],
      });
    expect(rows(snapshot([question(2)]), "attention")[0]?.question?.options).toHaveLength(2);
    expect(rows(snapshot([question(5)]), "attention")[0]).not.toHaveProperty("question");
  });

  it("does not remind about the thread the user is looking at", () => {
    const result = snapshot(
      [
        thread("asks", { status: "approval", ownsPendingRequest: true }),
        thread("busy", { status: "working" }),
      ],
      { watchedThreadKey: "env:asks" },
    );
    expect(rows(result, "attention")).toEqual([]);
    expect(result.collapsed?.tone).toBe("working");
  });

  it("shows a child's request once, on the child", () => {
    const parent = thread("parent", { status: "approval" });
    const child = thread("child", {
      status: "approval",
      ownsPendingRequest: true,
      shownUnderParent: true,
      thread: {
        ...thread("child").thread,
        lineage: { parentThreadId: "parent" },
      } as unknown as HudThread["thread"],
    });
    expect(rows(snapshot([parent, child]), "attention").map((row) => row.threadId)).toEqual([
      "child",
    ]);
  });

  it("lists running children under their working parent", () => {
    const child = thread("child", {
      status: "working",
      shownUnderParent: true,
      thread: {
        ...thread("child").thread,
        lineage: { parentThreadId: "parent" },
      } as unknown as HudThread["thread"],
    });
    const result = snapshot([
      thread("parent", { status: "working", steps: { done: 3, total: 5, current: "Run tests" } }),
      child,
    ]);
    expect(rows(result, "working")).toEqual([
      expect.objectContaining({
        threadId: "parent",
        detail: "Run tests",
        progress: { done: 3, total: 5 },
        children: [{ title: "child", detail: "Claude" }],
      }),
    ]);
  });

  it("drops finished threads the user cleared, until they finish again", () => {
    const finished = thread("done", { unseenCompletion: true });
    expect(rows(snapshot([finished]), "done")).toHaveLength(1);
    expect(
      rows(snapshot([finished], { dismissedDoneKeys: new Set([hudDoneKey(finished)]) }), "done"),
    ).toEqual([]);
  });

  it("warns when an account is nearly out and nothing else needs the user", () => {
    const result = snapshot([], {
      usage: [
        {
          key: "claude",
          driver: "claudeAgent",
          name: "Claude",
          plan: "Max",
          windows: [{ label: "5 hours", remainingPercent: 8, resets: "resets in 2h" }],
        },
      ],
    });
    expect(result.collapsed).toEqual({
      tone: "warning",
      left: "Claude has 8% left",
      right: "resets in 2h",
    });
    expect(result.usage[0]?.windows[0]?.remaining).toBe("8% left");
  });

  it("says nothing when every thread is idle", () => {
    expect(snapshot([thread("quiet")]).collapsed).toBeNull();
  });
});
