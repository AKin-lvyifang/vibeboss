// VibeBoss: the company's Xiaobang knowledge bases, used beside the local folder. VibeBoss never
// calls Xiaobang itself; agents reach it through the MCP server set up for them. What lives here
// is only what the user picked: which libraries to offer, and how the local folder gets published.
import * as NodeOS from "node:os";

import type {
  VibeBossKnowledgeCloudCatalogInput,
  VibeBossKnowledgeCloudCatalogResult,
  VibeBossKnowledgeCloudLibrary,
  VibeBossKnowledgeCloudSaveInput,
  VibeBossKnowledgeCloudState,
} from "@t3tools/contracts";
import {
  VibeBossError,
  VibeBossKnowledgeCloudLibrary as CloudLibrarySchema,
  VibeBossKnowledgeCloudPublish,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";
import { readFolder } from "./Knowledge.ts";

const MCP_URL_PART = "xiaobang-mcp";
const CATALOG_PAGE = 20;

const Store = Schema.Struct({
  version: Schema.Literal(1),
  libraries: Schema.Array(CloudLibrarySchema),
  publish: VibeBossKnowledgeCloudPublish,
});
type Store = typeof Store.Type;
const EMPTY: Store = {
  version: 1,
  libraries: [],
  publish: { targetId: null, sourceLinked: false },
};

const decodeStore = Schema.decodeUnknownOption(Schema.fromJsonString(Store));
const encodeStore = Schema.encodeEffect(Schema.fromJsonString(Store));
const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

const paths = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const path = yield* Path.Path;
  const dir = path.join(config.stateDir, "vibeboss");
  return {
    store: path.join(dir, "knowledge-cloud.json"),
    catalog: path.join(dir, "knowledge-cloud-catalog.json"),
  };
});

const readJson = Effect.fn("VibeBossKnowledgeCloud.readJson")(function* (file: string) {
  const fs = yield* FileSystem.FileSystem;
  const raw = yield* fs.readFileString(file).pipe(Effect.option);
  return Option.isNone(raw) ? Option.none<unknown>() : decodeJson(raw.value);
});

const loadStore = Effect.fn("VibeBossKnowledgeCloud.loadStore")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const raw = yield* fs.readFileString((yield* paths).store).pipe(Effect.option);
  return Option.isNone(raw) ? EMPTY : Option.getOrElse(decodeStore(raw.value), () => EMPTY);
});

const text = (value: unknown) => (typeof value === "string" ? value : "");

/** One catalog entry as the agent saved it from Xiaobang's `list-knowledge-bases`. */
export function catalogLibrary(entry: unknown): VibeBossKnowledgeCloudLibrary | null {
  if (entry === null || typeof entry !== "object") return null;
  const id = text(Reflect.get(entry, "knowledgeId"));
  const name = text(Reflect.get(entry, "displayName"));
  if (id === "" || name === "") return null;
  const build = text(Reflect.get(entry, "buildStatus"));
  return {
    id,
    name,
    description: text(Reflect.get(entry, "description")),
    visibility: Reflect.get(entry, "visibility") === "private" ? "private" : "public",
    status:
      Reflect.get(entry, "ready") === true
        ? "ready"
        : build === "queued" || build === "running" || build === "building"
          ? "building"
          : "empty",
  };
}

const loadCatalog = Effect.fn("VibeBossKnowledgeCloud.loadCatalog")(function* () {
  const json = yield* readJson((yield* paths).catalog);
  if (Option.isNone(json) || json.value === null || typeof json.value !== "object") {
    return { updatedAt: null as string | null, items: [] as Array<VibeBossKnowledgeCloudLibrary> };
  }
  const raw: unknown = Reflect.get(json.value, "items");
  const items = (Array.isArray(raw) ? raw : []).flatMap((entry) => {
    const library = catalogLibrary(entry);
    return library === null ? [] : [library];
  });
  return { updatedAt: text(Reflect.get(json.value, "updatedAt")) || null, items };
});

/** True when Claude's own config names the Xiaobang MCP server; signing in happens in Claude. */
const mcpConfigured = Effect.fn("VibeBossKnowledgeCloud.mcpConfigured")(function* () {
  const path = yield* Path.Path;
  const json = yield* readJson(path.join(NodeOS.homedir(), ".claude.json"));
  if (Option.isNone(json) || json.value === null || typeof json.value !== "object") return false;
  const servers: unknown = Reflect.get(json.value, "mcpServers");
  if (servers === null || typeof servers !== "object") return false;
  return Object.entries(servers).some(
    ([name, server]) =>
      name.includes(MCP_URL_PART) ||
      (server !== null &&
        typeof server === "object" &&
        text(Reflect.get(server, "url")).includes(MCP_URL_PART)),
  );
});

const feishuFolderUrl = Effect.fn("VibeBossKnowledgeCloud.feishuFolderUrl")(function* () {
  const path = yield* Path.Path;
  const folder = yield* readFolder();
  if (folder === null) return null;
  const json = yield* readJson(path.join(folder, ".vibeboss", "feishu-root.json"));
  return Option.isSome(json) && json.value !== null && typeof json.value === "object"
    ? text(Reflect.get(json.value, "url")) || null
    : null;
});

const buildState = Effect.fn("VibeBossKnowledgeCloud.buildState")(function* (store: Store) {
  const catalog = yield* loadCatalog();
  // The catalog knows a library's latest build state; what the user saved may be days old.
  const fresh = new Map(catalog.items.map((item) => [item.id, item]));
  const state: VibeBossKnowledgeCloudState = {
    configured: yield* mcpConfigured(),
    libraries: store.libraries.map((library) => fresh.get(library.id) ?? library),
    publish: store.publish,
    feishuFolderUrl: yield* feishuFolderUrl(),
    catalogTotal: catalog.items.length,
    catalogUpdatedAt: catalog.updatedAt,
  };
  return state;
});

export const getCloudState = Effect.fn("VibeBossKnowledgeCloud.getState")(function* () {
  return yield* buildState(yield* loadStore());
});

/** The libraries the user added, for the composer's menu and the prompt note. */
export const addedLibraries = Effect.fn("VibeBossKnowledgeCloud.addedLibraries")(
  function* () {
    return (yield* getCloudState()).libraries;
  },
  Effect.orElseSucceed((): ReadonlyArray<VibeBossKnowledgeCloudLibrary> => []),
);

export const saveCloud = Effect.fn("VibeBossKnowledgeCloud.save")(function* (
  input: VibeBossKnowledgeCloudSaveInput,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = (yield* paths).store;
  const store: Store = { version: 1, libraries: input.libraries, publish: input.publish };
  const fail = (cause: unknown) => new VibeBossError({ detail: "保存云端知识库设置失败", cause });
  const json = yield* encodeStore(store).pipe(Effect.mapError(fail));
  yield* fs
    .makeDirectory(path.dirname(file), { recursive: true })
    .pipe(Effect.andThen(fs.writeFileString(file, `${json}\n`)), Effect.mapError(fail));
  return yield* buildState(store);
});

export const searchCatalog = Effect.fn("VibeBossKnowledgeCloud.searchCatalog")(function* (
  input: VibeBossKnowledgeCloudCatalogInput,
) {
  const catalog = yield* loadCatalog();
  const query = input.query.trim().toLowerCase();
  const matches = catalog.items.filter(
    (item) =>
      (input.visibility === "all" || item.visibility === input.visibility) &&
      (!input.onlyReady || item.status === "ready") &&
      (query === "" || `${item.name} ${item.description} ${item.id}`.toLowerCase().includes(query)),
  );
  const result: VibeBossKnowledgeCloudCatalogResult = {
    total: catalog.items.length,
    matched: matches.length,
    items: matches.slice(0, CATALOG_PAGE),
  };
  return result;
});

/** The message that has an agent fetch every visible library and save the list for the picker. */
export const prepareCatalog = Effect.fn("VibeBossKnowledgeCloud.prepareCatalog")(function* () {
  const file = (yield* paths).catalog;
  return {
    prompt: [
      "用程小帮 MCP 的 list-knowledge-bases 工具，把我能看到的知识库全部列出来（limit 填 100，从 page 1 翻到最后一页，不要只取第一页）。",
      `然后把结果写进 ${file}，内容是一个 JSON 对象：{"updatedAt":"当前时间，ISO 8601 格式","items":[…]}，items 里原样放每个知识库的 knowledgeId、displayName、description、visibility、ready、buildStatus 六个字段，不要改名、不要省略。`,
      "写完只告诉我一共多少个、其中多少个可检索。没有程小帮工具或提示未登录时，直接告诉我需要先在 Claude 里登录程小帮 MCP。",
    ].join("\n"),
  };
});

/** What a conversation that also uses cloud libraries is told, after the local part. */
export function cloudNote(libraries: ReadonlyArray<VibeBossKnowledgeCloudLibrary>): string {
  if (libraries.length === 0) return "";
  return [
    "<cloud_knowledge_bases>",
    "这个会话还加载了下面这些程小帮云端知识库，放的是团队资料：",
    ...libraries.map((library) => `- ${library.name}（${library.id}）：${library.description}`),
    "要查团队资料时，用程小帮 MCP 的 search-knowledge 工具，knowledgeIds 只填上面列出的 ID，不要搜别的库；需要全文再用 get-document。本地资料仍用 knowledge_search。",
    "用到云端内容时同样在那句话后面标来源，写成（程小帮 · 库名 · 文档标题）。",
    "没有程小帮工具时，告诉用户云端知识库这次用不了，只用本地的。",
    "</cloud_knowledge_bases>",
  ].join("\n");
}
