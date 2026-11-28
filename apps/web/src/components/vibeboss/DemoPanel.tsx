import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { executeAtomQuery } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { BadgeCheck, Bot, LayoutGrid } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";

import { resolveAssetUrl } from "~/assets/assetUrls";
import { openFileInPreview } from "~/browser/openFileInPreview";
import { GlyphBackground } from "~/components/animate-ui/backgrounds/glyph";
import { AntigravityIcon, ClaudeAI, OpenAI } from "~/components/Icons";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { Progress, ProgressTrack, ProgressValue } from "~/components/ui/progress";
import { observeResize } from "~/lib/observeResize";
import { cn } from "~/lib/utils";
import { readThreadPreviewState } from "~/previewStateStore";
import { useRightPanelStore } from "~/rightPanelStore";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { assetEnvironment } from "~/state/assets";
import { useEnvironmentHttpBaseUrl } from "~/state/environments";
import { previewEnvironment } from "~/state/preview";
import { projectEnvironment } from "~/state/projects";
import { useAtomCommand } from "~/state/use-atom-command";
import { useAtomQueryRunner } from "~/state/use-atom-query-runner";
import {
  type DemoSlot,
  type DemoStatus,
  demoPagePath,
  demoPollInterval,
  demoStatusPath,
  isDemoReady,
  parseDemoStatus,
  VIBEBOSS_DEMO_SLOTS,
} from "~/vibebossDemos";

interface SlotStatus {
  readonly slot: DemoSlot;
  readonly status: DemoStatus;
}

/** Demos are laid out for a desktop browser; thumbnails scale this width down. */
const DEMO_PAGE_WIDTH = 1280;

/** Browser tab each demo was last opened in, so reopening one focuses it instead of adding tabs. */
const openedDemoTabs = new Map<string, { readonly tabId: string; readonly version: string }>();

function useDemoStatuses(
  environmentId: EnvironmentId,
  threadId: string,
  cwd: string | undefined,
  visible: boolean,
): ReadonlyArray<SlotStatus> | null {
  const [statuses, setStatuses] = useState<ReadonlyArray<SlotStatus> | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- agents write these files outside the app and the server has no watch for them, so the open panel polls.
  useEffect(() => {
    if (!visible || cwd === undefined) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      const results = await Promise.all(
        VIBEBOSS_DEMO_SLOTS.map(async (slot): Promise<SlotStatus | null> => {
          const result = await executeAtomQuery(
            appAtomRegistry,
            projectEnvironment.readFile({
              environmentId,
              input: { cwd, relativePath: demoStatusPath(threadId, slot), allowMissing: true },
            }),
            { label: "Read demo status", reportFailure: false, refresh: true },
          );
          if (result._tag === "Failure" || result.value.exists === false) return null;
          const status = parseDemoStatus(result.value.contents);
          return status === null ? null : { slot, status };
        }),
      );
      if (cancelled) return;
      const next = results.filter((entry): entry is SlotStatus => entry !== null);
      setStatuses((previous) =>
        previous !== null &&
        previous.length === next.length &&
        previous.every(
          (entry, index) =>
            entry.slot === next[index]?.slot &&
            entry.status.version === next[index]?.status.version,
        )
          ? previous
          : next,
      );
      timer = setTimeout(load, demoPollInterval(next.map((entry) => entry.status)));
    };
    void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [environmentId, threadId, cwd, visible]);
  return statuses;
}

function DemoAgentIcon({ status }: { readonly status: DemoStatus }) {
  const className = "size-3.5 shrink-0";
  switch (status.agentKind) {
    case "claude":
      return <ClaudeAI className={className} />;
    case "codex":
      return <OpenAI className={className} />;
    case "antigravity":
      return <AntigravityIcon className={className} />;
    case "final":
      return <BadgeCheck className={className} />;
    case "other":
      return <Bot className={className} />;
  }
}

function DemoAgentName({ status }: { readonly status: DemoStatus }) {
  const gt = useGT();
  switch (status.agentKind) {
    case "claude":
      return "Claude";
    case "codex":
      return "Codex";
    case "antigravity":
      return "Antigravity";
    case "final":
      return gt("Final");
    case "other":
      return status.agent || gt("Agent");
  }
}

function DemoLoading({ status }: { readonly status: DemoStatus }) {
  const gt = useGT();
  const glyphRef = useRef<HTMLDivElement>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- each progress report sends one of the background's own click ripples out from the center.
  useEffect(() => {
    const element = glyphRef.current;
    if (!element || status.waiting || status.progress === 0) return;
    const rect = element.getBoundingClientRect();
    element.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      }),
    );
  }, [status.progress, status.waiting]);
  return (
    <>
      <GlyphBackground
        ref={glyphRef}
        fps={20}
        burstMs={2400}
        className={cn("absolute inset-0 text-foreground", status.waiting && "opacity-50")}
      />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
        {status.waiting ? (
          <span className="rounded-lg bg-muted/85 px-3 py-1.5 text-muted-foreground text-sm">
            {gt("Waiting")}
          </span>
        ) : (
          <div className="w-48 max-w-full rounded-xl bg-muted/85 px-4 py-3">
            <Progress value={status.progress}>
              <ProgressValue size="display" />
              <ProgressTrack />
            </Progress>
          </div>
        )}
      </div>
    </>
  );
}

function DemoThumbnail({ url }: { readonly url: string }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ readonly width: number; readonly height: number } | null>(
    null,
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the thumbnail scales a full-width page to whatever size the card has.
  useEffect(() => {
    const element = frameRef.current;
    if (!element) return;
    return observeResize(element, (entries) => {
      const rect = entries.at(-1)?.contentRect;
      if (rect) setSize({ width: rect.width, height: rect.height });
    });
  }, []);
  const scale = size === null ? 0 : size.width / DEMO_PAGE_WIDTH;
  return (
    <div ref={frameRef} className="absolute inset-0 overflow-hidden bg-background">
      {scale > 0 && size !== null ? (
        <iframe
          src={url}
          title=""
          tabIndex={-1}
          loading="lazy"
          // Demo pages run their own scripts, but never with the app's origin.
          sandbox="allow-scripts"
          className="pointer-events-none absolute top-0 left-0 origin-top-left border-0 bg-background"
          style={{
            width: DEMO_PAGE_WIDTH,
            height: size.height / scale,
            transform: `scale(${scale})`,
          }}
        />
      ) : null}
    </div>
  );
}

function DemoCard(props: {
  readonly entry: SlotStatus;
  readonly threadRef: ScopedThreadRef;
  readonly workspaceRoot: string;
  readonly onOpen: (entry: SlotStatus) => void;
}) {
  const gt = useGT();
  const { entry, threadRef, workspaceRoot } = props;
  const ready = isDemoReady(entry.status);
  const httpBaseUrl = useEnvironmentHttpBaseUrl(threadRef.environmentId);
  const createAssetUrl = useAtomQueryRunner(assetEnvironment.createUrl, {
    reportFailure: false,
    refresh: true,
  });
  const [thumbnail, setThumbnail] = useState<{ readonly version: string; readonly url: string }>();
  const version = entry.status.version;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the page is served through a signed asset URL minted by the server for each finished version.
  useEffect(() => {
    if (!ready || httpBaseUrl === null) return;
    let cancelled = false;
    void createAssetUrl({
      environmentId: threadRef.environmentId,
      input: {
        resource: {
          _tag: "workspace-file",
          threadId: threadRef.threadId,
          path: `${workspaceRoot}/${demoPagePath(threadRef.threadId, entry.slot)}`,
        },
      },
    }).then((result) => {
      if (cancelled || result._tag === "Failure") return;
      const url = resolveAssetUrl(httpBaseUrl, result.value.relativeUrl);
      if (url !== null) setThumbnail({ version, url });
    });
    return () => {
      cancelled = true;
    };
  }, [ready, version, httpBaseUrl, createAssetUrl, threadRef, workspaceRoot, entry.slot]);

  return (
    <button
      type="button"
      aria-label={gt("Demo {slot}", { slot: entry.slot })}
      onClick={() => props.onOpen(entry)}
      className="group flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card text-left outline-none transition-[border-color,box-shadow] hover:border-input hover:shadow-md/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      <div className="relative min-h-0 flex-1 overflow-hidden bg-muted">
        {ready ? (
          thumbnail?.version === version ? (
            <DemoThumbnail key={thumbnail.url} url={thumbnail.url} />
          ) : null
        ) : (
          <DemoLoading status={entry.status} />
        )}
      </div>
      <div className="flex h-9 shrink-0 items-center gap-2 border-t px-3 font-medium text-sm">
        <span className="flex size-5 items-center justify-center rounded-md bg-accent text-xs tabular-nums">
          {entry.slot}
        </span>
        <DemoAgentIcon status={entry.status} />
        <span className="truncate">
          <DemoAgentName status={entry.status} />
        </span>
      </div>
    </button>
  );
}

export function DemoPanel(props: {
  readonly threadRef: ScopedThreadRef;
  readonly workspaceRoot: string | undefined;
  readonly visible: boolean;
}) {
  const gt = useGT();
  const { threadRef, workspaceRoot } = props;
  const statuses = useDemoStatuses(
    threadRef.environmentId,
    threadRef.threadId,
    workspaceRoot,
    props.visible,
  );
  const httpBaseUrl = useEnvironmentHttpBaseUrl(threadRef.environmentId);
  const createAssetUrl = useAtomQueryRunner(assetEnvironment.createUrl, { refresh: true });
  const openPreview = useAtomCommand(previewEnvironment.open);
  const closePreview = useAtomCommand(previewEnvironment.close, { reportFailure: false });

  const openDemo = async (entry: SlotStatus) => {
    if (workspaceRoot === undefined || httpBaseUrl === null || !isDemoReady(entry.status)) return;
    const key = `${scopedThreadKey(threadRef)}:${entry.slot}`;
    const previous = openedDemoTabs.get(key);
    const sessions = readThreadPreviewState(threadRef).sessions;
    if (previous && sessions[previous.tabId]) {
      if (previous.version === entry.status.version) {
        useRightPanelStore.getState().openBrowser(threadRef, previous.tabId);
        return;
      }
      await closePreview({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId, tabId: previous.tabId },
      });
    }
    const result = await openFileInPreview({
      threadRef,
      filePath: `${workspaceRoot}/${demoPagePath(threadRef.threadId, entry.slot)}`,
      workspaceRoot,
      httpBaseUrl,
      createAssetUrl,
      openPreview,
    });
    const tabId = readThreadPreviewState(threadRef).activeTabId;
    if (result._tag === "Success" && tabId) {
      openedDemoTabs.set(key, { tabId, version: entry.status.version });
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const entry = statuses?.find((candidate) => String(candidate.slot) === event.key);
    if (!entry) return;
    event.preventDefault();
    void openDemo(entry);
  };

  if (workspaceRoot === undefined || statuses === null) return null;
  if (statuses.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LayoutGrid />
          </EmptyMedia>
          <EmptyTitle>{gt("No demos yet")}</EmptyTitle>
          <EmptyDescription>{gt("Demos show here as agents hand them in.")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2" onKeyDown={onKeyDown}>
      {statuses.map((entry) => (
        <DemoCard
          key={entry.slot}
          entry={entry}
          threadRef={threadRef}
          workspaceRoot={workspaceRoot}
          onOpen={(demo) => void openDemo(demo)}
        />
      ))}
    </div>
  );
}
