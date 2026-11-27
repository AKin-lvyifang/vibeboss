import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { PendingThreadRequests } from "@t3tools/client-runtime/state/thread-requests";
import type { VibeBossHudRow, VibeBossHudSnapshot } from "@t3tools/contracts";
import { msg } from "gt-react";

import type { SidebarThreadStatus } from "./components/Sidebar.logic";
import type { MessageResolver } from "./i18n/messages";

const MAX_TEXT = 160;
const MAX_DONE_ROWS = 5;
const MAX_USAGE_WINDOWS = 4;
const LOW_USAGE_PERCENT = 10;
/** More choices than this do not fit beside a row, so the user answers in the thread. */
const MAX_INLINE_OPTIONS = 3;

const clip = (text: string) =>
  text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1).trimEnd()}…` : text;

export interface HudThread {
  readonly thread: Pick<
    EnvironmentThreadShell,
    "environmentId" | "id" | "title" | "lineage" | "delegatedFrom" | "runtime" | "latestRun"
  > & { readonly providerInstanceId: string };
  readonly status: SidebarThreadStatus;
  readonly unseenCompletion: boolean;
  /** Subagents and delegated tasks have no sidebar row; they show under their parent. */
  readonly shownUnderParent: boolean;
  readonly ownsPendingRequest: boolean;
  readonly requests: PendingThreadRequests | null;
  readonly steps: {
    readonly done: number;
    readonly total: number;
    readonly current: string | null;
  } | null;
}

export interface HudUsageAccount {
  readonly key: string;
  readonly driver: string;
  readonly name: string;
  readonly plan: string;
  readonly windows: ReadonlyArray<{
    readonly label: string;
    readonly remainingPercent: number;
    readonly resets: string;
  }>;
}

export interface HudSnapshotInput {
  readonly threads: ReadonlyArray<HudThread>;
  /** The thread the user is looking at right now; it needs no reminder. */
  readonly watchedThreadKey: string | null;
  readonly dismissedDoneKeys: ReadonlySet<string>;
  readonly usage: ReadonlyArray<HudUsageAccount>;
  readonly appearance: {
    readonly enabled: boolean;
    readonly doNotDisturb: boolean;
    readonly avatar: string | null;
    readonly avatarShape: "square" | "circle";
  };
  readonly resolve: MessageResolver;
}

export const hudThreadKey = (thread: { environmentId: string; id: string }) =>
  `${thread.environmentId}:${thread.id}`;

/** A finished run is one reminder; a later run of the same thread is a new one. */
export const hudDoneKey = (entry: HudThread) =>
  `${hudThreadKey(entry.thread)}:${entry.thread.latestRun?.completedAt ?? ""}`;

function parentKey(entry: HudThread): string | null {
  const { thread } = entry;
  if (thread.delegatedFrom) {
    return `${thread.delegatedFrom.environmentId}:${thread.delegatedFrom.threadId}`;
  }
  const parentThreadId = thread.lineage?.parentThreadId;
  return parentThreadId ? `${thread.environmentId}:${parentThreadId}` : null;
}

const agentName = (entry: HudThread) =>
  entry.thread.runtime?.providerName ?? entry.thread.providerInstanceId;

const isWorking = (entry: HudThread) =>
  entry.status === "working" ||
  entry.status === "preparing" ||
  (entry.status === "waiting" && entry.thread.runtime?.status === "running");

function baseRow(entry: HudThread): VibeBossHudRow {
  return {
    key: hudThreadKey(entry.thread),
    environmentId: entry.thread.environmentId,
    threadId: entry.thread.id,
    title: clip(entry.thread.title),
    agent: clip(agentName(entry)),
  };
}

function attentionRow(entry: HudThread): VibeBossHudRow {
  const row = baseRow(entry);
  const approval = entry.requests?.approvals[0];
  if (approval) {
    return {
      ...row,
      code: clip(approval.detail || approval.requestKind),
      ...(approval.responseCapability === "live" ? { approvalRequestId: approval.requestId } : {}),
    };
  }
  const userInput = entry.requests?.userInputs[0];
  const question = userInput?.questions[0];
  if (!userInput || !question) return row;
  const answerable =
    userInput.responseCapability === "live" &&
    userInput.questions.length === 1 &&
    !question.multiSelect &&
    question.options.length > 0 &&
    question.options.length <= MAX_INLINE_OPTIONS;
  return {
    ...row,
    detail: clip(question.question),
    ...(answerable
      ? {
          question: {
            requestId: userInput.requestId,
            questionId: question.id,
            options: question.options.map((option) => ({
              label: clip(option.label),
              value: option.value ?? option.label,
            })),
          },
        }
      : {}),
  };
}

export function buildHudSnapshot(input: HudSnapshotInput): VibeBossHudSnapshot {
  const { resolve, appearance } = input;
  const reminded = (entry: HudThread) => hudThreadKey(entry.thread) !== input.watchedThreadKey;

  const childAsks = new Set(
    input.threads.filter((entry) => entry.ownsPendingRequest).map(parentKey),
  );
  const attention = input.threads.filter(
    (entry) =>
      (entry.status === "approval" || entry.status === "input") &&
      reminded(entry) &&
      // A parent that only relays its child's request would repeat the child's row.
      (entry.ownsPendingRequest || !childAsks.has(hudThreadKey(entry.thread))),
  );
  const listed = input.threads.filter((entry) => !entry.shownUnderParent);
  const errors = listed.filter(
    (entry) => (entry.status === "failed" || entry.status === "limited") && reminded(entry),
  );
  const working = listed.filter(isWorking);
  const workingKeys = new Set(working.map((entry) => hudThreadKey(entry.thread)));
  const children = input.threads.filter((entry) => entry.shownUnderParent && isWorking(entry));
  const done = listed
    .filter(
      (entry) =>
        entry.status === "ready" &&
        entry.unseenCompletion &&
        reminded(entry) &&
        !input.dismissedDoneKeys.has(hudDoneKey(entry)),
    )
    .toSorted((left, right) =>
      (right.thread.latestRun?.completedAt ?? "").localeCompare(
        left.thread.latestRun?.completedAt ?? "",
      ),
    )
    .slice(0, MAX_DONE_ROWS);

  const workingRows = [
    ...working.map((entry): VibeBossHudRow => {
      const own = hudThreadKey(entry.thread);
      const under = children.filter((child) => parentKey(child) === own);
      return {
        ...baseRow(entry),
        ...(entry.steps?.current ? { detail: clip(entry.steps.current) } : {}),
        ...(entry.steps ? { progress: { done: entry.steps.done, total: entry.steps.total } } : {}),
        ...(under.length > 0
          ? {
              children: under.map((child) => ({
                title: clip(child.thread.title),
                detail: clip(agentName(child)),
              })),
            }
          : {}),
      };
    }),
    // A child whose parent is idle still counts as work in progress.
    ...children
      .filter((child) => !workingKeys.has(parentKey(child) ?? ""))
      .map((child) => baseRow(child)),
  ];

  const lowUsage = input.usage
    .flatMap((account) => account.windows.map((window) => ({ account, window })))
    .filter(({ window }) => window.remainingPercent <= LOW_USAGE_PERCENT)
    .toSorted((left, right) => left.window.remainingPercent - right.window.remainingPercent)[0];

  const workingCount = workingRows.length;
  const workingText =
    workingCount > 0 ? resolve(msg("{count} at work"), { count: workingCount }) : "";
  let collapsed: VibeBossHudSnapshot["collapsed"] = null;
  const firstAttention = attention[0];
  const firstError = errors[0];
  const firstWorking = working[0];
  if (firstAttention) {
    const agent = agentName(firstAttention);
    const waiting = resolve(msg("{count} waiting"), { count: attention.length });
    collapsed = {
      tone: "attention",
      left: clip(
        firstAttention.status === "approval"
          ? resolve(msg("{agent} needs approval"), { agent })
          : resolve(msg("{agent} has a question"), { agent }),
      ),
      right: workingText ? `${waiting} · ${workingText}` : waiting,
    };
  } else if (firstError) {
    collapsed = {
      tone: "error",
      left: clip(resolve(msg("{agent} went wrong"), { agent: agentName(firstError) })),
      right: workingText,
    };
  } else if (lowUsage) {
    collapsed = {
      tone: "warning",
      left: clip(
        resolve(msg("{name} has {percent}% left"), {
          name: lowUsage.account.name,
          percent: lowUsage.window.remainingPercent,
        }),
      ),
      right: lowUsage.window.resets,
    };
  } else if (workingCount > 0) {
    collapsed = {
      tone: "working",
      left: workingText,
      right: firstWorking?.steps
        ? clip(
            `${firstWorking.thread.title} ${firstWorking.steps.done}/${firstWorking.steps.total}`,
          )
        : "",
    };
  }

  return {
    enabled: appearance.enabled,
    doNotDisturb: appearance.doNotDisturb,
    avatar: appearance.avatar,
    avatarShape: appearance.avatarShape,
    collapsed,
    groups: [
      {
        kind: "attention",
        label: resolve(msg("Waiting for you")),
        rows: attention.map(attentionRow),
      },
      {
        kind: "error",
        label: resolve(msg("Went wrong")),
        rows: errors.map((entry) => ({
          ...baseRow(entry),
          detail: clip(
            entry.status === "limited"
              ? resolve(msg("Usage limit reached"))
              : (entry.thread.runtime?.lastError ?? ""),
          ),
        })),
      },
      { kind: "working", label: resolve(msg("At work")), rows: workingRows },
      { kind: "done", label: resolve(msg("Finished")), rows: done.map(baseRow) },
    ],
    usage: input.usage.map((account) => ({
      ...account,
      name: clip(account.name),
      plan: clip(account.plan),
      windows: account.windows.slice(0, MAX_USAGE_WINDOWS).map((window) => ({
        ...window,
        remaining: resolve(msg("{percent}% left"), { percent: window.remainingPercent }),
      })),
    })),
    labels: {
      threads: resolve(msg("Threads")),
      usage: resolve(msg("Quota left")),
      approve: resolve(msg("Approve")),
      decline: resolve(msg("Decline")),
      clear: resolve(msg("Clear")),
      idle: resolve(msg("Nothing needs you right now")),
      finished: resolve(msg("Finished")),
      asks: resolve(msg("Asks: ")),
      noUsage: resolve(msg("No usage limits reported yet")),
    },
  };
}
