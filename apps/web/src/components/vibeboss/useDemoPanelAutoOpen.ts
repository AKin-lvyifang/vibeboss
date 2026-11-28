import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ThreadStructureVisibleTurnItem } from "@t3tools/client-runtime/state/models";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { resolveT3McpToolId } from "@t3tools/shared/t3McpToolPresentation";
import * as DateTime from "effect/DateTime";
import { useEffect, useRef } from "react";

import { useRightPanelStore } from "~/rightPanelStore";
import { isFreshDemoPanelOpenCall, latestDemoPanelOpenCall } from "~/vibebossDemos";

const isDemoPanelOpenTool = (toolName: string | null) =>
  resolveT3McpToolId(toolName) === "demo_panel_open";

/** Opens the Demo panel when an agent in this thread calls `demo_panel_open`. */
export function useDemoPanelAutoOpen(
  threadRef: ScopedThreadRef | null,
  items: ReadonlyArray<ThreadStructureVisibleTurnItem>,
) {
  const calls = items.flatMap(({ item }) =>
    item.type === "dynamic_tool"
      ? [
          {
            id: item.id,
            toolName: item.toolName,
            status: item.status,
            completedAtMs: item.completedAt ? DateTime.toEpochMillis(item.completedAt) : null,
          },
        ]
      : [],
  );
  const latest = latestDemoPanelOpenCall(calls, isDemoPanelOpenTool);
  const latestId = latest?.id ?? null;
  const latestCompletedAtMs = latest?.completedAtMs ?? null;
  const opened = useRef(new Set<string>());
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the call arrives in server-pushed thread items, with no user handler to open the panel from.
  useEffect(() => {
    if (threadRef === null || latestId === null) return;
    const call = {
      id: latestId,
      toolName: null,
      status: "completed",
      completedAtMs: latestCompletedAtMs,
    };
    if (!isFreshDemoPanelOpenCall(call, Date.now())) return;
    const key = `${scopedThreadKey(threadRef)}:${latestId}`;
    if (opened.current.has(key)) return;
    opened.current.add(key);
    useRightPanelStore.getState().open(threadRef, "demo");
  }, [threadRef, latestId, latestCompletedAtMs]);
}
