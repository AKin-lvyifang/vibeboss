import * as Schema from "effect/Schema";

import { ProjectId } from "./baseSchemas.ts";

/**
 * Project memory: plain Markdown files in the project's `.vibeboss-memory/` folder, shared by
 * every agent that works on the project. Paths are relative to that folder, with `/` separators.
 */
export const VibeBossMemoryKind = Schema.Literals([
  "current",
  "decisions",
  "spec",
  "task",
  "archive",
]);
export type VibeBossMemoryKind = typeof VibeBossMemoryKind.Type;

export const VibeBossMemoryFile = Schema.Struct({
  path: Schema.String,
  kind: VibeBossMemoryKind,
  /** The file name without `.md`. */
  title: Schema.String,
  modifiedAt: Schema.String,
  size: Schema.Number,
});
export type VibeBossMemoryFile = typeof VibeBossMemoryFile.Type;

export const VibeBossMemoryAuthor = Schema.Literals(["agent", "user", "system"]);
export type VibeBossMemoryAuthor = typeof VibeBossMemoryAuthor.Type;

/** One change to the memory files, kept 90 days so it can be undone. */
export const VibeBossMemoryLogEntry = Schema.Struct({
  id: Schema.String,
  at: Schema.String,
  author: VibeBossMemoryAuthor,
  /** What changed, in the user's words: "现状", "新建项目规范“文案”". */
  summary: Schema.String,
  /** Where the change came from: a conversation's title, or empty for a manual edit. */
  source: Schema.String,
  paths: Schema.Array(Schema.String),
  undone: Schema.Boolean,
});
export type VibeBossMemoryLogEntry = typeof VibeBossMemoryLogEntry.Type;

export const VibeBossMemoryState = Schema.Struct({
  /** False when the project folder is missing or this environment cannot reach it. */
  available: Schema.Boolean,
  exists: Schema.Boolean,
  folder: Schema.String,
  /** The project has a `.codex-memory/` folder that can be copied in. */
  legacy: Schema.Boolean,
  files: Schema.Array(VibeBossMemoryFile),
  /** The newest entries, at most five. */
  recent: Schema.Array(VibeBossMemoryLogEntry),
  logCount: Schema.Number,
});
export type VibeBossMemoryState = typeof VibeBossMemoryState.Type;

export const VibeBossMemoryProjectInput = Schema.Struct({ projectId: ProjectId });
export type VibeBossMemoryProjectInput = typeof VibeBossMemoryProjectInput.Type;

export const VibeBossMemoryFileInput = Schema.Struct({ projectId: ProjectId, path: Schema.String });
export type VibeBossMemoryFileInput = typeof VibeBossMemoryFileInput.Type;

export const VibeBossMemoryFileContent = Schema.Struct({
  path: Schema.String,
  content: Schema.String,
});
export type VibeBossMemoryFileContent = typeof VibeBossMemoryFileContent.Type;

export const VibeBossMemoryWriteInput = Schema.Struct({
  projectId: ProjectId,
  path: Schema.String,
  content: Schema.String,
});
export type VibeBossMemoryWriteInput = typeof VibeBossMemoryWriteInput.Type;

export const VibeBossMemoryUndoInput = Schema.Struct({
  projectId: ProjectId,
  logId: Schema.String,
});
export type VibeBossMemoryUndoInput = typeof VibeBossMemoryUndoInput.Type;

export const VibeBossMemoryLog = Schema.Struct({ entries: Schema.Array(VibeBossMemoryLogEntry) });
export type VibeBossMemoryLog = typeof VibeBossMemoryLog.Type;
