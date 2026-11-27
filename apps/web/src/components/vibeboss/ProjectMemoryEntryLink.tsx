import type { ScopedThreadRef } from "@t3tools/contracts";
import {
  derivePhysicalProjectKey,
  selectProjectGroupingSettings,
} from "@t3tools/client-runtime/state/project-grouping";
import { useNavigate } from "@tanstack/react-router";
import { T } from "gt-react";
import type { KeyboardEvent, MouseEvent } from "react";

import { useClientSettings } from "../../hooks/useSettings";
import { buildPhysicalToLogicalProjectKeyMap } from "../../sidebarProjectGrouping";
import { useProjects, useThreadShell } from "../../state/entities";
import { PROJECT_MEMORY_SECTION_ID } from "./ProjectMemorySettings";

const MEMORY_TOOLS = new Set(["project_memory_write", "project_memory_archive"]);

/** Whether a tool call wrote project memory, under any MCP server prefix the agent adds. */
export function isProjectMemoryTool(toolName: string | null | undefined): boolean {
  if (toolName == null) return false;
  return MEMORY_TOOLS.has(toolName.split("__").at(-1) ?? toolName);
}

/** "View" beside a project memory update in the chat: opens that project's memory in settings. */
export function ProjectMemoryEntryLink({ threadRef }: { threadRef: ScopedThreadRef }) {
  const navigate = useNavigate();
  const shell = useThreadShell(threadRef);
  const projects = useProjects();
  const grouping = useClientSettings(selectProjectGroupingSettings);
  const project = projects.find(
    (candidate) =>
      candidate.environmentId === threadRef.environmentId && candidate.id === shell?.projectId,
  );
  if (project === undefined) return null;
  const open = (event: MouseEvent | KeyboardEvent) => {
    event.stopPropagation();
    const key =
      buildPhysicalToLogicalProjectKeyMap({
        projects,
        settings: grouping,
        primaryEnvironmentId: null,
      }).get(derivePhysicalProjectKey(project)) ?? derivePhysicalProjectKey(project);
    void navigate({
      to: "/settings/projects",
      search: { project: key, machine: undefined },
      hash: PROJECT_MEMORY_SECTION_ID,
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
