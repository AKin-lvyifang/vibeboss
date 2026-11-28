import { isDelegatedAppThread, OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

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

/** Thread ids hold `:`, which Windows forbids in file names. Must match `demoFolderName` on the web. */
const demoFolderName = (threadId: string) => threadId.replace(/[^A-Za-z0-9_-]/g, "_");

/**
 * The panel a call belongs to: the calling thread's own, or for a delegated member the main
 * agent's that sent it. Each thread has its own folder, so one thread's demos never show in another.
 */
const demoPanel = Effect.gen(function* () {
  const scope = yield* McpInvocationContext.McpInvocationContext;
  if (scope.thread === undefined)
    return yield* refuse("Demos can only be handed in from a thread.");
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const projects = yield* ProjectService.ProjectService;
  const shellOf = (threadId: typeof scope.thread.threadId) =>
    threads.getThreadShell(threadId).pipe(Effect.orElseSucceed(() => null));
  const caller = yield* shellOf(scope.thread.threadId);
  if (caller === null) return yield* refuse("This thread was not found.");
  const parentId = caller.lineage.parentThreadId;
  const owner =
    isDelegatedAppThread(caller) && parentId !== null
      ? ((yield* shellOf(parentId)) ?? caller)
      : caller;
  const project = yield* projects.getById(owner.projectId).pipe(Effect.orElseSucceed(Option.none));
  if (Option.isNone(project)) return yield* refuse("This thread's project was not found.");
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  // The panel reads the same root the conversation works in: its worktree when it has one.
  const root = owner.worktreePath ?? project.value.workspaceRoot;
  const folder = path.join(root, DEMO_DIR, demoFolderName(owner.id));
  return { fs, path, root, folder };
});

type Panel = Effect.Success<typeof demoPanel>;

const Status = Schema.Struct({
  agent: Schema.String,
  progress: Schema.Number,
  waiting: Schema.optionalKey(Schema.Boolean),
});
type Status = typeof Status.Type;
const decodeStatus = Schema.decodeUnknownOption(Schema.fromJsonString(Status));
const encodeStatus = Schema.encodeEffect(Schema.fromJsonString(Status));

const fileError = (error: { readonly message: string }) =>
  refuse(`Could not read or write the demo files: ${error.message}`);

const statusFile = (panel: Panel, slot: number) =>
  panel.path.join(panel.folder, String(slot), "status.json");
const pageFile = (panel: Panel, slot: number) =>
  panel.path.join(panel.folder, String(slot), "index.html");

const readStatus = Effect.fn("DemoPanel.readStatus")(function* (panel: Panel, slot: number) {
  const file = statusFile(panel, slot);
  if (!(yield* panel.fs.exists(file))) return null;
  return Option.getOrNull(decodeStatus(yield* panel.fs.readFileString(file)));
}, Effect.mapError(fileError));

const writeStatus = Effect.fn("DemoPanel.writeStatus")(function* (
  panel: Panel,
  slot: number,
  status: Status,
) {
  yield* panel.fs.makeDirectory(panel.path.dirname(statusFile(panel, slot)), { recursive: true });
  yield* panel.fs.writeFileString(statusFile(panel, slot), `${yield* encodeStatus(status)}\n`);
}, Effect.mapError(fileError));

const openedSlot = Effect.fn("DemoPanel.openedSlot")(function* (panel: Panel, slot: number) {
  if (!(SLOTS as ReadonlyArray<number>).includes(slot)) {
    return yield* refuse("slot must be 1, 2 or 3.");
  }
  const status = yield* readStatus(panel, slot);
  if (status === null) return yield* refuse(`Slot ${slot} is not open. Call demo_open first.`);
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
        return yield* refuse(
          "This round already holds 3 demos. Pass newRound: true to start a new round.",
        );
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
        return yield* refuse(`${page} has not been written yet. Write it, then submit.`);
      }
      yield* writeStatus(panel, slot, { agent: status.agent, progress: 100 });
      return { slot, page };
    }),
  ),
});
