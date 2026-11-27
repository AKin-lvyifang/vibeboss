import { threadKey } from "@t3tools/client-runtime/state/entities";
import { buildPendingUserInputAnswers } from "@t3tools/client-runtime/state/pending-user-input";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { isShownUnderParent } from "@t3tools/client-runtime/state/threads";
import { refreshUsageLimits } from "@t3tools/client-runtime/state/usage";
import {
  AuthOrchestrationOperateScope,
  type VibeBossHudAction,
  type VibeBossHudSnapshot,
} from "@t3tools/contracts";
import { collectLimitAccounts, remainingPercent } from "@t3tools/shared/usageLimits";
import { formatResetsIn } from "@t3tools/shared/usageLimitsCopy";
import type { AnyRouter } from "@tanstack/react-router";
import { type AtomRegistry, Atom } from "effect/reactivity";

import {
  hasUnseenCompletion,
  resolveSidebarRowStatus,
  resolveThreadLastVisitedAt,
} from "./components/Sidebar.logic";
import { providerClients } from "./components/settings/providerDriverMeta";
import { subscribeLocalStorageKey } from "./hooks/useLocalStorage";
import { m } from "./i18n/messages";
import { environmentPresentations } from "./state/presentation";
import { serverEnvironment } from "./state/server";
import { readEnvironmentScope } from "./state/session";
import {
  environmentThreadDetails,
  environmentThreadShells,
  threadEnvironment,
} from "./state/threads";
import { useUiStateStore } from "./uiStateStore";
import { HUD_STORAGE_KEYS, readHudAppearance } from "./vibebossAppearance";
import {
  buildHudSnapshot,
  hudDoneKey,
  hudThreadKey,
  type HudThread,
  type HudUsageAccount,
} from "./vibebossHud.logic";

const AVATAR_PIXELS = 88;

/** Every thread with what the HUD needs; only asking and working threads open a detail stream. */
const hudThreadsAtom = Atom.make((get): ReadonlyArray<HudThread> => {
  const delegatedUnderParent = get(environmentThreadShells.delegatedUnderParentAtom);
  return get(environmentThreadShells.visibleThreadShellsAtom).flatMap((thread) => {
    if (thread.archivedAt !== null) return [];
    const ref = { environmentId: thread.environmentId, threadId: thread.id };
    const localVisitedAt = useUiStateStore.getState().threadLastVisitedAtById[threadKey(ref)];
    const visited = {
      ...thread,
      lastVisitedAt: resolveThreadLastVisitedAt(thread.lastVisitedAt, localVisitedAt),
    };
    const status = resolveSidebarRowStatus(visited);
    const ownsPendingRequest = thread.hasPendingApprovals || thread.hasPendingUserInput;
    const working = status === "working" || status === "preparing";
    const todo = working
      ? get(environmentThreadDetails.quietThreadAtom(ref))?.projection.plans.findLast(
          (plan) => plan.kind === "todo_list" && plan.status === "active",
        )
      : undefined;
    return [
      {
        thread,
        status,
        unseenCompletion: hasUnseenCompletion(visited),
        shownUnderParent: isShownUnderParent(ref, thread.lineage, delegatedUnderParent),
        ownsPendingRequest,
        requests: ownsPendingRequest
          ? get(environmentThreadDetails.pendingRequestsAtom(ref))
          : null,
        steps:
          todo?.kind === "todo_list" && todo.steps.length > 0
            ? {
                done: todo.steps.filter((step) => step.status === "completed").length,
                total: todo.steps.length,
                current:
                  (
                    todo.steps.find((step) => step.status === "running") ??
                    todo.steps.find((step) => step.status === "pending")
                  )?.text ?? null,
              }
            : null,
      },
    ];
  });
}).pipe(Atom.withLabel("vibeboss-hud-threads"));

function usageAccounts(registry: AtomRegistry.AtomRegistry): ReadonlyArray<HudUsageAccount> {
  const now = Date.now();
  return collectLimitAccounts(
    registry.get(environmentPresentations.presentationsWithProvidersAtom),
  ).flatMap((account) =>
    account.limits.windows.length === 0
      ? []
      : [
          {
            key: account.key,
            driver: account.driver,
            name:
              account.displayName ?? providerClients.get(account.driver)?.label ?? account.driver,
            plan: account.plan ?? account.email ?? "",
            windows: account.limits.windows.map((window) => ({
              label: window.label,
              remainingPercent: remainingPercent(window),
              resets: formatResetsIn(window, now, m) ?? "",
            })),
          },
        ],
  );
}

/** The chosen square of the mascot image as a small PNG, so the HUD window loads nothing itself. */
async function renderAvatar(image: string, crop: ReturnType<typeof readHudAppearance>["crop"]) {
  const element = new Image();
  element.src = image;
  await element.decode();
  const side = crop.size * element.naturalWidth;
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_PIXELS;
  canvas.height = AVATAR_PIXELS;
  canvas
    .getContext("2d")
    ?.drawImage(
      element,
      crop.centerX * element.naturalWidth - side / 2,
      crop.centerY * element.naturalHeight - side / 2,
      side,
      side,
      0,
      0,
      AVATAR_PIXELS,
      AVATAR_PIXELS,
    );
  return canvas.toDataURL("image/png");
}

/**
 * Feeds the macOS menu-bar HUD. The HUD window holds no app state: this renderer sends it a
 * finished snapshot whenever threads, usage or the HUD settings change, and runs its actions.
 */
export function startVibeBossHud(registry: AtomRegistry.AtomRegistry, router: AnyRouter): void {
  const bridge = window.desktopBridge;
  if (!bridge?.setVibeBossHud || bridge.getClientPlatform() !== "darwin") return;
  const setHud = bridge.setVibeBossHud;

  let avatar: string | null = null;
  let avatarSource = "";
  let lastSent = "";
  let queued = false;
  // Dismissed with "Clear" for this session only; opening the thread is what marks it read.
  let dismissedDone: ReadonlySet<string> = new Set();

  const watchedThreadKey = () => {
    if (document.visibilityState !== "visible" || !document.hasFocus()) return null;
    const { environmentId, threadId } = (router.state.matches.at(-1)?.params ?? {}) as {
      environmentId?: string;
      threadId?: string;
    };
    return environmentId && threadId ? hudThreadKey({ environmentId, id: threadId }) : null;
  };

  const build = (): VibeBossHudSnapshot => {
    const appearance = readHudAppearance();
    return buildHudSnapshot({
      threads: appearance.enabled ? registry.get(hudThreadsAtom) : [],
      watchedThreadKey: watchedThreadKey(),
      dismissedDoneKeys: dismissedDone,
      usage: appearance.enabled ? usageAccounts(registry) : [],
      appearance: {
        enabled: appearance.enabled,
        doNotDisturb: appearance.doNotDisturb,
        avatar,
        avatarShape: appearance.shape,
      },
      resolve: m,
    });
  };

  const flush = () => {
    queued = false;
    const snapshot = build();
    const serialized = JSON.stringify(snapshot);
    if (serialized === lastSent) return;
    lastSent = serialized;
    void setHud(snapshot).catch(() => {
      lastSent = "";
    });
  };
  // Thread shells tick while agents stream; one snapshot per frame is plenty.
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(flush);
  };

  const refreshAvatar = () => {
    const { image, crop } = readHudAppearance();
    const source = JSON.stringify([image, crop]);
    if (source === avatarSource) return;
    avatarSource = source;
    void renderAvatar(image, crop)
      .then((next) => {
        if (avatarSource === source) avatar = next;
      })
      .catch(() => {
        if (avatarSource === source) avatar = null;
      })
      .finally(schedule);
  };

  const findThread = (action: VibeBossHudAction) =>
    registry
      .get(hudThreadsAtom)
      .find(
        (entry) =>
          entry.thread.environmentId === action.environmentId &&
          entry.thread.id === action.threadId,
      );

  const refreshUsage = () => {
    for (const [environmentId, presentation] of registry.get(
      environmentPresentations.presentationsAtom,
    )) {
      if (presentation.connection.phase !== "connected" || presentation.serverConfig === null) {
        continue;
      }
      void refreshUsageLimits(
        environmentId,
        () =>
          runAtomCommand(
            registry,
            serverEnvironment.refreshProviders,
            { environmentId, input: {} },
            { reportFailure: false },
          ),
        true,
      ).finally(schedule);
    }
  };

  const onAction = (action: VibeBossHudAction) => {
    if (action.type === "clear-done") {
      dismissedDone = new Set(
        registry
          .get(hudThreadsAtom)
          .filter((entry) => entry.unseenCompletion)
          .map(hudDoneKey),
      );
      schedule();
      return;
    }
    if (action.type === "refresh-usage") {
      refreshUsage();
      return;
    }
    const entry = findThread(action);
    if (!entry) return;
    const { environmentId, id: threadId } = entry.thread;
    if (action.type === "open") {
      void bridge.revealWindow().catch(() => undefined);
      void router.navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId, threadId },
      });
      return;
    }
    if (!readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) return;
    if (action.type === "approve" || action.type === "decline") {
      const approval = entry.requests?.approvals.find(
        (candidate) => candidate.requestId === action.requestId,
      );
      if (!approval) return;
      void runAtomCommand(registry, threadEnvironment.respondToApproval, {
        environmentId,
        input: {
          threadId,
          requestId: approval.requestId,
          decision: action.type === "approve" ? "accept" : "decline",
        },
      });
      return;
    }
    const userInput = entry.requests?.userInputs.find(
      (candidate) => candidate.requestId === action.requestId,
    );
    if (!userInput || action.questionId === undefined || action.value === undefined) return;
    const answers = buildPendingUserInputAnswers(userInput.questions, {
      [action.questionId]: { selectedOptionValues: [action.value] },
    });
    if (answers === null) return;
    void runAtomCommand(registry, threadEnvironment.respondToUserInput, {
      environmentId,
      input: { threadId, requestId: userInput.requestId, answers },
    });
  };

  registry.subscribe(hudThreadsAtom, schedule);
  registry.subscribe(environmentPresentations.presentationsWithProvidersAtom, schedule);
  useUiStateStore.subscribe(schedule);
  router.subscribe("onResolved", schedule);
  window.addEventListener("focus", schedule);
  window.addEventListener("blur", schedule);
  document.addEventListener("visibilitychange", schedule);
  for (const key of HUD_STORAGE_KEYS) {
    subscribeLocalStorageKey(key, () => {
      refreshAvatar();
      schedule();
    });
  }
  bridge.onVibeBossHudAction?.(onAction);
  refreshAvatar();
  schedule();
}
