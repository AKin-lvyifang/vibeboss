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
