// VibeBoss: the Demo panel. Agents hand in design demos through these tools; only what comes in
// here shows in the panel. Opening a slot is also what makes the app open the panel.
import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { McpSchema, Tool, Toolkit } from "effect/ai";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    ProjectService.ProjectService,
    FileSystem.FileSystem,
    Path.Path,
  ],
};

const Slot = Schema.Number.annotate({ description: "The slot number `demo_open` returned." });

const DemoOpenTool = Tool.make("demo_open", {
  ...shared,
  description:
    "Open a slot in the Demo panel for one design demo, before you write it. The panel opens beside the conversation and shows this demo loading. Returns the slot number and the `page` path: write the demo there as a single HTML file. A round holds at most three demos; pass `newRound: true` to clear the previous round first. `agent` is who writes it: claude, codex, antigravity, or final for the merged demo. Pass `waiting: true` when this demo must wait for the others. A member writing one of the main agent's demos calls this itself; its slot joins the main agent's panel.",
  parameters: Schema.Struct({
    agent: Schema.String,
    waiting: Schema.optionalKey(Schema.Boolean),
    newRound: Schema.optionalKey(Schema.Boolean),
  }),
  success: Schema.Struct({ slot: Schema.Number, page: Schema.String }),
})
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

const DemoProgressTool = Tool.make("demo_progress", {
  ...shared,
  description:
    "Report how far a demo is, 0 to 99, so its slot in the Demo panel shows it. Report at each real step (structure, styles, interactions), not on a timer. Reporting a lower number restarts the slot, e.g. when reworking a demo after feedback.",
  parameters: Schema.Struct({ slot: Slot, progress: Schema.Number }),
  success: Schema.Struct({ slot: Schema.Number, progress: Schema.Number }),
})
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

const DemoSubmitTool = Tool.make("demo_submit", {
  ...shared,
  description:
    "Hand in a finished demo once its `page` file is complete. Its slot in the Demo panel switches from loading to the page.",
  parameters: Schema.Struct({ slot: Slot }),
  success: Schema.Struct({ slot: Schema.Number, page: Schema.String }),
})
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

export const DemoToolkit = Toolkit.make(DemoOpenTool, DemoProgressTool, DemoSubmitTool);
