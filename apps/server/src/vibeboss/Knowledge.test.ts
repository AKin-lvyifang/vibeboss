import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as Knowledge from "./Knowledge.ts";
import {
  DEFAULT_CATEGORIES,
  INDEX_FILE,
  organizedName,
  parseOrganizeAnswer,
  sanitizeSegment,
  uniquePath,
} from "./KnowledgeNaming.ts";

const inputs = [
  { file: "Q4汇报_改给技术.pptx", modifiedDate: "2026-11-27", excerpt: "" },
  { file: "Q4汇报 早会.pptx", modifiedDate: "2026-11-25", excerpt: "" },
];

it("names a file topic-version-date and drops an empty version", () => {
  assert.strictEqual(
    organizedName({ topic: "产品季度汇报", version: "早会版", date: "2026-11-25" }, "pptx"),
    "产品季度汇报-早会版-2026-11-25.pptx",
  );
  assert.strictEqual(
    organizedName({ topic: "续费失败口径", version: "", date: "2026-11-27" }, "md"),
    "续费失败口径-2026-11-27.md",
  );
});

it("keeps a model's names inside one path segment", () => {
  assert.strictEqual(sanitizeSegment("../../etc/passwd"), "etc passwd");
  assert.strictEqual(sanitizeSegment('a:b*c?"d'), "a b c d");
});

it("numbers a name that is already taken", () => {
  const taken = new Set(["业务知识/汇报/a.pptx", "业务知识/汇报/a-2.pptx"]);
  assert.strictEqual(uniquePath("业务知识/汇报/a.pptx", taken), "业务知识/汇报/a-3.pptx");
});

it("drops plans for unknown files or categories and falls back to the modified date", () => {
  const answer = JSON.stringify([
    {
      file: inputs[0]!.file,
      topic: "产品季度汇报",
      version: "技术评审版",
      date: "昨天",
      category: "业务知识",
      group: "汇报材料",
      audience: "技术评审会",
      summary: "加了架构页",
    },
    {
      file: inputs[1]!.file,
      topic: "产品季度汇报",
      version: "早会版",
      date: "2026-11-24",
      category: "别处",
      group: "",
      audience: "",
      summary: "",
    },
    {
      file: "不存在.md",
      topic: "x",
      version: "",
      date: "2026-01-01",
      category: "业务知识",
      group: "",
      audience: "",
      summary: "",
    },
  ]);
  const plans = parseOrganizeAnswer(`好的：${answer}`, inputs, DEFAULT_CATEGORIES);
  assert.strictEqual(plans.length, 1);
  assert.strictEqual(plans[0]!.date, "2026-11-27");
  assert.strictEqual(plans[0]!.group, "汇报材料");
});

const answerFor = (prompt: string) =>
  JSON.stringify(
    inputs
      .filter((input) => prompt.includes(`file: ${input.file}`))
      .map((input) => ({
        file: input.file,
        topic: "产品季度汇报",
        version: input.file.includes("早会") ? "早会版" : "技术评审版",
        date: input.modifiedDate,
        category: "业务知识",
        group: "汇报材料",
        audience: "",
        summary: "季度汇报",
      })),
  );

it.effect("organizes new files into one topic, writes the index, and undoes the run", () =>
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
    for (const input of inputs) yield* fs.writeFileString(path.join(folder, input.file), "x");

    const pending = yield* run(Knowledge.getState());
    assert.deepStrictEqual(
      pending.docs.map((doc) => doc.organized),
      [false, false],
    );

    const result = yield* run(
      Knowledge.organize(
        false,
        (prompt) => Effect.succeed(answerFor(prompt)),
        () => Effect.succeed(""),
      ),
    );
    assert.strictEqual(result.organized, 2);
    assert.strictEqual(result.modelError, null);
    assert.deepStrictEqual(
      result.state.docs.map((doc) => doc.path).toSorted(),
      [
        `业务知识/汇报材料/产品季度汇报-技术评审版-${inputs[0]!.modifiedDate}.pptx`,
        `业务知识/汇报材料/产品季度汇报-早会版-${inputs[1]!.modifiedDate}.pptx`,
      ].toSorted(),
    );
    const index = yield* fs.readFileString(path.join(folder, INDEX_FILE));
    assert.include(index, "**产品季度汇报**（2 个版本）");
    assert.include(
      index,
      `\`业务知识/汇报材料/产品季度汇报-早会版-${inputs[1]!.modifiedDate}.pptx\``,
    );

    const uploaded = result.state.docs[0]!;
    yield* fs.writeFileString(
      path.join(folder, ".vibeboss", "feishu-sync.jsonl"),
      `不是 JSON\n${JSON.stringify({ path: uploaded.path, url: "https://feishu.example/doc", at: "2999-01-01T00:00:00.000Z" })}\n`,
    );
    const synced = yield* run(Knowledge.getState());
    assert.deepStrictEqual(synced.docs.map((doc) => doc.feishu).toSorted(), ["none", "synced"]);
    const task = yield* run(Knowledge.prepareFeishuSync());
    assert.strictEqual(task.pending, 1);
    const taskFile = yield* fs.readFileString(
      path.join(folder, ".vibeboss", "feishu-sync-task.md"),
    );
    assert.notInclude(taskFile, `\`${uploaded.path}\``);
    assert.include(taskFile, "## 待同步（1 个）");
    assert.include(taskFile, path.join(folder, ".vibeboss", "feishu-root.json"));

    const undone = yield* run(Knowledge.undo(result.state.log[0]!.id));
    assert.deepStrictEqual(
      undone.docs.map((doc) => [doc.path, doc.organized, doc.held]),
      inputs
        .map((input) => input.file)
        .toSorted((left, right) => left.localeCompare(right))
        .map((file): Array<string | boolean> => [file, false, true]),
    );
    assert.strictEqual(undone.log[0]!.undone, true);
    const restored = undone.docs.find((doc) => doc.feishu === "synced");
    assert.strictEqual(restored?.feishuUrl, "https://feishu.example/doc");
    assert.strictEqual(yield* fs.exists(path.join(folder, "业务知识")), false);

    const automatic = yield* run(
      Knowledge.organize(
        false,
        () => Effect.die("held files must not reach the model"),
        () => Effect.succeed(""),
      ),
    );
    assert.strictEqual(automatic.organized, 0);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
