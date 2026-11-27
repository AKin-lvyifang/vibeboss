import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as ProjectMemory from "./ProjectMemory.ts";
import * as ProjectMemoryTidy from "./ProjectMemoryTidy.ts";

const before =
  "# 现状\n\n## 正在做\n- HUD 设计已定稿\n- 知识库已合入发版分支\n\n## 下一步\n- 等其他改动一起发版\n";

it("accepts an answer that moves finished progress out of the current state", () => {
  const answer = ProjectMemoryTidy.parseTidyAnswer(
    JSON.stringify({
      current: "# 现状\n\n## 正在做\n- HUD 设计已定稿\n\n## 下一步\n- 等其他改动一起发版\n",
      expired: "- 知识库已合入发版分支",
      done: ["知识库", "不存在的任务"],
    }),
    before,
    ["知识库", "HUD"],
  );
  assert.notStrictEqual(typeof answer, "string");
  if (typeof answer !== "string") assert.deepStrictEqual(answer.done, ["知识库"]);
});

it("refuses an answer that drops a line instead of moving it", () => {
  const answer = ProjectMemoryTidy.parseTidyAnswer(
    `好的：${JSON.stringify({ current: "# 现状\n- HUD 设计已定稿\n", expired: "", done: [] })}`,
    before,
    [],
  );
  assert.strictEqual(typeof answer, "string");
  assert.include(answer as string, "丢了内容");
});

it("refuses text that is not JSON", () => {
  assert.strictEqual(
    ProjectMemoryTidy.parseTidyAnswer("整理好了", before, []),
    "模型没有给出 JSON",
  );
});

it.effect("tidies once, archives finished work, and can be undone", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const stateDir = yield* fs.makeTempDirectoryScoped({ prefix: "vibeboss-tidy-state-" });
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "vibeboss-tidy-project-" });
    const run = <A, E>(
      effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | ServerConfig.ServerConfig>,
    ) =>
      effect.pipe(
        Effect.provideService(ServerConfig.ServerConfig, {
          stateDir,
        } as unknown as ServerConfig.ServerConfig["Service"]),
      );
    const folder = path.join(root, ProjectMemory.MEMORY_FOLDER);
    const by = { author: "agent" as const, source: "会话“开工”", threadId: "t1" };
    yield* run(ProjectMemory.ensure(root, "", "user"));
    yield* run(ProjectMemory.writeFile(root, { path: "current.md", content: before }, by));
    yield* run(ProjectMemory.writeFile(root, { path: "tasks/知识库.md", content: "已完成" }, by));
    yield* run(
      ProjectMemory.writeFile(root, { path: "decisions.md", content: "# 决策\n- a\n" }, by),
    );

    const ask: ProjectMemoryTidy.Ask = () =>
      Effect.succeed(
        JSON.stringify({
          current: "# 现状\n\n## 正在做\n- HUD 设计已定稿\n\n## 下一步\n- 等其他改动一起发版\n",
          expired: "- 知识库已合入发版分支",
          done: ["知识库"],
        }),
      );
    const summary = yield* run(ProjectMemoryTidy.tidy(root, ask, "手动整理"));
    assert.strictEqual(summary, "整理：现状、归档任务“知识库”");
    assert.notInclude(yield* fs.readFileString(path.join(folder, "current.md")), "知识库");
    assert.include(
      yield* fs.readFileString(path.join(folder, "archive", "过期进度.md")),
      "知识库已合入发版分支",
    );
    assert.isTrue(yield* fs.exists(path.join(folder, "archive", "知识库.md")));
    assert.strictEqual(
      yield* fs.readFileString(path.join(folder, "decisions.md")),
      "# 决策\n- a\n",
    );
    assert.strictEqual((yield* run(ProjectMemory.readMeta(root))).sessions, 0);

    const state = yield* run(ProjectMemory.getState(root));
    yield* run(ProjectMemory.undo(root, state.recent[0]!.id));
    assert.strictEqual(yield* fs.readFileString(path.join(folder, "current.md")), before);
    assert.isTrue(yield* fs.exists(path.join(folder, "tasks", "知识库.md")));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("reminds a quiet main conversation once, and counts new conversations", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const stateDir = yield* fs.makeTempDirectoryScoped({ prefix: "vibeboss-remind-state-" });
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "vibeboss-remind-project-" });
    const note = (full: boolean) =>
      ProjectMemory.promptNote({ root, role: "main", full, source: "", threadId: "t1" }).pipe(
        Effect.provideService(ServerConfig.ServerConfig, {
          stateDir,
        } as unknown as ServerConfig.ServerConfig["Service"]),
      );
    const notes: Array<string> = [yield* note(true)];
    for (let turn = 2; turn <= 9; turn += 1) notes.push(yield* note(false));
    assert.notInclude(notes[6]!, "没更新项目记忆");
    assert.include(notes[7]!, "8 轮没更新项目记忆");
    assert.notInclude(notes[8]!, "没更新项目记忆");
    const meta = yield* ProjectMemory.readMeta(root).pipe(
      Effect.provideService(ServerConfig.ServerConfig, {
        stateDir,
      } as unknown as ServerConfig.ServerConfig["Service"]),
    );
    assert.strictEqual(meta.sessions, 1);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
