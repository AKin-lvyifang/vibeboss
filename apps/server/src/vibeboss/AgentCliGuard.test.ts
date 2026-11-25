import { assert, it } from "@effect/vitest";

import { agentCliInCommand, claudeAgentCliGuard, withAgentCliGuardPath } from "./AgentCliGuard.ts";

it("finds another agent's CLI anywhere a command list, pipe or prefix can hide it", () => {
  assert.strictEqual(agentCliInCommand('agy -p "review" --model x'), "agy");
  assert.strictEqual(agentCliInCommand("cd ~/repo && codex exec 'fix'"), "codex");
  assert.strictEqual(
    agentCliInCommand("FOO=1 nohup /Users/me/.local/bin/claude -p hi &"),
    "claude",
  );
  assert.strictEqual(agentCliInCommand("echo start; npx gemini --help"), "gemini");
  assert.strictEqual(agentCliInCommand("out=$(antigravity models)"), "antigravity");
});

it("leaves commands that only mention an agent alone", () => {
  assert.isNull(agentCliInCommand('git commit -m "claude review"'));
  assert.isNull(agentCliInCommand("cat ~/.claude/CLAUDE.md"));
  assert.isNull(agentCliInCommand("rg codex src/"));
});

it("refuses a Bash call that starts an agent CLI and passes the rest", async () => {
  const run = (command: string) =>
    claudeAgentCliGuard(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command },
        tool_use_id: "t",
        session_id: "s",
        transcript_path: "",
        cwd: "/",
      },
      "t",
      { signal: new AbortController().signal },
    );
  const denied = await run("agy -p review");
  assert.strictEqual(
    Reflect.get(Reflect.get(denied, "hookSpecificOutput"), "permissionDecision"),
    "deny",
  );
  assert.include(
    String(Reflect.get(Reflect.get(denied, "hookSpecificOutput"), "permissionDecisionReason")),
    "delegate_task",
  );
  assert.deepStrictEqual(await run("ls -la"), {});
});

it("puts the guard folder first on PATH", () => {
  assert.strictEqual(withAgentCliGuardPath("/g", "/usr/bin:/bin"), "/g:/usr/bin:/bin");
  assert.strictEqual(withAgentCliGuardPath("/g", undefined), undefined);
  assert.strictEqual(withAgentCliGuardPath(null, "/usr/bin"), "/usr/bin");
});
