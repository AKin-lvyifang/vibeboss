import { isDelegatedAppThread, OrchestratorMcpFailure } from "@t3tools/contracts";
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
const SLOTS = [1, 2, 3] as const;

/**
 * The panel a call belongs to: the calling thread's own, or for a delegated member the main
 * agent's that sent it. Each thread has its own folder, so one thread's demos never show in another.
 */
const demoPanel = Effect.gen(function* () {
  const scope = yield* McpInvocationContext.McpInvocationContext;
  if (scope.thread === undefined) return yield* refuse("Demo 只能在会话里交");
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const projects = yield* ProjectService.ProjectService;
  const shellOf = (threadId: typeof scope.thread.threadId) =>
    threads.getThreadShell(threadId).pipe(Effect.orElseSucceed(() => null));
  const caller = yield* shellOf(scope.thread.threadId);
  if (caller === null) return yield* refuse("找不到这个会话");
  const parentId = caller.lineage.parentThreadId;
  const owner =
    isDelegatedAppThread(caller) && parentId !== null
      ? ((yield* shellOf(parentId)) ?? caller)
      : caller;
  const project = yield* projects.getById(owner.projectId).pipe(Effect.orElseSucceed(Option.none));
  if (Option.isNone(project)) return yield* refuse("找不到这个会话的项目");
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  // The panel reads the same root the conversation works in: its worktree when it has one.
  const root = owner.worktreePath ?? project.value.workspaceRoot;
  const folder = path.join(root, DEMO_DIR, owner.id);
  return { fs, path, root, folder };
});

type Panel = Effect.Success<typeof demoPanel>;

interface Status {
  readonly agent: string;
  readonly progress: number;
  readonly waiting?: boolean;
}

const fileError = (error: { readonly message: string }) =>
  refuse(`Demo 文件读写失败：${error.message}`);

const statusFile = (panel: Panel, slot: number) =>
  panel.path.join(panel.folder, String(slot), "status.json");
const pageFile = (panel: Panel, slot: number) =>
  panel.path.join(panel.folder, String(slot), "index.html");

const parseStatus = (text: string): Status | null => {
  try {
    return JSON.parse(text) as Status;
  } catch {
    return null;
  }
};

const readStatus = Effect.fn("DemoPanel.readStatus")(function* (panel: Panel, slot: number) {
  const file = statusFile(panel, slot);
  if (!(yield* panel.fs.exists(file))) return null;
  return parseStatus(yield* panel.fs.readFileString(file));
}, Effect.mapError(fileError));

const writeStatus = Effect.fn("DemoPanel.writeStatus")(function* (
  panel: Panel,
  slot: number,
  status: Status,
) {
  yield* panel.fs.makeDirectory(panel.path.dirname(statusFile(panel, slot)), { recursive: true });
  yield* panel.fs.writeFileString(statusFile(panel, slot), `${JSON.stringify(status)}\n`);
}, Effect.mapError(fileError));

const openedSlot = Effect.fn("DemoPanel.openedSlot")(function* (panel: Panel, slot: number) {
  if (!(SLOTS as ReadonlyArray<number>).includes(slot)) {
    return yield* refuse("slot 只能是 1、2、3");
  }
  const status = yield* readStatus(panel, slot);
  if (status === null) return yield* refuse(`第 ${slot} 格还没开，先调 demo_open`);
  return status;
});

export const layer = McpToolAccess.toLayer(DemoToolkit, {
  demo_open: McpToolAccess.actsAsCaller(({ agent, waiting, newRound }) =>
    Effect.gen(function* () {
      const panel = yield* demoPanel;
      const ignore = panel.path.join(panel.root, DEMO_DIR, ".gitignore");
      yield* Effect.gen(function* () {
        if (newRound === true)
          yield* panel.fs.remove(panel.folder, { recursive: true, force: true });
        yield* panel.fs.makeDirectory(panel.folder, { recursive: true });
        if (!(yield* panel.fs.exists(ignore))) yield* panel.fs.writeFileString(ignore, "*\n");
      }).pipe(Effect.mapError(fileError));
      let free: number | null = null;
      for (const slot of SLOTS) {
        if ((yield* readStatus(panel, slot)) === null) {
          free = slot;
          break;
        }
      }
      if (free === null) {
        return yield* refuse("这一轮已经有 3 份 Demo 了。要重新出一轮，传 newRound: true。");
      }
      yield* writeStatus(panel, free, {
        agent: agent.trim() || "agent",
        progress: 0,
        ...(waiting === true ? { waiting: true } : {}),
      });
      return { slot: free, page: pageFile(panel, free) };
    }),
  ),
  demo_progress: McpToolAccess.actsAsCaller(({ slot, progress }) =>
    Effect.gen(function* () {
      const panel = yield* demoPanel;
      const status = yield* openedSlot(panel, slot);
      const value = Math.min(99, Math.max(0, Math.round(progress)));
      yield* writeStatus(panel, slot, { agent: status.agent, progress: value });
      return { slot, progress: value };
    }),
  ),
  demo_submit: McpToolAccess.actsAsCaller(({ slot }) =>
    Effect.gen(function* () {
      const panel = yield* demoPanel;
      const status = yield* openedSlot(panel, slot);
      const page = pageFile(panel, slot);
      if (!(yield* panel.fs.exists(page).pipe(Effect.mapError(fileError)))) {
        return yield* refuse(`还没写 ${page}，写完再交`);
      }
      yield* writeStatus(panel, slot, { agent: status.agent, progress: 100 });
      return { slot, page };
    }),
  ),
});
