import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as ProjectMemory from "./ProjectMemory.ts";

it("accepts only the memory layout's Markdown files", () => {
  assert.deepStrictEqual(ProjectMemory.classifyPath("current.md"), {
    path: "current.md",
    kind: "current",
  });
  assert.deepStrictEqual(ProjectMemory.classifyPath("spec/界面/文案.md"), {
    path: "spec/界面/文案.md",
    kind: "spec",
  });
  assert.deepStrictEqual(ProjectMemory.classifyPath("tasks/顶部小条.md"), {
    path: "tasks/顶部小条.md",
    kind: "task",
  });
  for (const bad of ["../x.md", "spec/../../x.md", "notes.md", "tasks/a/b.md", "spec/a.txt"]) {
    assert.strictEqual(typeof ProjectMemory.classifyPath(bad), "string", bad);
  }
});

it("lets decisions only grow", () => {
  assert.isTrue(ProjectMemory.keepsEarlierText("# 决策\n- a\n", "# 决策\n- a\n- b\n"));
  assert.isFalse(ProjectMemory.keepsEarlierText("# 决策\n- a\n- b\n", "# 决策\n- b\n"));
});

it("maps a codex-memory folder onto the new layout", () => {
  const plan = ProjectMemory.planLegacyImport([
    { path: "current.md", content: "now" },
    { path: "spec/index.md", content: "rules" },
    { path: "tasks/active/hud/brief.md", content: "goal" },
    { path: "tasks/active/hud/decisions.md", content: "picked" },
    { path: "tasks/archive/old/brief.md", content: "done" },
    { path: "manifest.json", content: "{}" },
  ]);
  const byPath = Object.fromEntries(plan.map((file) => [file.path, file.content]));
  assert.deepStrictEqual(Object.keys(byPath).toSorted(), [
    "archive/old/brief.md",
    "current.md",
    "spec/index.md",
    "tasks/hud.md",
  ]);
  assert.include(byPath["tasks/hud.md"], "## brief\n\ngoal");
  assert.include(byPath["tasks/hud.md"], "## decisions\n\npicked");
});

it("tells a member the memory is read-only and the main agent how to write it", () => {
  const member = ProjectMemory.memoryNote({
    folder: "/p/.vibeboss-memory",
    role: "member",
    full: true,
    files: ["current.md"],
    current: "正在做 HUD",
    justCreated: false,
  });
  assert.include(member, "只读");
  assert.include(member, "正在做 HUD");
  assert.notInclude(member, "project_memory_write");
  const main = ProjectMemory.memoryNote({
    folder: "/p/.vibeboss-memory",
    role: "main",
    full: false,
    files: [],
    current: null,
    justCreated: false,
  });
  assert.include(main, "project_memory_write");
  assert.notInclude(main, "现有文件");
});

it.effect("creates, writes, archives and undoes, keeping later edits safe", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const stateDir = yield* fs.makeTempDirectoryScoped({ prefix: "vibeboss-memory-state-" });
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "vibeboss-memory-project-" });
    const run = <A, E>(
      effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | ServerConfig.ServerConfig>,
    ) =>
      effect.pipe(
        Effect.provideService(ServerConfig.ServerConfig, {
          stateDir,
        } as unknown as ServerConfig.ServerConfig["Service"]),
      );
    const folder = path.join(root, ProjectMemory.MEMORY_FOLDER);
    yield* fs.makeDirectory(path.join(root, ".codex-memory"));
    yield* fs.writeFileString(path.join(root, ".codex-memory", "current.md"), "旧现状");

    // The first main conversation creates the memory and copies the old one in.
    const note = yield* run(
      ProjectMemory.promptNote({
        root,
        role: "main",
        full: true,
        source: "会话“开工”",
        threadId: "t1",
      }),
    );
    assert.include(note, "旧现状");
    assert.strictEqual(yield* fs.readFileString(path.join(folder, "current.md")), "旧现状");
    assert.isTrue(yield* fs.exists(path.join(root, ".codex-memory", "current.md")));

    const by = { author: "agent" as const, source: "会话“开工”" };
    yield* run(
      ProjectMemory.writeFile(root, { path: "decisions.md", content: "# 决策\n- a\n" }, by),
    );
    const shrink = yield* run(
      ProjectMemory.writeFile(root, { path: "decisions.md", content: "# 决策\n" }, by),
    ).pipe(Effect.flip);
    assert.include(shrink.detail, "追加");

    yield* run(ProjectMemory.writeFile(root, { path: "tasks/hud.md", content: "目标" }, by));
    const archived = yield* run(ProjectMemory.archiveTask(root, "tasks/hud.md", by));
    assert.strictEqual(archived.path, "archive/hud.md");
    assert.isFalse(yield* fs.exists(path.join(folder, "tasks", "hud.md")));

    const state = yield* run(ProjectMemory.getState(root));
    assert.isTrue(state.exists);
    assert.isTrue(state.legacy);
    assert.strictEqual(state.recent[0]?.summary, "归档任务“hud”");
    assert.strictEqual(state.recent[1]?.summary, "新建任务“hud”");

    // Undoing the archive puts the task back.
    yield* run(ProjectMemory.undo(root, state.recent[0]!.id));
    assert.strictEqual(yield* fs.readFileString(path.join(folder, "tasks", "hud.md")), "目标");
    assert.isFalse(yield* fs.exists(path.join(folder, "archive", "hud.md")));

    // An undo that would throw away a later edit is refused.
    const write = yield* run(
      ProjectMemory.writeFile(root, { path: "current.md", content: "新现状" }, by),
    );
    yield* run(
      ProjectMemory.writeFile(
        root,
        { path: "current.md", content: "再改一次" },
        { author: "user", source: "" },
      ),
    );
    const refused = yield* run(ProjectMemory.undo(root, write.logId!)).pipe(Effect.flip);
    assert.include(refused.detail, "之后又改过");

    const log = yield* run(ProjectMemory.getLog(root));
    assert.strictEqual(log.entries.at(-1)?.summary, "建立项目记忆，照搬 Codex 旧记忆");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("leaves a project without memory alone for a member", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const stateDir = yield* fs.makeTempDirectoryScoped({ prefix: "vibeboss-memory-state-" });
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "vibeboss-memory-project-" });
    const note = yield* ProjectMemory.promptNote({
      root,
      role: "member",
      full: true,
      source: "",
      threadId: "t1",
    }).pipe(
      Effect.provideService(ServerConfig.ServerConfig, {
        stateDir,
      } as unknown as ServerConfig.ServerConfig["Service"]),
    );
    assert.strictEqual(note, "");
    assert.isFalse(yield* fs.exists(path.join(root, ProjectMemory.MEMORY_FOLDER)));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
