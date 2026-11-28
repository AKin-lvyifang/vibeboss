// VibeBoss: the main agent keeps the user's personal memory current through this tool, so each
// change is checked, logged and synced into every agent's rule file. Members get a refusal.
import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { McpSchema, Tool, Toolkit } from "effect/ai";

import * as ServerConfig from "../../../config.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ProviderRegistry from "../../../provider/ProviderRegistry.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const PersonalMemoryUpdateTool = Tool.make("personal_memory_update", {
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    ProviderRegistry.ProviderRegistry,
    FileSystem.FileSystem,
    Path.Path,
    ServerConfig.ServerConfig,
  ],
  description:
    "Edit the user's personal memory, the first part of every agent's global rules. `remove` takes lines exactly as they are written now; `add` takes short new lines, placed under the `section` heading (created when missing). To reword a line, remove the old one and add the new one. Only the main agent may write.",
  parameters: Schema.Struct({
    section: Schema.optional(Schema.String),
    add: Schema.optional(Schema.Array(Schema.String)),
    remove: Schema.optional(Schema.Array(Schema.String)),
  }),
  success: Schema.Struct({ characters: Schema.Number }),
})
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

export const PersonalMemoryToolkit = Toolkit.make(PersonalMemoryUpdateTool);
