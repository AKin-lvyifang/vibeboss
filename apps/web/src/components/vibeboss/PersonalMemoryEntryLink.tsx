import { useNavigate } from "@tanstack/react-router";
import { T } from "gt-react";
import type { KeyboardEvent, MouseEvent } from "react";

import { setRulesPage } from "../../vibebossRuleReviewStore";

const PERSONAL_MEMORY_TAB = "shared-rules";

/** Whether a tool call wrote personal memory, under any MCP server prefix the agent adds. */
export function isPersonalMemoryTool(toolName: string | null | undefined): boolean {
  return toolName != null && (toolName.split("__").at(-1) ?? toolName) === "personal_memory_update";
}

/** "View" beside a personal memory update in the chat: opens it on the Rules page. */
export function PersonalMemoryEntryLink() {
  const navigate = useNavigate();
  const open = (event: MouseEvent | KeyboardEvent) => {
    event.stopPropagation();
    setRulesPage({ tab: PERSONAL_MEMORY_TAB });
    void navigate({ to: "/rules" });
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
