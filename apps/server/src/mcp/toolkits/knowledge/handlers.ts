import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as KnowledgeSearch from "../../../vibeboss/KnowledgeSearch.ts";
import * as KnowledgeSelection from "../../../vibeboss/KnowledgeSelection.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { KnowledgeToolkit } from "./tools.ts";

const failed = (error: { readonly message: string }) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message: error.message });

export const layer = McpToolAccess.toLayer(KnowledgeToolkit, {
  knowledge_search: McpToolAccess.reads(({ query, topK }) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      // A conversation that loads only some categories searches only those.
      const categories =
        scope.thread === undefined
          ? null
          : yield* KnowledgeSelection.selectedCategories({
              threadId: scope.thread.threadId,
              projectId: null,
            });
      const results = yield* KnowledgeSearch.searchPassages(
        query,
        Math.min(20, Math.max(1, Math.round(topK ?? 8))),
        categories,
      ).pipe(Effect.mapError(failed));
      return { results };
    }),
  ),
  knowledge_read: McpToolAccess.reads(({ path }) =>
    KnowledgeSearch.readDocument(path).pipe(Effect.mapError(failed)),
  ),
});
