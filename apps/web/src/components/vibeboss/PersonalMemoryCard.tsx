import type {
  EnvironmentId,
  VibeBossConfig,
  VibeBossPersonalMemoryLogEntry,
  VibeBossPersonalMemoryRunMode,
  VibeBossReviewModel,
} from "@t3tools/contracts";
import { T, useGT, Var } from "gt-react";
import {
  ChevronDownIcon,
  HistoryIcon,
  MoonIcon,
  MessagesSquareIcon,
  UserRoundIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

import { useClientSettings } from "../../hooks/useSettings";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { vibeBossEnvironment } from "../../state/vibeboss";
import { formatDayAwareTimestamp } from "../../timestampFormat";
import { Button } from "../ui/button";
import { Group, GroupSeparator } from "../ui/group";
import { Label } from "../ui/label";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { Sheet, SheetHeader, SheetPopup, SheetTitle } from "../ui/sheet";
import { Spinner } from "../ui/spinner";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { ReviewModelFields } from "./ReviewModelFields";

const SOFT_LIMIT = 6000;
const POLL_MS = 2000;

/** Personal memory on the Rules page: the text itself, its tidy and model, and who changed what. */
export function PersonalMemoryCard(props: {
  readonly environmentId: EnvironmentId;
  readonly config: VibeBossConfig;
  readonly onChange: (text: string) => void;
  /** Saves pending edits before a run reads the saved text. */
  readonly beforeRun: () => Promise<boolean>;
  readonly onSettingsChange: (next: Partial<VibeBossConfig>) => void;
  /** A run or an agent changed the saved text. */
  readonly onChanged: () => void;
}) {
  const gt = useGT();
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const state = useEnvironmentQuery(
    vibeBossEnvironment.personalMemory({ environmentId: props.environmentId, input: {} }),
  );
  const run = useAtomCommand(vibeBossEnvironment.runPersonalMemory);
  const [logOpen, setLogOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const running = state.data?.running ?? null;
  const isRunning = running !== null;
  const text = props.config.sharedRules ?? "";
  const { refresh } = state;
  const { onChanged } = props;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the server runs generate and tidy in the background; poll its progress until it ends
  useEffect(() => {
    if (!isRunning) return;
    const timer = setInterval(refresh, POLL_MS);
    return () => {
      clearInterval(timer);
      refresh();
      onChanged();
    };
  }, [isRunning, refresh, onChanged]);

  const start = async (mode: VibeBossPersonalMemoryRunMode) => {
    setStarting(true);
    if (await props.beforeRun()) {
      await run({ environmentId: props.environmentId, input: { mode } });
      refresh();
    }
    setStarting(false);
  };

  const busy = starting || running !== null;
  const progress =
    running === null ? null : running.phase === "merging" ? (
      <T>Writing personal memory</T>
    ) : (
      <T>
        Reading conversations <Var>{running.done}</Var> / <Var>{running.total}</Var>
      </T>
    );

  if (text.trim() === "" && running === null) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-xl border px-6 py-20 text-center">
        <UserRoundIcon aria-hidden className="size-7 text-muted-foreground" />
        <h2 className="font-medium text-base">
          <T>No personal memory yet</T>
        </h2>
        <div className="flex items-center gap-2">
          <Button disabled={busy} onClick={() => start("generate")}>
            <MessagesSquareIcon />
            <T>Build from past conversations</T>
          </Button>
          <Button variant="outline" onClick={() => props.onChange(`# ${gt("About me")}\n\n`)}>
            <T>Write it myself</T>
          </Button>
        </div>
        {state.data?.lastError ? (
          <p className="text-destructive text-sm">{state.data.lastError}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border">
      <div className="flex min-h-11 items-center gap-2 border-b bg-muted/40 py-1.5 pr-2 pl-4 text-muted-foreground text-xs">
        <span className={text.length > SOFT_LIMIT ? "text-warning tabular-nums" : "tabular-nums"}>
          <T>
            <Var>{text.length.toLocaleString()}</Var> / <Var>{SOFT_LIMIT.toLocaleString()}</Var>{" "}
            characters
          </T>
        </span>
        <span aria-hidden>·</span>
        {progress !== null ? (
          <span className="flex items-center gap-1.5">
            <Spinner />
            {progress}
          </span>
        ) : state.data?.lastError ? (
          <span className="truncate text-destructive">{state.data.lastError}</span>
        ) : state.data?.lastTidyAt ? (
          <span>
            <T>
              Tidied <Var>{formatDayAwareTimestamp(state.data.lastTidyAt, timestampFormat)}</Var>
            </T>
          </span>
        ) : (
          <span>
            <T>Not tidied yet</T>
          </span>
        )}
        <span className="flex-1" />
        <Button size="sm" variant="ghost" onClick={() => setLogOpen(true)}>
          <HistoryIcon />
          <T>History</T>
        </Button>
        <TidyButton
          environmentId={props.environmentId}
          config={props.config}
          disabled={busy}
          onTidy={() => start("tidy")}
          onSettingsChange={props.onSettingsChange}
        />
      </div>
      <div className="p-3">
        <Textarea
          aria-label={gt("Personal memory")}
          className="min-h-96"
          value={text}
          onChange={(event) => props.onChange(event.target.value)}
        />
      </div>
      <Sheet open={logOpen} onOpenChange={setLogOpen}>
        <SheetPopup side="right">
          <SheetHeader>
            <SheetTitle>
              <T>History</T>
            </SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-6 pb-6">
            <HistoryList entries={state.data?.log ?? []} />
          </div>
        </SheetPopup>
      </Sheet>
    </div>
  );
}

function TidyButton(props: {
  readonly environmentId: EnvironmentId;
  readonly config: VibeBossConfig;
  readonly disabled: boolean;
  readonly onTidy: () => void;
  readonly onSettingsChange: (next: Partial<VibeBossConfig>) => void;
}) {
  const gt = useGT();
  return (
    <Group>
      <Button size="sm" variant="outline" disabled={props.disabled} onClick={props.onTidy}>
        <MoonIcon />
        <T>Tidy</T>
      </Button>
      <GroupSeparator />
      <Popover>
        <PopoverTrigger
          render={
            <Button
              size="icon-sm"
              variant="outline"
              aria-label={gt("Model used for personal memory")}
            />
          }
        >
          <ChevronDownIcon />
        </PopoverTrigger>
        <PopoverPopup align="end" className="w-72">
          <div className="flex flex-col gap-2">
            <PopoverTitle>
              <T>Model used for personal memory</T>
            </PopoverTitle>
            <ReviewModelFields
              environmentId={props.environmentId}
              value={props.config.memoryModel}
              onChange={(memoryModel: VibeBossReviewModel) =>
                props.onSettingsChange({ memoryModel })
              }
            />
            <div className="mt-1 flex items-center justify-between gap-2 border-t pt-3">
              <Label htmlFor="personal-memory-auto-tidy">
                <T>Tidy every day</T>
              </Label>
              <Switch
                id="personal-memory-auto-tidy"
                checked={props.config.memoryAutoTidy !== false}
                onCheckedChange={(memoryAutoTidy) => props.onSettingsChange({ memoryAutoTidy })}
              />
            </div>
          </div>
        </PopoverPopup>
      </Popover>
    </Group>
  );
}

function HistoryList(props: { readonly entries: ReadonlyArray<VibeBossPersonalMemoryLogEntry> }) {
  const gt = useGT();
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  if (props.entries.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        <T>No changes yet</T>
      </p>
    );
  }
  const who = (entry: VibeBossPersonalMemoryLogEntry) => {
    switch (entry.author) {
      case "agent":
        return gt("Lead", { $context: "the lead agent that wrote personal memory" });
      case "user":
        return gt("You");
      case "tidy":
        return gt("Tidy");
      case "generate":
        return gt("Built from conversations");
    }
  };
  const detail = (entry: VibeBossPersonalMemoryLogEntry) =>
    entry.conversations === undefined
      ? entry.source
      : gt("{count} conversations · {model}", {
          count: entry.conversations,
          model: entry.source,
        });
  return (
    <div className="flex flex-col divide-y">
      {props.entries.map((entry) => (
        <div key={entry.id} className="flex flex-col gap-1.5 py-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium">{who(entry)}</span>
            <span className="flex-1" />
            <span className="text-muted-foreground text-xs tabular-nums">
              {formatDayAwareTimestamp(entry.at, timestampFormat)}
            </span>
          </div>
          {detail(entry) === "" ? null : (
            <span className="truncate text-muted-foreground text-xs">{detail(entry)}</span>
          )}
          {entry.added.map((line) => (
            <span
              key={`+${line}`}
              className="whitespace-pre-wrap rounded bg-success/10 px-2 font-mono text-xs leading-6"
            >
              {line}
            </span>
          ))}
          {entry.removed.map((line) => (
            <span
              key={`-${line}`}
              className="whitespace-pre-wrap rounded bg-destructive/10 px-2 font-mono text-muted-foreground text-xs leading-6 line-through"
            >
              {line}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
