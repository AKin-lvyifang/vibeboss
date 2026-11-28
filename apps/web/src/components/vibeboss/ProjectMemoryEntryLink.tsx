import type { ScopedThreadRef } from "@t3tools/contracts";
import { T } from "gt-react";
import type { KeyboardEvent, MouseEvent } from "react";

import { useRightPanelStore } from "../../rightPanelStore";
import { useThreadShell } from "../../state/entities";

const MEMORY_TOOLS = new Set(["project_memory_write", "project_memory_archive"]);

function memoryToolName(toolName: string): string {
  return toolName.split("__").at(-1) ?? toolName;
}

/** Whether a tool call wrote project memory, under any MCP server prefix the agent adds. */
export function isProjectMemoryTool(toolName: string | null | undefined): boolean {
  return toolName != null && MEMORY_TOOLS.has(memoryToolName(toolName));
}

/** "View" beside a project memory update in the chat: opens the written file in the memory tab. */
export function ProjectMemoryEntryLink(props: {
  threadRef: ScopedThreadRef;
  toolName: string;
  input: unknown;
}) {
  const shell = useThreadShell(props.threadRef);
  const projectId = shell?.projectId;
  if (projectId == null) return null;
  const path =
    typeof props.input === "object" && props.input !== null && "path" in props.input
      ? props.input.path
      : undefined;
  const view =
    memoryToolName(props.toolName) === "project_memory_archive"
      ? "archive"
      : typeof path === "string"
        ? `file:${path}`
        : "log";
  const open = (event: MouseEvent | KeyboardEvent) => {
    event.stopPropagation();
    useRightPanelStore.getState().openMemory(props.threadRef, {
      environmentId: props.threadRef.environmentId,
      projectId,
      view,
    });
  };
  return (
    <button
      type="button"
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") open(event);
      }}
      className="shrink-0 rounded-sm text-muted-foreground text-sm underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring"
    >
      <T>View</T>
    </button>
  );
}
