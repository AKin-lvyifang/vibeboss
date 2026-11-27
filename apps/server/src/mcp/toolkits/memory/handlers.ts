import { isDelegatedAppThread, OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as ProjectMemory from "../../../vibeboss/ProjectMemory.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { ProjectMemoryToolkit } from "./tools.ts";

const refuse = (message: string) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message });

/** The calling thread's project folder (not its worktree) and title, for a main agent only. */
const mainCaller = Effect.gen(function* () {
  const scope = yield* McpInvocationContext.McpInvocationContext;
  if (scope.thread === undefined) return yield* refuse("项目记忆只能在会话里写");
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const projects = yield* ProjectService.ProjectService;
  const shell = yield* threads
    .getThreadShell(scope.thread.threadId)
    .pipe(Effect.orElseSucceed(() => null));
  if (shell === null) return yield* refuse("找不到这个会话");
  if (scope.thread.subagent === true || isDelegatedAppThread(shell)) {
    return yield* refuse(
      "你是被派活的成员，项目记忆只读。把结论写进交回结果，由主控决定是否并入。",
    );
  }
  const project = yield* projects.getById(shell.projectId).pipe(Effect.orElseSucceed(Option.none));
  if (Option.isNone(project)) return yield* refuse("找不到这个会话的项目");
  return {
    root: project.value.workspaceRoot,
    source: `会话“${shell.title}”`,
    threadId: scope.thread.threadId,
  };
});

const asFailure = (error: { readonly detail?: string; readonly message: string }) =>
  refuse(error.detail ?? error.message);

export const layer = McpToolAccess.toLayer(ProjectMemoryToolkit, {
  project_memory_write: McpToolAccess.actsAsCaller(({ path, content }) =>
    Effect.gen(function* () {
      const caller = yield* mainCaller;
      const result = yield* ProjectMemory.writeFile(
        caller.root,
        { path, content },
        { author: "agent", source: caller.source, threadId: caller.threadId },
      ).pipe(Effect.mapError(asFailure));
      return { path: result.path };
    }),
  ),
  project_memory_archive: McpToolAccess.actsAsCaller(({ path }) =>
    Effect.gen(function* () {
      const caller = yield* mainCaller;
      return yield* ProjectMemory.archiveTask(caller.root, path, {
        author: "agent",
        source: caller.source,
        threadId: caller.threadId,
      }).pipe(Effect.mapError(asFailure));
    }),
  ),
});
