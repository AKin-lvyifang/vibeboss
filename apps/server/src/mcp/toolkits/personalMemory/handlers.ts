import { isDelegatedAppThread, OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ProviderRegistry from "../../../provider/ProviderRegistry.ts";
import * as PersonalMemory from "../../../vibeboss/PersonalMemory.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { PersonalMemoryToolkit } from "./tools.ts";

const refuse = (message: string) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message });

export const layer = McpToolAccess.toLayer(PersonalMemoryToolkit, {
  personal_memory_update: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      if (scope.thread === undefined)
        return yield* refuse("Personal memory is written from a conversation.");
      const threads = yield* ThreadManagementService.ThreadManagementService;
      const shell = yield* threads
        .getThreadShell(scope.thread.threadId)
        .pipe(Effect.orElseSucceed(() => null));
      if (shell === null) return yield* refuse("This conversation was not found.");
      if (scope.thread.subagent === true || isDelegatedAppThread(shell)) {
        return yield* refuse(
          "You are a delegated member: personal memory is read-only. Hand what is worth remembering back to the main agent.",
        );
      }
      const providers = yield* (yield* ProviderRegistry.ProviderRegistry).getProviders;
      return yield* PersonalMemory.update(
        input,
        { author: "agent", source: shell.title, threadId: scope.thread.threadId },
        providers,
      ).pipe(Effect.mapError((error) => refuse(error.detail)));
    }),
  ),
});
