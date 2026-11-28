// VibeBoss: runs the daily personal memory tidy, and builds the model call that generate and tidy
// share. Only an API model picked on the Rules page runs them.
import { textGeneratorForSelection, VibeBossError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schedule from "effect/Schedule";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerConfig from "../config.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import { forkParked } from "../serverActivation.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as PersonalMemory from "./PersonalMemory.ts";
import * as VibeBoss from "./VibeBoss.ts";

// A text generator gets the prompt as is and must reply in the operation's JSON shape.
const REPLY_FORMAT =
  '\n\nReply with only a JSON object {"transcription": "..."} whose string holds your whole answer.';

export const runDeps = Effect.fn("VibeBossPersonalMemoryWorker.runDeps")(function* (services: {
  readonly textGeneration: TextGeneration.TextGeneration["Service"];
  readonly settings: ServerSettings.ServerSettingsService["Service"];
  readonly providers: ProviderRegistry.ProviderRegistry["Service"];
  readonly sql: SqlClient.SqlClient;
  readonly cwd: string;
}) {
  const [config, settings] = yield* Effect.all([
    VibeBoss.readConfig(),
    services.settings.getSettings.pipe(
      Effect.mapError((cause) => new VibeBossError({ detail: "读取设置失败", cause })),
    ),
  ]);
  const api = config.memoryApi;
  if (
    api === undefined ||
    api.model === "" ||
    textGeneratorForSelection(settings, api.generatorId)?.enabled !== true
  ) {
    return yield* new VibeBossError({ detail: "先在「整理」旁边选一个 API 模型" });
  }
  const modelSelection = { instanceId: api.generatorId, model: api.model };
  const deps: PersonalMemory.RunDeps = {
    modelLabel: modelSelection.model,
    sql: services.sql,
    providers: services.providers.getProviders,
    ask: (prompt) =>
      services.textGeneration
        .generateTranscriptionPostProcessing({
          cwd: services.cwd,
          prompt: `${prompt}${REPLY_FORMAT}`,
          modelSelection,
        })
        .pipe(
          Effect.map((result) => result.transcription),
          Effect.timeout("5 minutes"),
          Effect.mapError((cause) => new VibeBossError({ detail: "整理用的模型没有回答", cause })),
        ),
  };
  return deps;
});

export const start = Effect.fn("VibeBossPersonalMemoryWorker.start")(function* () {
  const textGeneration = yield* Effect.serviceOption(TextGeneration.TextGeneration);
  if (Option.isNone(textGeneration)) return;
  const sql = yield* SqlClient.SqlClient;
  const config = yield* ServerConfig.ServerConfig;
  const services = {
    textGeneration: textGeneration.value,
    settings: yield* ServerSettings.ServerSettingsService,
    providers: yield* ProviderRegistry.ProviderRegistry,
    sql,
    cwd: config.stateDir,
  };
  const context = yield* Effect.context<
    ServerConfig.ServerConfig | FileSystem.FileSystem | Path.Path
  >();
  const round = Effect.gen(function* () {
    if (!(yield* PersonalMemory.tidyDue(sql))) return;
    yield* PersonalMemory.start("tidy", yield* runDeps(services));
  }).pipe(
    Effect.catchCause((cause) => Effect.logWarning("personal memory tidy round failed", { cause })),
    Effect.provideContext(context),
  );
  yield* forkParked(
    round.pipe(Effect.delay("5 minutes"), Effect.repeat(Schedule.spaced("30 minutes"))),
  );
});
