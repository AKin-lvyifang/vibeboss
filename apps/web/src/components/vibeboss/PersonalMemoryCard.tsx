import { useNavigate } from "@tanstack/react-router";
import {
  textGeneratorForSelection,
  type EnvironmentId,
  type VibeBossConfig,
  type VibeBossMemoryApi,
  type VibeBossPersonalMemoryLogEntry,
  type VibeBossPersonalMemoryRunMode,
} from "@t3tools/contracts";
import { T, useGT, Var } from "gt-react";
import {
  ChevronDownIcon,
  HistoryIcon,
  MoonIcon,
  MessagesSquareIcon,
  UserRoundIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { useClientSettings, useEnvironmentSettings } from "../../hooks/useSettings";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { vibeBossEnvironment } from "../../state/vibeboss";
import { useTextGenerationTargets } from "../../textGenerators";
import { formatDayAwareTimestamp } from "../../timestampFormat";
import { Button } from "../ui/button";
import { Group, GroupSeparator } from "../ui/group";
import { Label } from "../ui/label";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { Sheet, SheetHeader, SheetPopup, SheetTitle } from "../ui/sheet";
import { Spinner } from "../ui/spinner";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { ModelSelect } from "./MemberFields";
import { ProviderSelect } from "./VibeBossShared";

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
  const textGenerators = useEnvironmentSettings(
    props.environmentId,
    (settings) => settings.textGenerators,
  );
  const api = props.config.memoryApi;
  const apiReady =
    api !== undefined &&
    api.model !== "" &&
    textGeneratorForSelection({ textGenerators }, api.generatorId)?.enabled === true;
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
          <RunButton
            environmentId={props.environmentId}
            config={props.config}
            ready={apiReady}
            disabled={busy}
            onRun={() => start("generate")}
            onSettingsChange={props.onSettingsChange}
          >
            <MessagesSquareIcon />
            <T>Build from past conversations</T>
          </RunButton>
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
        <RunButton
          environmentId={props.environmentId}
          config={props.config}
          ready={apiReady}
          disabled={busy}
          size="sm"
          onRun={() => start("tidy")}
          onSettingsChange={props.onSettingsChange}
        >
          <MoonIcon />
          <T>Tidy</T>
        </RunButton>
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

/** Runs generate or tidy. Without an API model it opens the picker instead. */
function RunButton(props: {
  readonly environmentId: EnvironmentId;
  readonly config: VibeBossConfig;
  readonly ready: boolean;
  readonly disabled: boolean;
  readonly size?: "sm";
  readonly onRun: () => void;
  readonly onSettingsChange: (next: Partial<VibeBossConfig>) => void;
  readonly children: ReactNode;
}) {
  const gt = useGT();
  const [open, setOpen] = useState(false);
  const small = props.size === "sm";
  const variant = small ? "outline" : "default";
  return (
    <Group>
      <Button
        size={small ? "sm" : "default"}
        variant={variant}
        disabled={props.disabled}
        onClick={() => (props.ready ? props.onRun() : setOpen(true))}
      >
        {props.children}
      </Button>
      <GroupSeparator />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              size={small ? "icon-sm" : "icon"}
              variant={variant}
              aria-label={gt("API model for personal memory")}
            />
          }
        >
          <ChevronDownIcon />
        </PopoverTrigger>
        <PopoverPopup align="end" className="w-72">
          <div className="flex flex-col gap-2">
            <PopoverTitle>
              <T>API model for personal memory</T>
            </PopoverTitle>
            <MemoryApiFields
              environmentId={props.environmentId}
              value={props.config.memoryApi}
              onChange={(memoryApi) => props.onSettingsChange({ memoryApi })}
            />
            <div className="mt-1 flex items-center justify-between gap-2 border-t pt-3">
              <Label htmlFor="personal-memory-auto-tidy">
                <T>Tidy every day</T>
              </Label>
              <Switch
                id="personal-memory-auto-tidy"
                disabled={!props.ready}
                checked={props.ready && props.config.memoryAutoTidy === true}
                onCheckedChange={(memoryAutoTidy) => props.onSettingsChange({ memoryAutoTidy })}
              />
            </div>
          </div>
        </PopoverPopup>
      </Popover>
    </Group>
  );
}

/** The text generators from Settings and their models; agents are not offered. */
function MemoryApiFields(props: {
  readonly environmentId: EnvironmentId;
  readonly value: VibeBossMemoryApi | undefined;
  readonly onChange: (value: VibeBossMemoryApi) => void;
}) {
  const navigate = useNavigate();
  const settings = useEnvironmentSettings(props.environmentId);
  const { providers } = useTextGenerationTargets({
    environmentId: props.environmentId,
    settings,
    providers: [],
    projectId: null,
    selections:
      props.value === undefined
        ? []
        : [{ instanceId: props.value.generatorId, model: props.value.model }],
  });
  if (providers.length === 0) {
    return (
      <Button variant="outline" onClick={() => void navigate({ to: "/settings/providers" })}>
        <T>Add an API in Settings</T>
      </Button>
    );
  }
  const generatorId = props.value?.generatorId ?? providers[0]!.instanceId;
  const provider = providers.find((item) => item.instanceId === generatorId);
  const firstModel = provider?.models[0]?.slug ?? "";
  return (
    <>
      <PickFirstModel
        pending={(props.value?.model ?? "") === "" && firstModel !== ""}
        onPick={() => props.onChange({ generatorId, model: firstModel })}
      />
      <ProviderSelect
        value={generatorId}
        providers={providers}
        onChange={(id) => {
          const next = providers.find((item) => item.instanceId === id);
          if (next)
            props.onChange({ generatorId: next.instanceId, model: next.models[0]?.slug ?? "" });
        }}
      />
      <ModelSelect
        provider={provider}
        value={props.value?.model ?? ""}
        onChange={(model) => props.onChange({ generatorId, model })}
      />
    </>
  );
}

/** Saves the first model once the list loads, so opening the picker is enough to start. */
function PickFirstModel(props: { readonly pending: boolean; readonly onPick: () => void }) {
  const { pending, onPick } = props;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the API's model list loads after the picker opens
  useEffect(() => {
    if (pending) onPick();
  }, [pending, onPick]);
  return null;
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
