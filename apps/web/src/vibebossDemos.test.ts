import { expect, it } from "vite-plus/test";

import { demoAgentKind, demoPollInterval, isDemoReady, parseDemoStatus } from "./vibebossDemos";

it("reads an agent's status file", () => {
  const status = parseDemoStatus('{"agent":"Claude","progress":42.6}');
  expect(status).toMatchObject({
    agent: "Claude",
    agentKind: "claude",
    progress: 43,
    waiting: false,
  });
});

it("clamps progress and keeps a demo without progress loading", () => {
  expect(parseDemoStatus('{"agent":"codex","progress":140}')?.progress).toBe(100);
  expect(parseDemoStatus('{"agent":"codex"}')?.progress).toBe(0);
  expect(parseDemoStatus("not json")).toBeNull();
  expect(parseDemoStatus("[1]")).toMatchObject({ agentKind: "other", progress: 0 });
});

it("names the agents VibeBoss runs", () => {
  expect(demoAgentKind("agy")).toBe("antigravity");
  expect(demoAgentKind("GPT-6.2 Sol")).toBe("codex");
  expect(demoAgentKind("定稿")).toBe("final");
  expect(demoAgentKind("final")).toBe("final");
});

it("is ready only once finished and not waiting", () => {
  const done = parseDemoStatus('{"agent":"claude","progress":100}');
  const waiting = parseDemoStatus('{"agent":"final","progress":100,"waiting":true}');
  if (!done || !waiting) throw new Error("status did not parse");
  expect(isDemoReady(done)).toBe(true);
  expect(isDemoReady(waiting)).toBe(false);
  expect(demoPollInterval([done])).toBe(5000);
  expect(demoPollInterval([done, waiting])).toBe(1500);
  expect(demoPollInterval([])).toBe(1500);
});
