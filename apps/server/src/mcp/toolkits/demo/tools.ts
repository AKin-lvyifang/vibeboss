// VibeBoss: the Demo panel. An agent calls this before writing design demos; the call itself is
// what the app watches to open the panel beside the conversation.
import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { McpSchema, Tool, Toolkit } from "effect/ai";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const DemoPanelOpenTool = Tool.make("demo_panel_open", {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    ProjectService.ProjectService,
    FileSystem.FileSystem,
    Path.Path,
  ],
  description:
    'Open the Demo panel beside this conversation so the user can compare up to three design demos while they are written. Call it once before writing demos. It returns the folder to write into: put demo N (1, 2 or 3) at `<folder>/N/index.html`, and keep `<folder>/N/status.json` up to date as you work, e.g. `{"agent":"claude","progress":40}`. `agent` is claude, codex, antigravity, or final for the merged demo; set `"waiting":true` while a demo waits on others. Write progress 100 only after index.html is complete. Pass the folder to any member who writes one of the demos.',
  parameters: Schema.Struct({
    count: Schema.optionalKey(
      Schema.Number.annotate({
        description: "How many demos will be written, 1 to 3. Defaults to 3.",
      }),
    ),
  }),
  success: Schema.Struct({ folder: Schema.String, pages: Schema.Array(Schema.String) }),
})
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

export const DemoToolkit = Toolkit.make(DemoPanelOpenTool);
