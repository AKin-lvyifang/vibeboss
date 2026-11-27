// VibeBoss: the main agent writes project memory through these tools, so each change is checked,
// logged and can be undone. Members get a refusal: the main agent merges what they hand back.
import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { McpSchema, Tool, Toolkit } from "effect/ai";

import * as ServerConfig from "../../../config.ts";
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
    ServerConfig.ServerConfig,
  ],
};

const ProjectMemoryWriteTool = Tool.make("project_memory_write", {
  ...shared,
  description:
    "Write one file of this project's memory (the `.vibeboss-memory` folder) with its full new content. `path` is relative to that folder: `current.md`, `decisions.md`, `tasks/<name>.md`, or a `.md` under `spec/` (subfolders allowed). decisions.md only grows: keep all of its text and add new decisions at the end. Only the main agent may write; a delegated task hands its findings back instead.",
  parameters: Schema.Struct({ path: Schema.String, content: Schema.String }),
  success: Schema.Struct({ path: Schema.String }),
})
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

const ProjectMemoryArchiveTool = Tool.make("project_memory_archive", {
  ...shared,
  description:
    "Move a finished task file (`tasks/<name>.md`) of this project's memory into `archive/`.",
  parameters: Schema.Struct({ path: Schema.String }),
  success: Schema.Struct({ path: Schema.String }),
})
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

export const ProjectMemoryToolkit = Toolkit.make(ProjectMemoryWriteTool, ProjectMemoryArchiveTool);
