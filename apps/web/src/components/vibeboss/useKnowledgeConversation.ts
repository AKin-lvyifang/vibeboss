import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId } from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";

import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useProjects, useThreadShells } from "../../state/entities";
import { sortScopedProjectsForSidebar } from "../Sidebar.logic";

/**
 * Opens a new conversation with its first message written, for jobs an agent does with its own
 * tools (uploading to Feishu, listing cloud libraries). The jobs use absolute paths, so any
 * project can host them; the most recent one is at hand.
 */
export function useKnowledgeConversation(environmentId: EnvironmentId | null) {
  const router = useRouter();
  const handleNewThread = useNewThreadHandler();
  const projects = useProjects();
  const threads = useThreadShells();
  return async (prompt: string) => {
    const project = sortScopedProjectsForSidebar(
      projects.filter(
        (candidate) => candidate.isScratch !== true && candidate.environmentId === environmentId,
      ),
      threads,
      "updated_at",
    )[0];
    if (project === undefined) {
      router.history.push(`/new?prompt=${encodeURIComponent(prompt)}`);
      return;
    }
    await handleNewThread(scopeProjectRef(project.environmentId, project.id), { prompt });
  };
}
