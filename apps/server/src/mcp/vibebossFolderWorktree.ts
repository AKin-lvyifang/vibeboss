// VibeBoss: delegate_task `isolation:"worktree"` with `repository` in a project folder that is not
// a Git repository. The child gets a task folder with a worktree of that one repository, started
// from its current branch, so it sees the lead's latest commits there.
import type { ProjectTrackedFolder } from "@t3tools/contracts";

const trimSlashes = (value: string) => value.replace(/[\\/]+$/, "");

/** The tracked folder `requested` names (name, absolute path, or path under the project root). */
export function pickFolderRepository(
  trackedFolders: ReadonlyArray<ProjectTrackedFolder>,
  requested: string,
  workspaceRoot: string,
): { readonly folder: ProjectTrackedFolder } | { readonly error: string } {
  const names = trackedFolders.map((folder) => folder.name).join(", ");
  const wanted = trimSlashes(requested.trim());
  const underRoot = `${trimSlashes(workspaceRoot)}/${wanted.replace(/^\.\//, "")}`;
  const folder = trackedFolders.find((candidate) => {
    const path = trimSlashes(candidate.path);
    return candidate.name === wanted || path === wanted || path === underRoot;
  });
  return folder
    ? { folder }
    : { error: `Repository "${wanted}" is not tracked by this project. Use one of ${names}.` };
}
