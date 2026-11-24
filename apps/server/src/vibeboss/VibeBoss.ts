import * as NodeOS from "node:os";

import {
  type ServerProvider,
  type VibeBossAgentKind,
  type VibeBossCapabilities,
  type VibeBossCapability,
  type VibeBossConfig,
  VibeBossConfig as VibeBossConfigSchema,
  VibeBossError,
  type VibeBossMember,
  type VibeBossNativeTranscriptInput,
  type VibeBossRuleFile,
  type VibeBossState,
  type VibeBossSyncResult,
} from "@t3tools/contracts";
import { resolveSelectableModel } from "@t3tools/shared/model";
import * as Config from "effect/Config";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";

const KINDS: ReadonlyArray<VibeBossAgentKind> = ["claude", "codex", "agy"];
const GENERATED_MARKER = "<!-- 由 VibeBoss 生成，别手改；改规则去 VibeBoss 的「规则」页 -->";

const DEFAULT_LEAD_RULES = [
  "- 小事自己做，不派：几十行的改动、修评审问题、要和页面来回对接口的，都自己做。",
  "- 大方案、大改动先交给 @reviewer 看：只给它用户原话和必要背景，不给自己的草稿；它的意见核实后再采纳，最多两轮。",
  "- 写前端交给 @frontend，写成块的后端、算法、数据处理交给 @backend；接口和验收标准你来定。",
  "- 派活写清目标、范围、验收标准；要读别的会话用 `t3_thread_read`。",
  "- 交回后你读改动、自己跑测试；不对就在同一个子会话里让它返工。",
  "- 要画草图、脑图、流程图时，写成项目里 `.vibeboss/canvas/` 下的 `.excalidraw` 文件，告诉用户在右栏打开；用户拖拽修改后会存回同一个文件，下次先读它。",
].join("\n");

const WORKER_RULES = "## 被派活时\n\n收到主控派来的任务时，只做这件事，不再往下派。";

const DEFAULT_MEMBERS: ReadonlyArray<VibeBossMember> = [
  {
    id: "reviewer",
    name: "reviewer",
    providerInstanceId: "antigravity",
    model: "Gemini 4 Neon",
    effort: "high",
    note: "review 大方案；改界面文案和交互",
  },
  {
    id: "frontend",
    name: "frontend",
    providerInstanceId: "codex",
    model: "GPT-6.2 Sol",
    effort: "xhigh",
    note: "写前端落地；测试和验收",
  },
  {
    id: "backend",
    name: "backend",
    providerInstanceId: "codex",
    model: "GPT-6.2 Astra",
    effort: "xhigh",
    note: "写成块的后端、算法、数据处理",
  },
];

const fail = (detail: string) => (cause: unknown) => new VibeBossError({ detail, cause });

const homeDir = () => NodeOS.homedir();

const optionalEnv = (name: string) =>
  Config.String(name).pipe(Config.option, Config.map(Option.getOrUndefined));

/** Agent home folders, following the same env overrides the CLIs use. */
const agentHomes = Effect.gen(function* () {
  const path = yield* Path.Path;
  const home = homeDir();
  const env = yield* Config.all({
    claude: optionalEnv("CLAUDE_CONFIG_DIR"),
    codex: optionalEnv("CODEX_HOME"),
  }).pipe(Effect.mapError(fail("读取智能体目录设置失败")));
  return {
    home,
    claude: env.claude ?? path.join(home, ".claude"),
    codex: env.codex ?? path.join(home, ".codex"),
    gemini: path.join(home, ".gemini"),
    hermes: path.join(home, ".hermes"),
  };
});

type RuleTargetId = "claude" | "codex" | "agy" | "hermes";

const RULE_TARGET_LABEL: Record<RuleTargetId, string> = {
  claude: "Claude",
  codex: "Codex",
  agy: "Agy",
  hermes: "Hermes",
};

/** Which global rule file an enabled provider reads; null when VibeBoss does not know one. */
function ruleTargetFor(provider: ServerProvider): RuleTargetId | null {
  switch (provider.driver) {
    case "claudeAgent":
      return "claude";
    case "codex":
      return "codex";
    case "antigravity":
      return "agy";
    case "acpRegistry": {
      const identity = [provider.instanceId, provider.displayName, provider.iconUrl].join(" ");
      return /hermes/i.test(identity) ? "hermes" : null;
    }
    default:
      return null;
  }
}

const ruleFilePaths = Effect.gen(function* () {
  const path = yield* Path.Path;
  const homes = yield* agentHomes;
  const files: Record<RuleTargetId, string> = {
    claude: path.join(homes.claude, "CLAUDE.md"),
    codex: path.join(homes.codex, "AGENTS.md"),
    agy: path.join(homes.gemini, "GEMINI.md"),
    hermes: path.join(homes.hermes, "SOUL.md"),
  };
  return files;
});

interface RuleTarget {
  readonly id: RuleTargetId;
  readonly driver: string;
  readonly providerInstanceIds: ReadonlyArray<string>;
}

/** Enabled providers grouped by the rule file they read, in provider order. */
export function enabledRuleTargets(
  providers: ReadonlyArray<ServerProvider>,
): ReadonlyArray<RuleTarget> {
  const targets = new Map<RuleTargetId, { driver: string; providerInstanceIds: Array<string> }>();
  for (const provider of providers) {
    const id = provider.enabled ? ruleTargetFor(provider) : null;
    if (id === null) continue;
    const target = targets.get(id) ?? { driver: provider.driver, providerInstanceIds: [] };
    target.providerInstanceIds.push(provider.instanceId);
    targets.set(id, target);
  }
  return [...targets.entries()].map(([id, target]) => ({ id, ...target }));
}

interface Paths {
  readonly dir: string;
  readonly configPath: string;
  readonly backupsDir: string;
  readonly previewOnly: boolean;
  readonly real: Record<RuleTargetId, string>;
  readonly target: (id: RuleTargetId) => string;
}

const resolvePaths = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const path = yield* Path.Path;
  const real = yield* ruleFilePaths;
  const dir = path.join(config.stateDir, "vibeboss");
  // Dev servers must never overwrite the developer's real agent rule files.
  const previewOnly = config.devUrl !== undefined;
  const paths: Paths = {
    dir,
    configPath: path.join(dir, "config.json"),
    backupsDir: path.join(dir, "backups"),
    previewOnly,
    real,
    target: (id) =>
      previewOnly ? path.join(dir, "preview", id, path.basename(real[id])) : real[id],
  };
  return paths;
});

const readTextIfExists = Effect.fn("VibeBoss.readTextIfExists")(function* (file: string) {
  const fs = yield* FileSystem.FileSystem;
  if (!(yield* fs.exists(file).pipe(Effect.mapError(fail(`读取 ${file} 失败`))))) return null;
  return yield* fs.readFileString(file).pipe(Effect.mapError(fail(`读取 ${file} 失败`)));
});

const writeText = Effect.fn("VibeBoss.writeText")(function* (file: string, text: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs
    .makeDirectory(path.dirname(file), { recursive: true })
    .pipe(
      Effect.andThen(fs.writeFileString(file, text)),
      Effect.mapError(fail(`写入 ${file} 失败`)),
    );
});

const encodeConfig = Schema.encodeEffect(Schema.fromJsonString(VibeBossConfigSchema));
const writeConfig = (file: string, config: VibeBossConfig) =>
  encodeConfig(config).pipe(
    Effect.mapError(fail("保存配置失败")),
    Effect.flatMap((json) => writeText(file, `${json}\n`)),
  );

const decodeConfig = Schema.decodeUnknownOption(Schema.fromJsonString(VibeBossConfigSchema));

// First-version config, before members had names and the shared part became lead rules.
const LegacyEntry = Schema.Struct({
  id: Schema.String,
  kind: Schema.String,
  model: Schema.String,
  effort: Schema.String,
  use: Schema.String,
});
const LegacyConfig = Schema.Struct({
  shared: Schema.String,
  coop: Schema.String,
  perAgent: Schema.Record(Schema.String, Schema.String),
  lead: LegacyEntry,
  helpers: Schema.Array(LegacyEntry),
});
const decodeLegacyConfig = Schema.decodeUnknownOption(Schema.fromJsonString(LegacyConfig));
const LEGACY_INSTANCE: Record<string, string> = {
  claude: "claudeAgent",
  codex: "codex",
  agy: "antigravity",
};
const LEGACY_NAME: Record<string, string> = {
  "agy-review": "reviewer",
  "codex-frontend": "frontend",
  "codex-backend": "backend",
};

export function migrateLegacyConfig(legacy: typeof LegacyConfig.Type): VibeBossConfig {
  const instance = (kind: string) => LEGACY_INSTANCE[kind] ?? kind;
  // The first version's default guide had no member names; the new default does.
  const keepsDefaultGuide = legacy.coop.includes("收到别人派来的任务时");
  return {
    version: 2,
    leadRules: [legacy.shared.trim(), keepsDefaultGuide ? DEFAULT_LEAD_RULES : legacy.coop.trim()]
      .filter((part) => part !== "")
      .join("\n\n"),
    perAgent: legacy.perAgent,
    lead: { providerInstanceId: instance(legacy.lead.kind), note: legacy.lead.use },
    members: legacy.helpers.map((entry) => ({
      id: entry.id,
      name: LEGACY_NAME[entry.id] ?? entry.id,
      providerInstanceId: instance(entry.kind),
      model: entry.model,
      effort: entry.effort,
      note: entry.use,
    })),
  };
}

/** First run: keep each agent's existing global rules as its own part, so syncing loses nothing. */
const importInitialConfig = Effect.fn("VibeBoss.importInitialConfig")(function* (paths: Paths) {
  const perAgent: Record<string, string> = {};
  for (const id of Object.keys(paths.real) as Array<RuleTargetId>) {
    const current = yield* readTextIfExists(paths.real[id]);
    if (current !== null) perAgent[id] = stripGenerated(current);
  }
  const config: VibeBossConfig = {
    version: 2,
    leadRules: DEFAULT_LEAD_RULES,
    perAgent,
    lead: { providerInstanceId: "claudeAgent", note: "和用户对话、出方案、做设计和验收" },
    members: DEFAULT_MEMBERS,
  };
  return config;
});

function stripGenerated(text: string): string {
  return text.startsWith(GENERATED_MARKER) ? "" : text.trim();
}

function providerLabel(providers: ReadonlyArray<ServerProvider>, instanceId: string): string {
  const provider = providers.find((item) => item.instanceId === instanceId);
  if (provider === undefined) return instanceId;
  const target = ruleTargetFor(provider);
  return provider.displayName ?? (target === null ? instanceId : RULE_TARGET_LABEL[target]);
}

const EFFORT_OPTION_IDS: ReadonlySet<string> = new Set([
  "reasoningEffort",
  "effort",
  "reasoning",
  "variant",
]);

/** The member's model as the slug `delegate_task` takes, and its effort as that model's own option. */
function delegateTarget(member: VibeBossMember, providers: ReadonlyArray<ServerProvider>) {
  const provider = providers.find((item) => item.instanceId === member.providerInstanceId);
  const models = provider?.models ?? [];
  const typed = member.model.trim();
  const slug =
    provider === undefined ? null : resolveSelectableModel(provider.driver, typed, models);
  const effortDescriptor = models
    .find((model) => model.slug === slug)
    ?.capabilities?.optionDescriptors?.find(
      (descriptor) =>
        descriptor.type === "select" &&
        (descriptor.role === "reasoning" || EFFORT_OPTION_IDS.has(descriptor.id)),
    );
  const effort = member.effort.trim().toLowerCase();
  const effortChoice =
    effortDescriptor?.type === "select" && effort !== ""
      ? effortDescriptor.options.find(
          (option) => option.id.toLowerCase() === effort || option.label.toLowerCase() === effort,
        )
      : undefined;
  return {
    providerInstanceId: member.providerInstanceId,
    ...(slug !== null ? { model: slug } : typed !== "" ? { model: typed } : {}),
    ...(effortDescriptor !== undefined && effortChoice !== undefined
      ? { options: [{ id: effortDescriptor.id, value: effortChoice.id }] }
      : {}),
  };
}

function delegateCall(member: VibeBossMember, providers: ReadonlyArray<ServerProvider>): string {
  const target = delegateTarget(member, providers);
  // When the model has no matching effort option, leave the level for the lead to look up.
  const effort =
    target.options === undefined && member.effort.trim() !== ""
      ? `；档位 ${member.effort.trim()}，按 orchestrator_capabilities 里这个智能体的档位参数传`
      : "";
  return `delegate_task，target = ${JSON.stringify(target)}${effort}`;
}

const MENTION = /@([\p{L}\p{N}_-]+)/gu;

/** `@name` stays readable and gains the member's current agent, so swapping agents needs no edit. */
function expandMentions(
  text: string,
  members: ReadonlyArray<VibeBossMember>,
  providers: ReadonlyArray<ServerProvider>,
): string {
  return text.replace(MENTION, (token, name: string) => {
    const member = members.find((item) => item.name === name);
    return member === undefined
      ? token
      : `@${name}（派给 ${providerLabel(providers, member.providerInstanceId)}）`;
  });
}

export function renderRuleFile(
  config: VibeBossConfig,
  targetId: string,
  isLead: boolean,
  providers: ReadonlyArray<ServerProvider>,
): string {
  const team = config.members
    .filter((member) => member.name.trim() !== "")
    .map(
      (member) =>
        `- @${member.name}：${providerLabel(providers, member.providerInstanceId)}。派活用 ${delegateCall(member, providers)}。`,
    )
    .join("\n");
  const leadSection =
    isLead && config.leadRules.trim() !== ""
      ? [
          "## 主控规则",
          "只在你作为主控、直接和用户对话时适用。",
          expandMentions(config.leadRules.trim(), config.members, providers),
          team === "" ? "" : `### 成员\n\n${team}`,
        ]
          .filter((part) => part !== "")
          .join("\n\n")
      : "";
  const sections = [(config.perAgent[targetId] ?? "").trim(), leadSection, WORKER_RULES].filter(
    (section) => section !== "",
  );
  return `${GENERATED_MARKER}\n\n${sections.join("\n\n")}\n`;
}

const loadConfig = Effect.fn("VibeBoss.loadConfig")(function* (paths: Paths) {
  const raw = yield* readTextIfExists(paths.configPath);
  if (raw !== null) {
    const decoded = decodeConfig(raw);
    if (Option.isSome(decoded)) return decoded.value;
    const legacy = decodeLegacyConfig(raw);
    if (Option.isSome(legacy)) {
      const migrated = migrateLegacyConfig(legacy.value);
      yield* writeConfig(paths.configPath, migrated);
      return migrated;
    }
  }
  const imported = yield* importInitialConfig(paths);
  yield* writeConfig(paths.configPath, imported);
  return imported;
});

function leadTargetId(
  config: VibeBossConfig,
  providers: ReadonlyArray<ServerProvider>,
): RuleTargetId | null {
  const lead = providers.find((item) => item.instanceId === config.lead.providerInstanceId);
  return lead === undefined || !lead.enabled ? null : ruleTargetFor(lead);
}

const buildState = Effect.fn("VibeBoss.buildState")(function* (
  paths: Paths,
  config: VibeBossConfig,
  providers: ReadonlyArray<ServerProvider>,
) {
  const leadId = leadTargetId(config, providers);
  const files: Array<VibeBossRuleFile> = [];
  for (const target of enabledRuleTargets(providers)) {
    const path = paths.target(target.id);
    const current = yield* readTextIfExists(path);
    const generated = renderRuleFile(config, target.id, target.id === leadId, providers);
    files.push({
      targetId: target.id,
      label: RULE_TARGET_LABEL[target.id],
      driver: target.driver,
      providerInstanceIds: target.providerInstanceIds,
      agentPath: paths.real[target.id],
      path,
      isLead: target.id === leadId,
      exists: current !== null,
      current: current ?? "",
      generated,
      inSync: current === generated,
    });
  }
  const state: VibeBossState = {
    config,
    files,
    leadTargetId: leadId,
    previewOnly: paths.previewOnly,
    configPath: paths.configPath,
  };
  return state;
});

export const getState = Effect.fn("VibeBoss.getState")(function* (
  providers: ReadonlyArray<ServerProvider>,
) {
  const paths = yield* resolvePaths;
  const config = yield* loadConfig(paths);
  return yield* buildState(paths, config, providers);
});

export const saveConfig = Effect.fn("VibeBoss.saveConfig")(function* (
  config: VibeBossConfig,
  providers: ReadonlyArray<ServerProvider>,
) {
  const paths = yield* resolvePaths;
  yield* writeConfig(paths.configPath, config);
  return yield* buildState(paths, config, providers);
});

/** Writes the enabled agents' rule files, backing up any file whose content would change. */
export const syncRules = Effect.fn("VibeBoss.syncRules")(function* (
  providers: ReadonlyArray<ServerProvider>,
) {
  const paths = yield* resolvePaths;
  const path = yield* Path.Path;
  const config = yield* loadConfig(paths);
  const leadId = leadTargetId(config, providers);
  const stamp = DateTime.formatIso(yield* DateTime.now).replaceAll(":", "-");
  const backups: Array<string> = [];
  for (const target of enabledRuleTargets(providers)) {
    const file = paths.target(target.id);
    const current = yield* readTextIfExists(file);
    const generated = renderRuleFile(config, target.id, target.id === leadId, providers);
    if (current === generated) continue;
    if (current !== null) {
      const backup = path.join(paths.backupsDir, stamp, `${target.id}-${path.basename(file)}`);
      yield* writeText(backup, current);
      backups.push(backup);
    }
    yield* writeText(file, generated);
  }
  const state = yield* buildState(paths, config, providers);
  const result: VibeBossSyncResult = { state, backups };
  return result;
});

const listDirNames = Effect.fn("VibeBoss.listDirNames")(function* (dir: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const names = yield* fs.readDirectory(dir).pipe(Effect.orElseSucceed(() => []));
  const dirs: Array<string> = [];
  for (const name of names) {
    if (name.startsWith(".")) continue;
    const info = yield* fs.stat(path.join(dir, name)).pipe(Effect.option);
    if (Option.isSome(info) && info.value.type === "Directory") dirs.push(name);
  }
  return dirs;
});

// Skill files are small; comparing their text directly tells whether same-named copies differ.
const fileDigest = Effect.fn("VibeBoss.fileDigest")(function* (file: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.readFileString(file).pipe(
    Effect.map((text): string | null => text.trim()),
    Effect.orElseSucceed(() => null),
  );
});

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

const readJsonKeys = (file: string, pick: (json: Record<string, unknown>) => unknown) =>
  fileDigest(file).pipe(
    Effect.map((text) => {
      const json = text === null ? Option.none() : decodeJson(text);
      if (Option.isNone(json) || json.value === null || typeof json.value !== "object") return [];
      const value = pick(json.value as Record<string, unknown>);
      return value !== null && typeof value === "object" ? Object.keys(value) : [];
    }),
  );

const readTomlTables = (file: string, prefix: string) =>
  fileDigest(file).pipe(
    Effect.map((text) => {
      if (text === null) return [];
      const names = new Set<string>();
      const pattern = new RegExp(
        `^\\[${prefix.replace(".", "\\.")}\\.("([^"]+)"|([^\\].]+))`,
        "gm",
      );
      for (const match of text.matchAll(pattern)) names.add(match[2] ?? match[3] ?? "");
      names.delete("");
      return [...names];
    }),
  );

function mergeCapabilities(
  byKind: Record<VibeBossAgentKind, ReadonlyArray<string>>,
  digests?: Map<string, Set<string>>,
): Array<VibeBossCapability> {
  const names = new Map<string, Set<VibeBossAgentKind>>();
  for (const kind of KINDS) {
    for (const name of byKind[kind]) {
      const kinds = names.get(name) ?? new Set();
      kinds.add(kind);
      names.set(name, kinds);
    }
  }
  return [...names.entries()]
    .map(([name, kinds]) => ({
      name,
      kinds: KINDS.filter((kind) => kinds.has(kind)),
      differs: (digests?.get(name)?.size ?? 0) > 1,
    }))
    .toSorted((left, right) => left.name.localeCompare(right.name));
}

/** Reads what each agent has installed. Read-only; paths follow each CLI's defaults. */
export const listCapabilities = Effect.fn("VibeBoss.listCapabilities")(function* () {
  const path = yield* Path.Path;
  const { home, claude: claudeHome, codex: codexHome } = yield* agentHomes;
  const skillDirs: Record<VibeBossAgentKind, ReadonlyArray<string>> = {
    claude: [path.join(claudeHome, "skills")],
    codex: [path.join(home, ".agents", "skills"), path.join(codexHome, "skills")],
    agy: [path.join(home, ".gemini", "skills"), path.join(home, ".gemini", "config", "skills")],
  };
  const skillsByKind = { claude: [], codex: [], agy: [] } as Record<
    VibeBossAgentKind,
    Array<string>
  >;
  const digests = new Map<string, Set<string>>();
  for (const kind of KINDS) {
    for (const dir of skillDirs[kind]) {
      for (const name of yield* listDirNames(dir)) {
        if (skillsByKind[kind].includes(name)) continue;
        skillsByKind[kind].push(name);
        const digest = yield* fileDigest(path.join(dir, name, "SKILL.md"));
        if (digest !== null) {
          const set = digests.get(name) ?? new Set();
          set.add(digest);
          digests.set(name, set);
        }
      }
    }
  }
  const mcpByKind: Record<VibeBossAgentKind, ReadonlyArray<string>> = {
    claude: yield* readJsonKeys(path.join(home, ".claude.json"), (json) => json.mcpServers),
    codex: yield* readTomlTables(path.join(codexHome, "config.toml"), "mcp_servers"),
    agy: yield* readJsonKeys(
      path.join(home, ".gemini", "config", "mcp_config.json"),
      (json) => json.mcpServers,
    ),
  };
  const pluginsByKind: Record<VibeBossAgentKind, ReadonlyArray<string>> = {
    claude: (yield* readJsonKeys(
      path.join(claudeHome, "plugins", "installed_plugins.json"),
      (json) => ("plugins" in json ? json.plugins : json),
    )).map((name) => name.split("@")[0] ?? name),
    codex: (yield* readTomlTables(path.join(codexHome, "config.toml"), "plugins")).map(
      (name) => name.split("@")[0] ?? name,
    ),
    agy: yield* listDirNames(path.join(home, ".gemini", "config", "plugins")),
  };
  const result: VibeBossCapabilities = {
    skills: mergeCapabilities(skillsByKind, digests),
    mcpServers: mergeCapabilities(mcpByKind),
    plugins: mergeCapabilities(pluginsByKind),
  };
  return result;
});

const findFile: (
  dir: string,
  matches: (name: string) => boolean,
  depth: number,
) => Effect.Effect<string | null, never, FileSystem.FileSystem | Path.Path> = Effect.fn(
  "VibeBoss.findFile",
)(function* (dir: string, matches: (name: string) => boolean, depth: number) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const names = yield* fs.readDirectory(dir).pipe(Effect.orElseSucceed(() => []));
  const subdirs: Array<string> = [];
  for (const name of names) {
    const info = yield* fs.stat(path.join(dir, name)).pipe(Effect.option);
    if (Option.isNone(info)) continue;
    if (info.value.type === "File" && matches(name)) return path.join(dir, name);
    if (info.value.type === "Directory") subdirs.push(name);
  }
  if (depth <= 0) return null;
  for (const name of subdirs.toSorted((left, right) => right.localeCompare(left))) {
    const found = yield* findFile(path.join(dir, name), matches, depth - 1);
    if (found !== null) return found;
  }
  return null;
});

/** Finds the agent's own transcript file for a provider thread, so nothing is lost in display. */
export const resolveNativeTranscript = Effect.fn("VibeBoss.resolveNativeTranscript")(function* (
  input: VibeBossNativeTranscriptInput,
) {
  const path = yield* Path.Path;
  const homes = yield* agentHomes;
  const id = input.nativeId.trim();
  if (id === "" || id.includes("/") || id.includes("..")) return { path: null };
  switch (input.driver) {
    case "claudeAgent":
      return {
        path: yield* findFile(
          path.join(homes.claude, "projects"),
          (name) => name === `${id}.jsonl`,
          1,
        ),
      };
    case "codex":
      return {
        path: yield* findFile(
          path.join(homes.codex, "sessions"),
          (name) => name.startsWith("rollout-") && name.endsWith(`${id}.jsonl`),
          3,
        ),
      };
    case "antigravity":
      return {
        path: yield* findFile(
          path.join(homes.gemini, "antigravity", "conversations"),
          (name) => name.startsWith(id),
          0,
        ),
      };
    default:
      return { path: null };
  }
});
