import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

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
import * as Effect from "effect/Effect";
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

/** Where each agent reads its global rules, following the same env overrides the CLIs use. */
function realRuleFilePath(kind: VibeBossAgentKind): string {
  switch (kind) {
    case "claude":
      return NodePath.join(
        process.env.CLAUDE_CONFIG_DIR ?? NodePath.join(homeDir(), ".claude"),
        "CLAUDE.md",
      );
    case "codex":
      return NodePath.join(
        process.env.CODEX_HOME ?? NodePath.join(homeDir(), ".codex"),
        "AGENTS.md",
      );
    case "agy":
      return NodePath.join(homeDir(), ".gemini", "GEMINI.md");
  }
}

interface Paths {
  readonly dir: string;
  readonly configPath: string;
  readonly backupsDir: string;
  readonly previewOnly: boolean;
  readonly target: (kind: VibeBossAgentKind) => string;
}

const resolvePaths = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const dir = NodePath.join(config.stateDir, "vibeboss");
  // Dev servers must never overwrite the developer's real agent rule files.
  const previewOnly = config.devUrl !== undefined;
  const paths: Paths = {
    dir,
    configPath: NodePath.join(dir, "config.json"),
    backupsDir: NodePath.join(dir, "backups"),
    previewOnly,
    target: (kind) =>
      previewOnly
        ? NodePath.join(dir, "preview", kind, NodePath.basename(realRuleFilePath(kind)))
        : realRuleFilePath(kind),
  };
  return paths;
});

const readTextIfExists = (path: string) =>
  Effect.tryPromise({
    try: async () => {
      try {
        return await NodeFSP.readFile(path, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    catch: fail(`读取 ${path} 失败`),
  });

const writeText = (path: string, text: string) =>
  Effect.tryPromise({
    try: async () => {
      await NodeFSP.mkdir(NodePath.dirname(path), { recursive: true });
      await NodeFSP.writeFile(path, text, "utf8");
    },
    catch: fail(`写入 ${path} 失败`),
  });

const decodeConfig = Schema.decodeUnknownOption(Schema.fromJsonString(VibeBossConfigSchema));

/** First run: keep each agent's existing global rules as its own part, so syncing loses nothing. */
const importInitialConfig = Effect.gen(function* () {
  const perAgent = { claude: "", codex: "", agy: "" };
  for (const kind of KINDS) {
    const current = yield* readTextIfExists(realRuleFilePath(kind));
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
  const imported = yield* importInitialConfig;
  yield* writeText(paths.configPath, `${JSON.stringify(imported, null, 2)}\n`);
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
  yield* writeText(paths.configPath, `${JSON.stringify(config, null, 2)}\n`);
  return yield* buildState(paths, config);
});

/** Writes the three rule files, backing up any file whose content would change. */
export const syncRules = Effect.fn("VibeBoss.syncRules")(function* () {
  const paths = yield* resolvePaths;
  const config = yield* loadConfig(paths);
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const backups: Array<string> = [];
  for (const kind of KINDS) {
    const target = paths.target(kind);
    const current = yield* readTextIfExists(target);
    const generated = renderRuleFile(config, kind);
    if (current === generated) continue;
    if (current !== null) {
      const backup = NodePath.join(paths.backupsDir, stamp, `${kind}-${NodePath.basename(target)}`);
      yield* writeText(backup, current);
      backups.push(backup);
    }
    yield* writeText(target, generated);
  }
  const state = yield* buildState(paths, config);
  const result: VibeBossSyncResult = { state, backups };
  return result;
});

const listDirNames = (dir: string) =>
  Effect.promise(async () => {
    try {
      const entries = await NodeFSP.readdir(dir, { withFileTypes: true });
      return entries
        .filter(
          (entry) => (entry.isDirectory() || entry.isSymbolicLink()) && !entry.name.startsWith("."),
        )
        .map((entry) => entry.name);
    } catch {
      return [] as Array<string>;
    }
  });

// Skill files are small; comparing their text directly tells whether same-named copies differ.
const fileDigest = (path: string) =>
  Effect.promise(async () => {
    try {
      return (await NodeFSP.readFile(path, "utf8")).trim();
    } catch {
      return null;
    }
  });

const readJsonKeys = (path: string, pick: (json: Record<string, unknown>) => unknown) =>
  Effect.promise(async () => {
    try {
      const json = JSON.parse(await NodeFSP.readFile(path, "utf8")) as Record<string, unknown>;
      const value = pick(json);
      return value !== null && typeof value === "object" ? Object.keys(value) : [];
    } catch {
      return [] as Array<string>;
    }
  });

const readTomlTables = (path: string, prefix: string) =>
  Effect.promise(async () => {
    try {
      const text = await NodeFSP.readFile(path, "utf8");
      const names = new Set<string>();
      const pattern = new RegExp(
        `^\\[${prefix.replace(".", "\\.")}\\.("([^"]+)"|([^\\].]+))`,
        "gm",
      );
      for (const match of text.matchAll(pattern)) names.add(match[2] ?? match[3] ?? "");
      names.delete("");
      return [...names];
    } catch {
      return [] as Array<string>;
    }
  });

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
  const home = homeDir();
  const claudeHome = process.env.CLAUDE_CONFIG_DIR ?? NodePath.join(home, ".claude");
  const codexHome = process.env.CODEX_HOME ?? NodePath.join(home, ".codex");
  const skillDirs: Record<VibeBossAgentKind, ReadonlyArray<string>> = {
    claude: [NodePath.join(claudeHome, "skills")],
    codex: [NodePath.join(home, ".agents", "skills"), NodePath.join(codexHome, "skills")],
    agy: [
      NodePath.join(home, ".gemini", "skills"),
      NodePath.join(home, ".gemini", "config", "skills"),
    ],
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
        const digest = yield* fileDigest(NodePath.join(dir, name, "SKILL.md"));
        if (digest !== null) {
          const set = digests.get(name) ?? new Set();
          set.add(digest);
          digests.set(name, set);
        }
      }
    }
  }
  const mcpByKind: Record<VibeBossAgentKind, ReadonlyArray<string>> = {
    claude: yield* readJsonKeys(NodePath.join(home, ".claude.json"), (json) => json.mcpServers),
    codex: yield* readTomlTables(NodePath.join(codexHome, "config.toml"), "mcp_servers"),
    agy: yield* readJsonKeys(
      NodePath.join(home, ".gemini", "config", "mcp_config.json"),
      (json) => json.mcpServers,
    ),
  };
  const pluginsByKind: Record<VibeBossAgentKind, ReadonlyArray<string>> = {
    claude: (yield* readJsonKeys(
      NodePath.join(claudeHome, "plugins", "installed_plugins.json"),
      (json) => ("plugins" in json ? json.plugins : json),
    )).map((name) => name.split("@")[0] ?? name),
    codex: (yield* readTomlTables(NodePath.join(codexHome, "config.toml"), "plugins")).map(
      (name) => name.split("@")[0] ?? name,
    ),
    agy: yield* listDirNames(NodePath.join(home, ".gemini", "config", "plugins")),
  };
  const result: VibeBossCapabilities = {
    skills: mergeCapabilities(skillsByKind, digests),
    mcpServers: mergeCapabilities(mcpByKind),
    plugins: mergeCapabilities(pluginsByKind),
  };
  return result;
});

async function findFile(
  dir: string,
  matches: (name: string) => boolean,
  depth: number,
): Promise<string | null> {
  let entries;
  try {
    entries = await NodeFSP.readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (entry.isFile() && matches(entry.name)) return NodePath.join(dir, entry.name);
  }
  if (depth <= 0) return null;
  for (const entry of entries.toSorted((left, right) => right.name.localeCompare(left.name))) {
    if (!entry.isDirectory()) continue;
    const found = await findFile(NodePath.join(dir, entry.name), matches, depth - 1);
    if (found !== null) return found;
  }
  return null;
}

/** Finds the agent's own transcript file for a provider thread, so nothing is lost in display. */
export const resolveNativeTranscript = Effect.fn("VibeBoss.resolveNativeTranscript")(function* (
  input: VibeBossNativeTranscriptInput,
) {
  const home = homeDir();
  const id = input.nativeId.trim();
  if (id === "" || id.includes("/") || id.includes("..")) return { path: null };
  const path = yield* Effect.promise(async () => {
    switch (input.driver) {
      case "claudeAgent":
        return findFile(
          NodePath.join(
            process.env.CLAUDE_CONFIG_DIR ?? NodePath.join(home, ".claude"),
            "projects",
          ),
          (name) => name === `${id}.jsonl`,
          1,
        );
      case "codex":
        return findFile(
          NodePath.join(process.env.CODEX_HOME ?? NodePath.join(home, ".codex"), "sessions"),
          (name) => name.startsWith("rollout-") && name.endsWith(`${id}.jsonl`),
          3,
        );
      case "antigravity":
        return findFile(
          NodePath.join(home, ".gemini", "antigravity", "conversations"),
          (name) => name.startsWith(id),
          0,
        );
      default:
        return null;
    }
  });
  return { path };
});
