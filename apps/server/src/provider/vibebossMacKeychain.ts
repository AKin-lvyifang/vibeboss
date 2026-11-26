import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

// "The specified item could not be found in the keychain."
const ITEM_NOT_FOUND_EXIT_CODE = 44;

class MacKeychainReadError extends Schema.TaggedError<MacKeychainReadError>()(
  "MacKeychainReadError",
  { exitCode: Schema.Number },
) {}

/**
 * VibeBoss: agy's go-keyring writes through /usr/bin/security, so that tool is already on the item's
 * ACL and partition list. Reading through it never prompts, while an in-process read is tied to this
 * build's cdhash (self-signed, no Team ID) and prompts again after every update.
 */
export const readMacKeychainSecret = Effect.fn("readMacKeychainSecret")(function* (
  service: string,
  account: string,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner.spawn(
        ChildProcess.make(
          "/usr/bin/security",
          ["find-generic-password", "-s", service, "-a", account, "-w"],
          { stdin: "ignore" },
        ),
      );
      const [stdout, , exitCode] = yield* Effect.all(
        [
          handle.stdout.pipe(Stream.decodeText(), Stream.mkString),
          handle.stderr.pipe(Stream.runDrain),
          handle.exitCode,
        ],
        { concurrency: "unbounded" },
      );
      if (Number(exitCode) === ITEM_NOT_FOUND_EXIT_CODE) return undefined;
      if (Number(exitCode) !== 0) {
        return yield* new MacKeychainReadError({ exitCode: Number(exitCode) });
      }
      const secret = stdout.replace(/\n$/, "");
      return secret === "" ? undefined : new TextEncoder().encode(secret);
    }),
  ).pipe(Effect.timeout("10 seconds"));
});
