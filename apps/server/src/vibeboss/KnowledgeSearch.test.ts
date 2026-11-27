import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as Knowledge from "./Knowledge.ts";
import { readDocument, searchPassages } from "./KnowledgeSearch.ts";

it.effect("searches files as they are in the folder and follows them when they change", () =>
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
    yield* run(Knowledge.saveConfig({ version: 1, folder }));
    const note = path.join(folder, "续费口径.md");
    yield* fs.writeFileString(note, "# 重试规则\n自动续费失败后 3 天内重试两次。\n");
    yield* fs.writeFileString(
      path.join(folder, "演示.html"),
      "<html><body><h1>发布演示</h1><p>灰度先放 10% 用户。</p></body></html>",
    );

    const [hit] = yield* run(searchPassages("续费失败重试几次", 3, null));
    assert.strictEqual(hit?.path, "续费口径.md");
    assert.strictEqual(hit?.cite, "本地知识库 · 续费口径.md · 重试规则");
    assert.strictEqual(
      (yield* run(searchPassages("灰度放多少用户", 3, null)))[0]?.file,
      "演示.html",
    );

    const read = yield* run(readDocument("续费口径.md"));
    assert.include(read.text, "## 重试规则");
    assert.strictEqual(read.truncated, false);

    yield* fs.writeFileString(
      note,
      "# 重试规则\n改为 7 天内重试三次，仍不成功再人工跟进。\n# 降级\n仍失败则降级为免费版。\n",
    );
    const updated = yield* run(searchPassages("失败后降级", 3, null));
    assert.strictEqual(updated[0]?.location, "降级");
    assert.strictEqual(
      (yield* run(searchPassages("3 天内重试两次", 3, null))).some((item) =>
        item.text.includes("两次"),
      ),
      false,
    );
    assert.isTrue(yield* fs.exists(path.join(folder, ".vibeboss", "index.sqlite")));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
