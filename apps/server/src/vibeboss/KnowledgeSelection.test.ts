import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as Knowledge from "./Knowledge.ts";
import { getSelection, knowledgeNote, promptNote, setSelection } from "./KnowledgeSelection.ts";

it("tells the agent where the index is and which categories to use", () => {
  const note = knowledgeNote("/kb", "/kb/索引.md", ["业务知识"]);
  assert.include(note, "knowledge_search");
  assert.include(note, "照工具返回的 cite 写");
  assert.include(note, "改读索引 /kb/索引.md");
  assert.include(note, "这次只用这些分类里的资料：业务知识。");
  assert.notInclude(knowledgeNote("/kb", "/kb/索引.md", null), "这次只用");
});

it.effect("a new conversation follows its project's default until it makes its own choice", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const stateDir = yield* fs.makeTempDirectoryScoped({ prefix: "vibeboss-knowledge-" });
    const folder = path.join(stateDir, "kb");
    const run = <A, E>(
      effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | ServerConfig.ServerConfig>,
    ) =>
      effect.pipe(
        Effect.provideService(ServerConfig.ServerConfig, {
          stateDir,
        } as unknown as ServerConfig.ServerConfig["Service"]),
      );
    const first = { threadId: "t1", projectId: "p1" };
    const second = { threadId: "t2", projectId: "p1" };

    assert.strictEqual((yield* run(getSelection(first))).available, false);
    assert.strictEqual(yield* run(promptNote(first)), "");

    yield* run(Knowledge.saveConfig({ version: 1, folder }));
    const saved = yield* run(
      setSelection({
        ...first,
        selection: { enabled: true, categories: ["业务知识"] },
        asProjectDefault: true,
      }),
    );
    assert.strictEqual(saved.isProjectDefault, true);
    assert.deepStrictEqual((yield* run(getSelection(second))).selection, {
      enabled: true,
      categories: ["业务知识"],
    });
    assert.include(yield* run(promptNote(second)), path.join(folder, "索引.md"));

    yield* run(setSelection({ ...second, selection: { enabled: false, categories: null } }));
    assert.strictEqual(yield* run(promptNote(second)), "");
    assert.include(yield* run(promptNote(first)), "业务知识");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
