import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { DemoToolkit } from "./tools.ts";

const refuse = (message: string) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message });

/** Must match `VIBEBOSS_DEMO_DIR` in the web app's `vibebossDemos.ts`. */
const DEMO_DIR = ".vibeboss/demo";

export const layer = McpToolAccess.toLayer(DemoToolkit, {
  demo_panel_open: McpToolAccess.actsAsCaller(({ count }) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      if (scope.thread === undefined) return yield* refuse("Demo 面板只能在会话里打开");
      const threads = yield* ThreadManagementService.ThreadManagementService;
      const projects = yield* ProjectService.ProjectService;
      const shell = yield* threads
        .getThreadShell(scope.thread.threadId)
        .pipe(Effect.orElseSucceed(() => null));
      if (shell === null) return yield* refuse("找不到这个会话");
      const project = yield* projects
        .getById(shell.projectId)
        .pipe(Effect.orElseSucceed(Option.none));
      if (Option.isNone(project)) return yield* refuse("找不到这个会话的项目");
      // The panel reads the same root the conversation works in: its worktree when it has one.
      const root = shell.worktreePath ?? project.value.workspaceRoot;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const folder = path.join(root, DEMO_DIR);
      const ignore = path.join(folder, ".gitignore");
      yield* Effect.gen(function* () {
        yield* fs.makeDirectory(folder, { recursive: true });
        if (!(yield* fs.exists(ignore))) yield* fs.writeFileString(ignore, "*\n");
      }).pipe(Effect.mapError((error) => refuse(`建不了 Demo 文件夹：${error.message}`)));
      const slots = Math.min(3, Math.max(1, Math.round(count ?? 3)));
      const pages = Array.from({ length: slots }, (_, index) =>
        path.join(folder, String(index + 1), "index.html"),
      );
      return { folder, pages };
    }),
  ),
});
