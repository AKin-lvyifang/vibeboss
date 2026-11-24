import * as NodeOS from "node:os";

import {
  type VibeBossAgentEntry,
  type VibeBossAgentKind,
  type VibeBossCapabilities,
  type VibeBossCapability,
  type VibeBossConfig,
  VibeBossConfig as VibeBossConfigSchema,
  VibeBossError,
  type VibeBossNativeTranscriptInput,
  type VibeBossRuleFile,
  type VibeBossState,
  type VibeBossSyncResult,
} from "@t3tools/contracts";
import * as Config from "effect/Config";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";

const KINDS: ReadonlyArray<VibeBossAgentKind> = ["claude", "codex", "agy"];
const AGENT_LABEL: Record<VibeBossAgentKind, string> = {
  claude: "Claude",
  codex: "Codex",
  agy: "Agy",
};
const GENERATED_MARKER = "<!-- 由 VibeBoss 生成，别手改；改规则去 VibeBoss 的「规则」页 -->";

const DEFAULT_COOP = [
  "- 你在主会话里直接和用户对话时，你就是主控。",
  "- 小事自己做，不派：几十行的改动、修评审问题、要和页面来回对接口的，都自己做。",
  "- 大方案、大改动先交给负责 review 的智能体看：只给它用户原话和必要背景，不给自己的草稿；它的意见核实后再采纳，最多两轮。没有设置就自己定。",
  "- 写代码按下面的分工派给对应的智能体，接口和验收标准你来定；没有对应的就自己写。",
  "- 派活用 delegate_task：写清目标、范围、验收标准，选对智能体和模型；要读别的会话用 t3_thread_read。",
  "- 交回后你读改动、自己跑测试；不对就在同一个子会话里让它返工。",
  "- 做完交给负责测试验收的；没有设置就自己验收。",
  "- 要画草图、脑图、流程图时，写成项目里 .vibeboss/canvas/ 下的 .excalidraw 文件，告诉用户在右栏打开；用户拖拽修改后会存回同一个文件，下次先读它。",
  "- 收到别人派来的任务时，只做这件事，不再往下派。",
].join("\n");

const DEFAULT_LEAD: VibeBossAgentEntry = {
  id: "lead",
  kind: "claude",
  model: "",
  effort: "",
  use: "和用户对话、出方案、做设计和验收",
};
const DEFAULT_HELPERS: ReadonlyArray<VibeBossAgentEntry> = [
  {
    id: "agy-review",
    kind: "agy",
    model: "Gemini 4 Neon",
    effort: "high",
    use: "review 大方案；改界面文案和交互",
  },
  {
    id: "codex-frontend",
    kind: "codex",
    model: "GPT-6.2 Sol",
    effort: "xhigh",
    use: "写前端落地；测试和验收",
  },
  {
    id: "codex-backend",
    kind: "codex",
    model: "GPT-6.2 Astra",
    effort: "xhigh",
    use: "写成块的后端、算法、数据处理",
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
  };
});

/** Where each agent reads its global rules. */
const realRuleFilePaths = Effect.gen(function* () {
  const path = yield* Path.Path;
  const homes = yield* agentHomes;
  const files: Record<VibeBossAgentKind, string> = {
    claude: path.join(homes.claude, "CLAUDE.md"),
    codex: path.join(homes.codex, "AGENTS.md"),
    agy: path.join(homes.gemini, "GEMINI.md"),
  };
  return files;
});

interface Paths {
  readonly dir: string;
  readonly configPath: string;
  readonly backupsDir: string;
  readonly previewOnly: boolean;
  readonly real: Record<VibeBossAgentKind, string>;
  readonly target: (kind: VibeBossAgentKind) => string;
}

const resolvePaths = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const path = yield* Path.Path;
  const real = yield* realRuleFilePaths;
  const dir = path.join(config.stateDir, "vibeboss");
  // Dev servers must never overwrite the developer's real agent rule files.
  const previewOnly = config.devUrl !== undefined;
  const paths: Paths = {
    dir,
    configPath: path.join(dir, "config.json"),
    backupsDir: path.join(dir, "backups"),
    previewOnly,
    real,
    target: (kind) =>
      previewOnly ? path.join(dir, "preview", kind, path.basename(real[kind])) : real[kind],
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

/** First run: keep each agent's existing global rules as its own part, so syncing loses nothing. */
const importInitialConfig = Effect.fn("VibeBoss.importInitialConfig")(function* (paths: Paths) {
  const perAgent = { claude: "", codex: "", agy: "" };
  for (const kind of KINDS) {
    const current = yield* readTextIfExists(paths.real[kind]);
    perAgent[kind] = current === null ? "" : stripGenerated(current);
  }
  const config: VibeBossConfig = {
    shared: "",
    coop: DEFAULT_COOP,
    perAgent,
    lead: DEFAULT_LEAD,
    helpers: DEFAULT_HELPERS,
  };
  return config;
});

function stripGenerated(text: string): string {
  return text.startsWith(GENERATED_MARKER) ? "" : text.trim();
}

function describeAgent(entry: VibeBossAgentEntry): string {
  return [AGENT_LABEL[entry.kind], entry.model, entry.effort]
    .filter((part) => part.trim())
    .join(" ");
}

export function renderRuleFile(config: VibeBossConfig, kind: VibeBossAgentKind): string {
  const team = [
    `- 主控：${describeAgent(config.lead)}（${config.lead.use}）`,
    ...config.helpers.map((entry) => `- ${describeAgent(entry)}：${entry.use}`),
  ].join("\n");
  const sections = [
    config.shared.trim(),
    config.coop.trim() ? `## 协作说明\n\n${config.coop.trim()}\n\n### 智能体分工\n\n${team}` : "",
    config.perAgent[kind].trim(),
  ].filter((section) => section !== "");
  return `${GENERATED_MARKER}\n\n${sections.join("\n\n")}\n`;
}

const loadConfig = Effect.fn("VibeBoss.loadConfig")(function* (paths: Paths) {
  const raw = yield* readTextIfExists(paths.configPath);
  if (raw !== null) {
    const decoded = decodeConfig(raw);
    if (decoded._tag === "Some") return decoded.value;
  }
  const imported = yield* importInitialConfig(paths);
  yield* writeConfig(paths.configPath, imported);
  return imported;
});

const buildState = Effect.fn("VibeBoss.buildState")(function* (
  paths: Paths,
  config: VibeBossConfig,
) {
  const files: Array<VibeBossRuleFile> = [];
  for (const kind of KINDS) {
    const path = paths.target(kind);
    const current = yield* readTextIfExists(path);
    const generated = renderRuleFile(config, kind);
    files.push({
      kind,
      path,
      exists: current !== null,
      current: current ?? "",
      generated,
      inSync: current === generated,
    });
  }
  const state: VibeBossState = {
    config,
    files,
    previewOnly: paths.previewOnly,
    configPath: paths.configPath,
  };
  return state;
});

export const getState = Effect.fn("VibeBoss.getState")(function* () {
  const paths = yield* resolvePaths;
  const config = yield* loadConfig(paths);
  return yield* buildState(paths, config);
});

export const saveConfig = Effect.fn("VibeBoss.saveConfig")(function* (config: VibeBossConfig) {
  const paths = yield* resolvePaths;
  yield* writeConfig(paths.configPath, config);
  return yield* buildState(paths, config);
});

/** Writes the three rule files, backing up any file whose content would change. */
export const syncRules = Effect.fn("VibeBoss.syncRules")(function* () {
  const paths = yield* resolvePaths;
  const config = yield* loadConfig(paths);
  const path = yield* Path.Path;
  const stamp = DateTime.formatIso(yield* DateTime.now).replaceAll(":", "-");
  const backups: Array<string> = [];
  for (const kind of KINDS) {
    const target = paths.target(kind);
    const current = yield* readTextIfExists(target);
    const generated = renderRuleFile(config, kind);
    if (current === generated) continue;
    if (current !== null) {
      const backup = path.join(paths.backupsDir, stamp, `${kind}-${path.basename(target)}`);
      yield* writeText(backup, current);
      backups.push(backup);
    }
    yield* writeText(target, generated);
  }
  const state = yield* buildState(paths, config);
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
