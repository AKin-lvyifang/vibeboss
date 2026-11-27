import * as Schema from "effect/Schema";

import { VibeBossReviewModel } from "./vibeboss.ts";

export const VibeBossKnowledgeDocType = Schema.Literals([
  "md",
  "pptx",
  "docx",
  "xlsx",
  "html",
  "pdf",
  "other",
]);
export type VibeBossKnowledgeDocType = typeof VibeBossKnowledgeDocType.Type;

/** One file in the knowledge folder. Paths are relative to the folder, with `/` separators. */
export const VibeBossKnowledgeDoc = Schema.Struct({
  path: Schema.String,
  name: Schema.String,
  type: VibeBossKnowledgeDocType,
  size: Schema.Number,
  modifiedAt: Schema.String,
  /** False until the organizer has named and filed it. */
  organized: Schema.Boolean,
  /** Unorganized on purpose (its organizing was undone); the automatic run leaves it alone. */
  held: Schema.Boolean,
  /** Top-level folder; empty while unorganized. */
  category: Schema.String,
  /** Second-level folder inside the category. */
  group: Schema.String,
  /** Versions of one document share a topic. */
  topic: Schema.String,
  version: Schema.String,
  /** The document's own date, YYYY-MM-DD; empty while unorganized. */
  date: Schema.String,
  audience: Schema.String,
  summary: Schema.String,
  /** The name the file arrived with. */
  originalName: Schema.String,
  /** "changed" when the file was modified after its last upload to Feishu. */
  feishu: Schema.Literals(["none", "synced", "changed"]),
  feishuUrl: Schema.NullOr(Schema.String),
});
export type VibeBossKnowledgeDoc = typeof VibeBossKnowledgeDoc.Type;

export const VibeBossKnowledgeMove = Schema.Struct({ from: Schema.String, to: Schema.String });
export type VibeBossKnowledgeMove = typeof VibeBossKnowledgeMove.Type;

/** One organizer run, kept so it can be undone. */
export const VibeBossKnowledgeLogEntry = Schema.Struct({
  id: Schema.String,
  at: Schema.String,
  moves: Schema.Array(VibeBossKnowledgeMove),
  undone: Schema.Boolean,
});
export type VibeBossKnowledgeLogEntry = typeof VibeBossKnowledgeLogEntry.Type;

export const VibeBossKnowledgeConfig = Schema.Struct({
  version: Schema.Literal(1),
  /** Null until the user picks a folder or accepts the default. */
  folder: Schema.NullOr(Schema.String),
  /** The model that names and files documents; unset falls back to the text generation model. */
  organizerModel: Schema.optional(VibeBossReviewModel),
});
export type VibeBossKnowledgeConfig = typeof VibeBossKnowledgeConfig.Type;

export const VibeBossKnowledgeState = Schema.Struct({
  config: VibeBossKnowledgeConfig,
  defaultFolder: Schema.String,
  /** Categories in display order, including empty ones. */
  categories: Schema.Array(Schema.String),
  docs: Schema.Array(VibeBossKnowledgeDoc),
  log: Schema.Array(VibeBossKnowledgeLogEntry),
  /** The index file agents read first; null until a folder is set. */
  indexPath: Schema.NullOr(Schema.String),
});
export type VibeBossKnowledgeState = typeof VibeBossKnowledgeState.Type;

export const VibeBossKnowledgeSaveConfigInput = Schema.Struct({ config: VibeBossKnowledgeConfig });
export type VibeBossKnowledgeSaveConfigInput = typeof VibeBossKnowledgeSaveConfigInput.Type;

export const VibeBossKnowledgeOrganizeResult = Schema.Struct({
  state: VibeBossKnowledgeState,
  organized: Schema.Number,
  /** Why some files stayed unorganized, when they did. */
  modelError: Schema.NullOr(Schema.String),
});
export type VibeBossKnowledgeOrganizeResult = typeof VibeBossKnowledgeOrganizeResult.Type;

export const VibeBossKnowledgeOrganizeInput = Schema.Struct({
  /** Also organize files whose organizing was undone. */
  includeHeld: Schema.optional(Schema.Boolean),
});
export type VibeBossKnowledgeOrganizeInput = typeof VibeBossKnowledgeOrganizeInput.Type;

export const VibeBossKnowledgeUndoInput = Schema.Struct({ logId: Schema.String });
export type VibeBossKnowledgeUndoInput = typeof VibeBossKnowledgeUndoInput.Type;

/** Whether a conversation's agent is told about the knowledge base, and which part of it. */
/** A knowledge base hosted by the company's Xiaobang service, reached through an agent's MCP tools. */
export const VibeBossKnowledgeCloudLibrary = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.String,
  visibility: Schema.Literals(["public", "private"]),
  /** "ready" can be searched; the others return nothing yet. */
  status: Schema.Literals(["ready", "building", "empty"]),
});
export type VibeBossKnowledgeCloudLibrary = typeof VibeBossKnowledgeCloudLibrary.Type;

export const VibeBossKnowledgeSelection = Schema.Struct({
  enabled: Schema.Boolean,
  /** Null loads every category. */
  categories: Schema.NullOr(Schema.Array(Schema.String)),
  /** Ids of the cloud libraries this conversation also searches. */
  cloud: Schema.optional(Schema.Array(Schema.String)),
});
export type VibeBossKnowledgeSelection = typeof VibeBossKnowledgeSelection.Type;

export const VibeBossKnowledgeSelectionInput = Schema.Struct({
  threadId: Schema.String,
  /** The thread's project, which supplies the default for its new conversations. */
  projectId: Schema.NullOr(Schema.String),
});
export type VibeBossKnowledgeSelectionInput = typeof VibeBossKnowledgeSelectionInput.Type;

export const VibeBossKnowledgeSelectionState = Schema.Struct({
  /** False until a knowledge folder is set; the composer then offers nothing to load. */
  available: Schema.Boolean,
  selection: VibeBossKnowledgeSelection,
  /** The selection equals the project's default. */
  isProjectDefault: Schema.Boolean,
  categories: Schema.Array(Schema.String),
  /** The cloud libraries the user added; a conversation picks among these. */
  cloudLibraries: Schema.Array(VibeBossKnowledgeCloudLibrary),
});
export type VibeBossKnowledgeSelectionState = typeof VibeBossKnowledgeSelectionState.Type;

export const VibeBossKnowledgeSetSelectionInput = Schema.Struct({
  threadId: Schema.String,
  projectId: Schema.NullOr(Schema.String),
  selection: VibeBossKnowledgeSelection,
  /** Also make this the default for the project's new conversations. */
  asProjectDefault: Schema.optional(Schema.Boolean),
});
export type VibeBossKnowledgeSetSelectionInput = typeof VibeBossKnowledgeSetSelectionInput.Type;

/** What the Feishu sync conversation is started with. */
export const VibeBossKnowledgeFeishuSyncTask = Schema.Struct({
  /** How many files are new or changed since their last upload. */
  pending: Schema.Number,
  /** The first message of the conversation that does the upload. */
  prompt: Schema.String,
});
export type VibeBossKnowledgeFeishuSyncTask = typeof VibeBossKnowledgeFeishuSyncTask.Type;

/** Publishing the local folder to the user's own cloud library goes through a Feishu folder. */
export const VibeBossKnowledgeCloudPublish = Schema.Struct({
  targetId: Schema.NullOr(Schema.String),
  /** The user says they added the Feishu folder as the library's data source in the console. */
  sourceLinked: Schema.Boolean,
});
export type VibeBossKnowledgeCloudPublish = typeof VibeBossKnowledgeCloudPublish.Type;

export const VibeBossKnowledgeCloudState = Schema.Struct({
  /** The Xiaobang MCP server is set up for Claude; signing in happens in Claude. */
  configured: Schema.Boolean,
  libraries: Schema.Array(VibeBossKnowledgeCloudLibrary),
  publish: VibeBossKnowledgeCloudPublish,
  /** The Feishu folder local files are synced to, once a sync has created it. */
  feishuFolderUrl: Schema.NullOr(Schema.String),
  /** How many libraries the last catalog fetch saw, and when; null until one has run. */
  catalogTotal: Schema.Number,
  catalogUpdatedAt: Schema.NullOr(Schema.String),
});
export type VibeBossKnowledgeCloudState = typeof VibeBossKnowledgeCloudState.Type;

export const VibeBossKnowledgeCloudSaveInput = Schema.Struct({
  libraries: Schema.Array(VibeBossKnowledgeCloudLibrary),
  publish: VibeBossKnowledgeCloudPublish,
});
export type VibeBossKnowledgeCloudSaveInput = typeof VibeBossKnowledgeCloudSaveInput.Type;

export const VibeBossKnowledgeCloudCatalogInput = Schema.Struct({
  query: Schema.String,
  visibility: Schema.Literals(["all", "public", "private"]),
  onlyReady: Schema.Boolean,
});
export type VibeBossKnowledgeCloudCatalogInput = typeof VibeBossKnowledgeCloudCatalogInput.Type;

export const VibeBossKnowledgeCloudCatalogResult = Schema.Struct({
  total: Schema.Number,
  matched: Schema.Number,
  /** The first matches only; the user narrows the list by searching. */
  items: Schema.Array(VibeBossKnowledgeCloudLibrary),
});
export type VibeBossKnowledgeCloudCatalogResult = typeof VibeBossKnowledgeCloudCatalogResult.Type;

/** The first message of the conversation that fetches the catalog through the agent's MCP tools. */
export const VibeBossKnowledgeCloudCatalogTask = Schema.Struct({ prompt: Schema.String });
export type VibeBossKnowledgeCloudCatalogTask = typeof VibeBossKnowledgeCloudCatalogTask.Type;
