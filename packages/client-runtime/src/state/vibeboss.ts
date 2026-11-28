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
    knowledge: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:vibeboss:knowledge",
      tag: WS_METHODS.vibebossKnowledgeGetState,
    }),
    saveKnowledgeConfig: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:vibeboss:knowledge-save-config",
      tag: WS_METHODS.vibebossKnowledgeSaveConfig,
    }),
    organizeKnowledge: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:vibeboss:knowledge-organize",
      tag: WS_METHODS.vibebossKnowledgeOrganize,
    }),
    undoKnowledge: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:vibeboss:knowledge-undo",
      tag: WS_METHODS.vibebossKnowledgeUndo,
    }),
    knowledgeSelection: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:vibeboss:knowledge-selection",
      tag: WS_METHODS.vibebossKnowledgeGetSelection,
    }),
    setKnowledgeSelection: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:vibeboss:knowledge-set-selection",
      tag: WS_METHODS.vibebossKnowledgeSetSelection,
    }),
    prepareKnowledgeFeishuSync: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:vibeboss:knowledge-prepare-feishu-sync",
      tag: WS_METHODS.vibebossKnowledgePrepareFeishuSync,
    }),
    knowledgeCloud: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:vibeboss:knowledge-cloud",
      tag: WS_METHODS.vibebossKnowledgeCloudGetState,
    }),
    saveKnowledgeCloud: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:vibeboss:knowledge-cloud-save",
      tag: WS_METHODS.vibebossKnowledgeCloudSave,
    }),
    knowledgeCloudCatalog: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:vibeboss:knowledge-cloud-catalog",
      tag: WS_METHODS.vibebossKnowledgeCloudSearchCatalog,
    }),
    prepareKnowledgeCloudCatalog: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:vibeboss:knowledge-cloud-prepare-catalog",
      tag: WS_METHODS.vibebossKnowledgeCloudPrepareCatalog,
    }),
    memory: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:vibeboss:memory",
      tag: WS_METHODS.vibebossMemoryGetState,
      // Agents write memory from other threads; each mount shows the files as they are now.
      staleTimeMs: 0,
    }),
    memoryLog: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:vibeboss:memory-log",
      tag: WS_METHODS.vibebossMemoryGetLog,
      staleTimeMs: 0,
    }),
    readMemory: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:vibeboss:memory-read",
      tag: WS_METHODS.vibebossMemoryRead,
      staleTimeMs: 0,
    }),
    createMemory: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:vibeboss:memory-create",
      tag: WS_METHODS.vibebossMemoryCreate,
    }),
    writeMemory: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:vibeboss:memory-write",
      tag: WS_METHODS.vibebossMemoryWrite,
    }),
    archiveMemory: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:vibeboss:memory-archive",
      tag: WS_METHODS.vibebossMemoryArchive,
    }),
    undoMemory: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:vibeboss:memory-undo",
      tag: WS_METHODS.vibebossMemoryUndo,
    }),
    tidyMemory: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:vibeboss:memory-tidy",
      tag: WS_METHODS.vibebossMemoryTidy,
    }),
    personalMemory: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:vibeboss:personal-memory",
      tag: WS_METHODS.vibebossPersonalMemoryGetState,
      staleTimeMs: 0,
    }),
    runPersonalMemory: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:vibeboss:personal-memory-run",
      tag: WS_METHODS.vibebossPersonalMemoryRun,
    }),
    resolveNativeTranscript: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:vibeboss:resolve-native-transcript",
      tag: WS_METHODS.vibebossResolveNativeTranscript,
    }),
  };
}
