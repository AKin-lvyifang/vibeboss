/**
 * VibeBoss Demo panel: agents write up to three design demos to a fixed folder in the
 * workspace, each with a small status file the panel reads for its loading state.
 *
 *   .vibeboss/demo/<1|2|3>/index.html
 *   .vibeboss/demo/<1|2|3>/status.json  {"agent":"claude","progress":40}
 */
export const VIBEBOSS_DEMO_DIR = ".vibeboss/demo";
export const VIBEBOSS_DEMO_SLOTS = [1, 2, 3] as const;
export type DemoSlot = (typeof VIBEBOSS_DEMO_SLOTS)[number];

export type DemoAgentKind = "claude" | "codex" | "antigravity" | "final" | "other";

export interface DemoStatus {
  readonly agent: string;
  readonly agentKind: DemoAgentKind;
  readonly progress: number;
  readonly waiting: boolean;
  /** Changes whenever the agent rewrites the status, so a regenerated demo reloads. */
  readonly version: string;
}

export const demoStatusPath = (slot: DemoSlot) => `${VIBEBOSS_DEMO_DIR}/${slot}/status.json`;
export const demoPagePath = (slot: DemoSlot) => `${VIBEBOSS_DEMO_DIR}/${slot}/index.html`;

export function demoAgentKind(agent: string): DemoAgentKind {
  const name = agent.trim().toLowerCase();
  if (name.includes("claude")) return "claude";
  if (name.includes("codex") || name.includes("gpt") || name.includes("openai")) return "codex";
  if (name.includes("antigravity") || name.includes("agy") || name.includes("gemini")) {
    return "antigravity";
  }
  if (name === "final" || name.includes("定稿")) return "final";
  return "other";
}

export function parseDemoStatus(contents: string): DemoStatus | null {
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const agent = typeof record.agent === "string" ? record.agent.trim() : "";
  const rawProgress = typeof record.progress === "number" ? record.progress : 0;
  return {
    agent,
    agentKind: demoAgentKind(agent),
    progress: Number.isFinite(rawProgress)
      ? Math.min(100, Math.max(0, Math.round(rawProgress)))
      : 0,
    waiting: record.waiting === true,
    version: contents.trim(),
  };
}

export const isDemoReady = (status: DemoStatus) => !status.waiting && status.progress >= 100;

/** Polls fast while a demo is still being written, slowly once every demo is ready. */
export const demoPollInterval = (statuses: ReadonlyArray<DemoStatus>) =>
  statuses.length > 0 && statuses.every(isDemoReady) ? 5000 : 1500;

/** An agent's `demo_panel_open` call: the app opens the Demo panel when a new one finishes. */
export interface DemoPanelOpenCall {
  readonly id: string;
  readonly toolName: string | null;
  readonly status: string;
  readonly completedAtMs: number | null;
}

/** Calls older than this are history from before the thread was opened, not a request now. */
const DEMO_PANEL_OPEN_FRESH_MS = 2 * 60 * 1000;

export function latestDemoPanelOpenCall(
  calls: ReadonlyArray<DemoPanelOpenCall>,
  isDemoPanelOpenTool: (toolName: string | null) => boolean,
): DemoPanelOpenCall | null {
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    const call = calls[index];
    if (call && call.status === "completed" && isDemoPanelOpenTool(call.toolName)) return call;
  }
  return null;
}

export const isFreshDemoPanelOpenCall = (call: DemoPanelOpenCall, nowMs: number) =>
  call.completedAtMs !== null && nowMs - call.completedAtMs <= DEMO_PANEL_OPEN_FRESH_MS;
