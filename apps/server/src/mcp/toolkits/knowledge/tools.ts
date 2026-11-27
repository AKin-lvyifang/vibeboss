// VibeBoss: the knowledge base as tools every agent can call. Answers come from the local index,
// so a search costs milliseconds and returns only the passages that match.
import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as ServerConfig from "../../../config.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    FileSystem.FileSystem,
    Path.Path,
    ServerConfig.ServerConfig,
  ],
};

const Hit = Schema.Struct({
  path: Schema.String,
  file: Schema.String,
  location: Schema.String,
  text: Schema.String,
  cite: Schema.String,
});

const KnowledgeSearchTool = Tool.make("knowledge_search", {
  ...shared,
  description:
    "Search the user's local knowledge base (their own decks, documents, spreadsheets and notes) for passages that answer a question. Use it when the user asks for a file, a past version, a figure or a decision that may be in their materials. Returns matching passages with the file, the slide, sheet or section, and a `cite` string. When an answer uses a passage, name its `cite` beside the claim. Pass the question in the user's own words; `topK` defaults to 8.",
  parameters: Schema.Struct({
    query: Schema.String,
    topK: Schema.optionalKey(Schema.Number),
  }),
  success: Schema.Struct({ results: Schema.Array(Hit) }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const KnowledgeReadTool = Tool.make("knowledge_read", {
  ...shared,
  description:
    "Read one file from the user's local knowledge base as text, slides and sheets included. `path` must be a `path` returned by `knowledge_search`. Use it when the passages are not enough; long files are cut at 40,000 characters.",
  parameters: Schema.Struct({ path: Schema.String }),
  success: Schema.Struct({
    path: Schema.String,
    file: Schema.String,
    text: Schema.String,
    truncated: Schema.Boolean,
    cite: Schema.String,
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

export const KnowledgeToolkit = Toolkit.make(KnowledgeSearchTool, KnowledgeReadTool);
