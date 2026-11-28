import { assert, it } from "@effect/vitest";

import * as PersonalMemory from "./PersonalMemory.ts";

const memory =
  "# About me\n\n## Communication\n- Answer in English.\n- Lead with the conclusion.\n\n## Tools\n- Use pnpm.\n";

it("adds lines under an existing section", () => {
  const next = PersonalMemory.applyUpdate(memory, {
    section: "Communication",
    add: ["Keep commit messages short"],
  });
  assert.strictEqual(
    next,
    "# About me\n\n## Communication\n- Answer in English.\n- Lead with the conclusion.\n- Keep commit messages short\n\n## Tools\n- Use pnpm.\n",
  );
});

it("creates a missing section at the end and skips lines already there", () => {
  const next = PersonalMemory.applyUpdate(memory, {
    section: "## Design",
    add: ["- No secondary labels", "Use pnpm."],
  });
  assert.isTrue(next.endsWith("- Use pnpm.\n\n## Design\n- No secondary labels\n"));
  assert.strictEqual(next.match(/Use pnpm/g)?.length, 1);
});

it("rewords a line by removing the old one and adding the new one", () => {
  const next = PersonalMemory.applyUpdate(memory, {
    section: "Tools",
    remove: ["- Use pnpm."],
    add: ["Use vp for every script"],
  });
  assert.isFalse(next.includes("Use pnpm."));
  assert.isTrue(next.endsWith("## Tools\n- Use vp for every script\n"));
});

it("refuses to remove a line that is not there", () => {
  assert.throws(
    () => PersonalMemory.applyUpdate(memory, { remove: ["- Use yarn."] }),
    /not in personal memory/,
  );
});

it("starts an empty memory", () => {
  assert.strictEqual(
    PersonalMemory.applyUpdate("", { section: "Communication", add: ["Call me Sam"] }),
    "## Communication\n- Call me Sam\n",
  );
});

it("logs only the lines that came and went", () => {
  assert.deepStrictEqual(
    PersonalMemory.diffLines(memory, memory.replace("- Use pnpm.", "- Use vp.")),
    { added: ["- Use vp."], removed: ["- Use pnpm."] },
  );
});

it("drops injected context and long pastes from user messages", () => {
  assert.strictEqual(
    PersonalMemory.cleanMessage("<system-reminder>ignore me</system-reminder>\nKeep it short"),
    "Keep it short",
  );
  assert.isNull(PersonalMemory.cleanMessage("x".repeat(7000)));
  assert.isNull(PersonalMemory.cleanMessage("<context>only context</context>"));
});

it("groups messages by conversation into batches", () => {
  const batches = PersonalMemory.batchMessages([
    { threadId: "a", title: "Fix login", createdAt: "1", text: "Use pnpm" },
    { threadId: "b", title: "", createdAt: "2", text: "Answer in English" },
    { threadId: "a", title: "Fix login", createdAt: "3", text: "Run the tests" },
  ]);
  assert.deepStrictEqual(batches, [
    "## Fix login\n- Use pnpm\n- Run the tests\n\n## Untitled\n- Answer in English\n\n",
  ]);
});

it("reads candidates from a model answer with prose around the JSON", () => {
  assert.deepStrictEqual(
    PersonalMemory.parseCandidates(
      'Sure: {"items":[{"topic":"tone","line":"Be brief","count":3},{"line":""}]}',
    ),
    [{ topic: "tone", line: "Be brief", count: 3 }],
  );
  assert.deepStrictEqual(PersonalMemory.parseCandidates("no json"), []);
});

it("accepts a merged document and strips code fences", () => {
  const doc = PersonalMemory.parseMergeAnswer(
    "```markdown\n# About me\n\n## Tools\n- Use vp.\n```",
    "",
    [],
  );
  assert.strictEqual(doc, "# About me\n\n## Tools\n- Use vp.\n");
});

it("refuses a merged document that drops a line the user wrote by hand", () => {
  const doc = PersonalMemory.parseMergeAnswer("# About me\n\n## Tools\n- Use vp.\n", memory, [
    "- Lead with the conclusion.",
  ]);
  assert.strictEqual(typeof doc, "object");
});

it("refuses an answer without any rule lines", () => {
  assert.strictEqual(
    typeof PersonalMemory.parseMergeAnswer("I could not decide.", "", []),
    "object",
  );
});
