import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

export function createVibeBossEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    state: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:vibeboss:state",
      tag: WS_METHODS.vibebossGetState,
    }),
    saveConfig: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:vibeboss:save-config",
      tag: WS_METHODS.vibebossSaveConfig,
    }),
    syncRules: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:vibeboss:sync-rules",
      tag: WS_METHODS.vibebossSyncRules,
    }),
    capabilities: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:vibeboss:capabilities",
      tag: WS_METHODS.vibebossListCapabilities,
    }),
    reviewRules: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:vibeboss:review-rules",
      tag: WS_METHODS.vibebossReviewRules,
    }),
    resolveNativeTranscript: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:vibeboss:resolve-native-transcript",
      tag: WS_METHODS.vibebossResolveNativeTranscript,
    }),
  };
}
