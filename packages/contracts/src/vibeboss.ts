import * as Schema from "effect/Schema";

/** Agents whose skills, MCP servers and plugins the capabilities page compares. */
export const VibeBossAgentKind = Schema.Literals(["claude", "codex", "agy"]);
export type VibeBossAgentKind = typeof VibeBossAgentKind.Type;

/** A named team member the lead can send work to; `@name` in the lead rules points at it. */
export const VibeBossMember = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  providerInstanceId: Schema.String,
  model: Schema.String,
  effort: Schema.String,
  /** For the user only; never written into rule files. */
  note: Schema.String,
});
export type VibeBossMember = typeof VibeBossMember.Type;

/** The one agent the user talks to; its model and effort are picked in the chat. */
export const VibeBossLead = Schema.Struct({
  providerInstanceId: Schema.String,
  note: Schema.String,
});
export type VibeBossLead = typeof VibeBossLead.Type;

export const VibeBossConfig = Schema.Struct({
  version: Schema.Literal(2),
  /** Written first into every agent's rule file; each agent's own part follows. */
  sharedRules: Schema.optional(Schema.String),
  /** Written only into the lead's rule file. `@name` expands to that member's delegate call. */
  leadRules: Schema.String,
  /** Each agent's own global rules, keyed by rule target id (claude, codex, agy, hermes). */
  perAgent: Schema.Record(Schema.String, Schema.String),
  lead: VibeBossLead,
  members: Schema.Array(VibeBossMember),
});
export type VibeBossConfig = typeof VibeBossConfig.Type;

/** One global rule file, shown for every enabled agent whose rule file VibeBoss knows. */
export const VibeBossRuleFile = Schema.Struct({
  targetId: Schema.String,
  label: Schema.String,
  driver: Schema.String,
  providerInstanceIds: Schema.Array(Schema.String),
  /** Where the agent itself reads its global rules. */
  agentPath: Schema.String,
  /** Where VibeBoss writes; differs from `agentPath` only in a development build. */
  path: Schema.String,
  isLead: Schema.Boolean,
  exists: Schema.Boolean,
  current: Schema.String,
  generated: Schema.String,
  inSync: Schema.Boolean,
});
export type VibeBossRuleFile = typeof VibeBossRuleFile.Type;

export const VibeBossState = Schema.Struct({
  config: VibeBossConfig,
  files: Schema.Array(VibeBossRuleFile),
  /** Rule file of the lead's agent, or null when that agent is disabled or has no known file. */
  leadTargetId: Schema.NullOr(Schema.String),
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
