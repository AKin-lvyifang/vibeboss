// VibeBoss: runs the automatic project memory tidy. Every half hour it tidies the projects that are
// due, with the small model VibeBoss uses for thread titles. Without text generation it does nothing.
import { VibeBossError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schedule from "effect/Schedule";

import * as ServerConfig from "../config.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import { forkParked } from "../serverActivation.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as ProjectMemoryTidy from "./ProjectMemoryTidy.ts";
import { reviewModelSelection } from "./VibeBoss.ts";

/** Asks the small model; shared by the worker and the Settings button. */
export function smallModelAsk(services: {
  readonly textGeneration: TextGeneration.TextGeneration["Service"];
  readonly settings: ServerSettings.ServerSettingsService["Service"];
  readonly providers: ProviderRegistry.ProviderRegistry["Service"];
  readonly cwd: string;
}): ProjectMemoryTidy.Ask {
  return (prompt) =>
    Effect.all([services.settings.getSettings, services.providers.getProviders]).pipe(
      Effect.flatMap(([settings, providers]) =>
        services.textGeneration.generateTranscriptionPostProcessing({
          cwd: services.cwd,
          prompt,
          modelSelection: reviewModelSelection(
            undefined,
            providers,
            settings.textGenerationModelSelection,
          ),
        }),
      ),
      Effect.map((result) => result.transcription),
      Effect.timeout("3 minutes"),
      Effect.mapError((cause) => new VibeBossError({ detail: "整理用的小模型没有回答", cause })),
    );
}

export const start = Effect.fn("VibeBossMemoryTidyWorker.start")(function* () {
  const textGeneration = yield* Effect.serviceOption(TextGeneration.TextGeneration);
  if (Option.isNone(textGeneration)) return;
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const ask = smallModelAsk({
    textGeneration: textGeneration.value,
    settings: yield* ServerSettings.ServerSettingsService,
    providers: yield* ProviderRegistry.ProviderRegistry,
    cwd: config.stateDir,
  });
  const round = Effect.gen(function* () {
    for (const root of yield* ProjectMemoryTidy.dueRoots()) {
      yield* ProjectMemoryTidy.tidy(root, ask, "自动整理").pipe(
        Effect.catch((cause) => Effect.logWarning("project memory tidy skipped", { root, cause })),
      );
    }
  }).pipe(
    Effect.catchCause((cause) => Effect.logWarning("project memory tidy round failed", { cause })),
    Effect.provideService(ServerConfig.ServerConfig, config),
    Effect.provideService(FileSystem.FileSystem, fileSystem),
    Effect.provideService(Path.Path, path),
  );
  yield* forkParked(
    round.pipe(Effect.delay("5 minutes"), Effect.repeat(Schedule.spaced("30 minutes"))),
  );
});
