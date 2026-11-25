import {
  ProviderSetupError,
  type ProviderAuthRespondInput,
  type ProviderAuthState,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as PtyAdapter from "@t3tools/shared/PtyAdapter";

import type { ProviderAuthController } from "../provider/ProviderAuthService.ts";

// Matches the contract's cap on terminal interaction output.
const MAX_OUTPUT = 16_000;

interface Flow {
  readonly id: string;
  readonly owner: string;
  readonly phase: ProviderAuthState["phase"];
  readonly output: string;
  readonly offset: number;
  readonly message: string | null;
}

/**
 * Sign-in through the providers' terminal interaction: the agent's own login command runs in a PTY
 * on the server and the settings page shows it, so it works from any client.
 */
export const makeTerminalAuth = Effect.fn("makeTerminalAuth")(function* (input: {
  readonly instanceId: ProviderInstanceId;
  /** Shown in messages and flow ids, e.g. "Claude". */
  readonly agent: string;
  readonly loginArgs: ReadonlyArray<string>;
  readonly logoutArgs: ReadonlyArray<string>;
  readonly binaryPath: string;
  readonly env: NodeJS.ProcessEnv;
  readonly cwd: string;
  /** Re-checks the provider after the login changes. */
  readonly onCredentialsChanged: Effect.Effect<void>;
}) {
  // Optional so hosts and tests without terminals keep working; they just offer no sign-in.
  const ptyOption = yield* Effect.serviceOption(PtyAdapter.PtyAdapter);
  if (Option.isNone(ptyOption)) return undefined;
  const pty = ptyOption.value;
  const services = yield* Effect.context<never>();
  const runSync = Effect.runSyncWith(services);
  const runFork = Effect.runForkWith(services);
  const flowRef = yield* SubscriptionRef.make<Flow | null>(null);
  let running: PtyAdapter.PtyProcess | undefined;
  let sequence = 0;

  const fail = (operation: string, detail: string) =>
    new ProviderSetupError({ instanceId: input.instanceId, operation, detail });

  const toState = (flow: Flow | null, owner: string): ProviderAuthState => {
    const mine = flow !== null && flow.owner === owner;
    return {
      instanceId: input.instanceId,
      phase: flow?.phase ?? "idle",
      flowId: mine ? flow.id : null,
      authorizationUrl: null,
      expiresAt: null,
      message: flow?.message ?? null,
      credentialOwner: "provider",
      interaction:
        mine && flow.phase === "waiting"
          ? { type: "terminal", id: flow.id, output: flow.output, outputOffset: flow.offset }
          : null,
    };
  };
  const current = (owner: string) =>
    SubscriptionRef.get(flowRef).pipe(Effect.map((flow) => toState(flow, owner)));
  const update = (id: string, change: (flow: Flow) => Flow) =>
    runSync(SubscriptionRef.update(flowRef, (flow) => (flow?.id === id ? change(flow) : flow)));

  const stop = Effect.sync(() => {
    const process = running;
    running = undefined;
    process?.kill();
  });
  yield* Effect.addFinalizer(() => stop);

  const run = (args: ReadonlyArray<string>, id: string) =>
    pty
      .spawn({
        shell: input.binaryPath,
        args: [...args],
        cwd: input.cwd,
        cols: 100,
        rows: 24,
        env: { ...input.env, TERM: "xterm-256color" },
      })
      .pipe(
        Effect.mapError(() =>
          fail("start", `Could not run ${input.binaryPath}. Check the executable path.`),
        ),
        Effect.tap((process) =>
          Effect.sync(() => {
            running = process;
            process.onData((data) =>
              update(id, (flow) => {
                const output = (flow.output + data).slice(-MAX_OUTPUT);
                return { ...flow, output, offset: flow.offset + data.length };
              }),
            );
          }),
        ),
      );

  const flowPrefix = input.agent.toLowerCase();
  const start = Effect.fn("TerminalAuth.start")(function* (owner: string) {
    yield* stop;
    const id = `${flowPrefix}-login-${++sequence}`;
    yield* SubscriptionRef.set<Flow | null>(flowRef, {
      id,
      owner,
      phase: "waiting",
      output: "",
      offset: 0,
      message: null,
    });
    const process = yield* run(input.loginArgs, id).pipe(
      Effect.tapError((error) =>
        SubscriptionRef.set<Flow | null>(flowRef, {
          id,
          owner,
          phase: "failed",
          output: "",
          offset: 0,
          message: error.detail,
        }),
      ),
    );
    process.onExit(({ exitCode }) => {
      if (running === process) running = undefined;
      update(id, (flow) =>
        flow.phase !== "waiting"
          ? flow
          : exitCode === 0
            ? { ...flow, phase: "succeeded", message: null }
            : {
                ...flow,
                phase: "failed",
                message: `${input.agent} sign-in did not finish. Try again.`,
              },
      );
      if (exitCode === 0) runFork(input.onCredentialsChanged);
    });
    return yield* current(owner);
  });

  const cancel = Effect.fn("TerminalAuth.cancel")(function* (owner: string, flowId: string) {
    const flow = yield* SubscriptionRef.get(flowRef);
    if (flow?.id === flowId && flow.phase === "waiting") {
      yield* SubscriptionRef.set<Flow | null>(flowRef, { ...flow, phase: "cancelled" });
      yield* stop;
    }
    return yield* current(owner);
  });

  const respond = Effect.fn("TerminalAuth.respond")(function* (
    owner: string,
    request: ProviderAuthRespondInput,
  ) {
    const flow = yield* SubscriptionRef.get(flowRef);
    if (flow?.id !== request.flowId || flow.owner !== owner || running === undefined) {
      return yield* fail("respond", "This sign-in has ended. Start it again.");
    }
    const response = request.response;
    if (response.type === "terminal") {
      if (response.size) running.resize(response.size.cols, response.size.rows);
      if (response.data.length > 0)
        running.write(PtyAdapter.ptyInput(response.data, response.binary));
    }
    return yield* current(owner);
  });

  const logout = Effect.fn("TerminalAuth.logout")(function* (
    stopSessions: Effect.Effect<void, ProviderSetupError>,
  ) {
    yield* stopSessions;
    yield* stop;
    const id = `${flowPrefix}-logout-${++sequence}`;
    const process = yield* run(input.logoutArgs, id);
    yield* Effect.callback<void>((resume) => {
      process.onExit(() => resume(Effect.void));
    });
    running = undefined;
    yield* SubscriptionRef.set(flowRef, null);
    yield* input.onCredentialsChanged;
    return toState(null, "");
  });

  return {
    start,
    cancel,
    respond,
    logout,
    complete: (owner) => current(owner),
    subscribe: (owner) =>
      SubscriptionRef.changes(flowRef).pipe(Stream.map((flow) => toState(flow, owner))),
  } satisfies ProviderAuthController;
});
