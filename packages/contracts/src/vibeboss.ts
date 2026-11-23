import * as Schema from "effect/Schema";

/** The three agents VibeBoss writes global rule files for. */
export const VibeBossAgentKind = Schema.Literals(["claude", "codex", "agy"]);
export type VibeBossAgentKind = typeof VibeBossAgentKind.Type;

/** One row of the agent table: who to send work to, with which model, and what for. */
export const VibeBossAgentEntry = Schema.Struct({
  id: Schema.String,
  kind: VibeBossAgentKind,
  model: Schema.String,
  effort: Schema.String,
  use: Schema.String,
});
export type VibeBossAgentEntry = typeof VibeBossAgentEntry.Type;

/**
 * Rule parts. Every agent's global rule file is assembled as
 * shared + coop (with the agent table appended) + that agent's own part.
 */
export const VibeBossConfig = Schema.Struct({
  shared: Schema.String,
  coop: Schema.String,
  perAgent: Schema.Struct({
    claude: Schema.String,
    codex: Schema.String,
    agy: Schema.String,
  }),
  lead: VibeBossAgentEntry,
  helpers: Schema.Array(VibeBossAgentEntry),
});
export type VibeBossConfig = typeof VibeBossConfig.Type;

export const VibeBossRuleFile = Schema.Struct({
  kind: VibeBossAgentKind,
  path: Schema.String,
  exists: Schema.Boolean,
  current: Schema.String,
  generated: Schema.String,
  inSync: Schema.Boolean,
});
export type VibeBossRuleFile = typeof VibeBossRuleFile.Type;

export const VibeBossState = Schema.Struct({
  config: VibeBossConfig,
  files: Schema.Array(VibeBossRuleFile),
  /** Dev servers write rule files to a preview folder instead of the real agent homes. */
  previewOnly: Schema.Boolean,
  configPath: Schema.String,
});
export type VibeBossState = typeof VibeBossState.Type;

export const VibeBossSaveConfigInput = Schema.Struct({ config: VibeBossConfig });
export type VibeBossSaveConfigInput = typeof VibeBossSaveConfigInput.Type;

export const VibeBossSyncResult = Schema.Struct({
  state: VibeBossState,
  backups: Schema.Array(Schema.String),
});
export type VibeBossSyncResult = typeof VibeBossSyncResult.Type;

/** A skill, MCP server or plugin and the agents that have it installed. */
export const VibeBossCapability = Schema.Struct({
  name: Schema.String,
  kinds: Schema.Array(VibeBossAgentKind),
  /** Installed under the same name for several agents with different contents. */
  differs: Schema.Boolean,
});
export type VibeBossCapability = typeof VibeBossCapability.Type;

export const VibeBossCapabilities = Schema.Struct({
  skills: Schema.Array(VibeBossCapability),
  mcpServers: Schema.Array(VibeBossCapability),
  plugins: Schema.Array(VibeBossCapability),
});
export type VibeBossCapabilities = typeof VibeBossCapabilities.Type;

/** A provider thread's native id, as the client already has it from the thread detail. */
export const VibeBossNativeTranscriptInput = Schema.Struct({
  driver: Schema.String,
  nativeId: Schema.String,
});
export type VibeBossNativeTranscriptInput = typeof VibeBossNativeTranscriptInput.Type;

export const VibeBossNativeTranscriptResult = Schema.Struct({
  path: Schema.NullOr(Schema.String),
});
export type VibeBossNativeTranscriptResult = typeof VibeBossNativeTranscriptResult.Type;

export class VibeBossError extends Schema.TaggedError<VibeBossError>()("VibeBossError", {
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return this.detail;
  }
}
