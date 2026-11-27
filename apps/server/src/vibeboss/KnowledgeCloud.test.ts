import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import { catalogLibrary, getCloudState, saveCloud, searchCatalog } from "./KnowledgeCloud.ts";
import { promptNote, setSelection } from "./KnowledgeSelection.ts";

it("reads a catalog entry the way Xiaobang lists it", () => {
  assert.deepStrictEqual(
    catalogLibrary({
      knowledgeId: "kb-1",
      displayName: "MCP 知识库",
      description: "调用链路",
      visibility: "public",
      ready: false,
      buildStatus: "queued",
    }),
    {
      id: "kb-1",
      name: "MCP 知识库",
      description: "调用链路",
      visibility: "public",
      status: "building",
    },
  );
  assert.strictEqual(catalogLibrary({ displayName: "没有 ID" }), null);
});

it.effect("offers only added libraries and tells the agent which ones this conversation uses", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const stateDir = yield* fs.makeTempDirectoryScoped({ prefix: "vibeboss-cloud-" });
    const run = <A, E>(
      effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | ServerConfig.ServerConfig>,
    ) =>
      effect.pipe(
        Effect.provideService(ServerConfig.ServerConfig, {
          stateDir,
        } as unknown as ServerConfig.ServerConfig["Service"]),
      );
    yield* fs.makeDirectory(path.join(stateDir, "vibeboss"), { recursive: true });
    yield* fs.writeFileString(
      path.join(stateDir, "vibeboss", "knowledge-cloud-catalog.json"),
      JSON.stringify({
        updatedAt: "2026-11-28T00:00:00.000Z",
        items: [
          {
            knowledgeId: "kb-1",
            displayName: "MCP 知识库",
            description: "调用链路",
            visibility: "public",
            ready: true,
            buildStatus: "succeeded",
          },
          {
            knowledgeId: "kb-2",
            displayName: "PC-Agent",
            description: "个人工作流",
            visibility: "private",
            ready: false,
            buildStatus: "",
          },
          { broken: true },
        ],
      }),
    );
    const found = yield* run(searchCatalog({ query: "mcp", visibility: "all", onlyReady: true }));
    assert.strictEqual(found.total, 2);
    assert.deepStrictEqual(
      found.items.map((item) => item.id),
      ["kb-1"],
    );

    const saved = yield* run(
      saveCloud({
        libraries: [
          { id: "kb-1", name: "旧名字", description: "", visibility: "public", status: "empty" },
        ],
        publish: { targetId: "kb-2", sourceLinked: true },
      }),
    );
    assert.strictEqual(saved.libraries[0]?.name, "MCP 知识库");
    assert.strictEqual(saved.libraries[0]?.status, "ready");
    assert.strictEqual((yield* run(getCloudState())).publish.sourceLinked, true);

    yield* run(
      setSelection({
        threadId: "t1",
        projectId: null,
        selection: { enabled: true, categories: null, cloud: ["kb-1", "kb-not-added"] },
      }),
    );
    const note = yield* run(promptNote({ threadId: "t1", projectId: null }));
    assert.include(note, "MCP 知识库（kb-1）");
    assert.notInclude(note, "kb-not-added");
    assert.include(note, "（程小帮 · 库名 · 文档标题）");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
