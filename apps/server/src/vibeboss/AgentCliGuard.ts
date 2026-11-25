// VibeBoss: inside a VibeBoss thread, agents hand work to other agents with delegate_task so it
// shows as a child thread. Running another agent's CLI from the shell would hide that work, so
// Claude gets a pre-tool check and Codex/Antigravity shells get stand-in commands that refuse.
import type { HookCallback } from "@anthropic-ai/claude-agent-sdk";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";

const AGENT_CLI_NAMES: ReadonlyArray<string> = ["agy", "antigravity", "codex", "claude", "gemini"];

// Words that run the command after them, so the agent CLI can hide behind them.
const COMMAND_PREFIXES = new Set([
  "sudo",
  "env",
  "command",
  "exec",
  "nohup",
  "time",
  "nice",
  "xargs",
  "npx",
  "bunx",
]);

function agentCliRefusal(name: string): string {
  return `VibeBoss：这里不能直接运行 ${name}。派活请用 delegate_task 工具，任务会在 VibeBoss 里开成子会话，用户能看到。`;
}

/** The agent CLI a shell command starts, if any, looking at every command a pipeline or list runs. */
export function agentCliInCommand(command: string): string | null {
  for (const segment of command.split(/&&|\|\||[;|&\n`()]|\$\(/)) {
    const words = segment
      .trim()
      .split(/\s+/)
      .filter((word) => word !== "");
    let index = 0;
    while (
      index < words.length &&
      (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index]!) || COMMAND_PREFIXES.has(words[index]!))
    ) {
      index += 1;
    }
    const first = words[index];
    if (first === undefined) continue;
    const name =
      first
        .replace(/^["']|["']$/g, "")
        .split("/")
        .at(-1) ?? "";
    if (AGENT_CLI_NAMES.includes(name)) return name;
  }
  return null;
}

/** Claude PreToolUse hook: refuses a Bash call that starts another agent's CLI. */
export const claudeAgentCliGuard: HookCallback = (input) => {
  const toolInput = input.hook_event_name === "PreToolUse" ? input.tool_input : undefined;
  const command =
    toolInput !== null && typeof toolInput === "object" ? Reflect.get(toolInput, "command") : null;
  const name = typeof command === "string" ? agentCliInCommand(command) : null;
  return Promise.resolve(
    name === null
      ? {}
      : {
          hookSpecificOutput: {
            hookEventName: "PreToolUse" as const,
            permissionDecision: "deny" as const,
            permissionDecisionReason: agentCliRefusal(name),
          },
        },
  );
};

/**
 * Writes the stand-in commands and returns their folder, to put first on an agent shell's PATH.
 * Windows shells look up .cmd files instead, so there it returns null.
 */
export const ensureAgentCliGuard = Effect.fn("AgentCliGuard.ensure")(function* (
  fs: FileSystem.FileSystem,
  stateDir: string,
  platform: NodeJS.Platform,
) {
  if (platform === "win32") return null;
  const dir = `${stateDir}/vibeboss/agent-cli-guard`;
  yield* fs.makeDirectory(dir, { recursive: true });
  for (const name of AGENT_CLI_NAMES) {
    const file = `${dir}/${name}`;
    yield* fs.writeFileString(file, `#!/bin/sh\necho '${agentCliRefusal(name)}' >&2\nexit 126\n`);
    yield* fs.chmod(file, 0o755);
  }
  return dir;
});

/** PATH with the guard folder first; without a known PATH there is nothing safe to prepend to. */
export function withAgentCliGuardPath(
  guardDir: string | null,
  pathValue: string | undefined,
): string | undefined {
  return guardDir === null || pathValue === undefined || pathValue === ""
    ? pathValue
    : `${guardDir}:${pathValue}`;
}
