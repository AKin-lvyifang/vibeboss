import { pipe } from "effect/Function";
import {
  ACP_REGISTRY_MAX_AGENTS,
  ACP_REGISTRY_SEARCH_QUERY_MAX_LENGTH,
  AuthProvidersManageScope,
} from "@t3tools/contracts";
import { readEnvironmentScope, useEnvironmentScope } from "../../state/session";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  AcpRegistryPrepareResult,
  AcpRegistrySearchAgent,
  EnvironmentId,
  ProviderInstanceConfig,
} from "@t3tools/contracts";
import { ExternalLinkIcon, SearchIcon } from "lucide-react";
import { msg, T, useGT, useMessages, Var } from "gt-react";
import { type FormEvent, type ReactNode, useState } from "react";

import { useDeadlinePassed } from "../../hooks/useDeadline";
import { m } from "../../i18n/messages";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { ScrollArea } from "../ui/scroll-area";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { isConfiguredAcpRegistryAgent } from "./AddProviderInstanceDialog.logic";
import { ProviderDriverKind } from "@t3tools/contracts";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { providerClients } from "./providerDriverMeta";
import {
  ACP_LOCAL_PRESETS,
  type AcpLocalPreset,
  acpLocalPresetForCommand,
  matchesAcpLocalPreset,
} from "./acpLocalPresets";

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : m(msg("The ACP could not be prepared."));
}

const ACP_REGISTRY_SEARCH_DEBOUNCE_MS = 300;
const FIRST_CLASS_REGISTRY_AGENT_IDS = new Set(
  providerClients.definitions.flatMap((definition) => definition.acpRegistryAgentIds ?? []),
);

function applyAcpRegistryPrepareResult(
  agent: AcpRegistrySearchAgent,
  prepared: AcpRegistryPrepareResult,
): AcpRegistrySearchAgent {
  return {
    ...agent,
    id: prepared.agentId,
    version: prepared.version,
    distribution: prepared.distribution,
  };
}

/**
 * Registry search and agent preparation. Owned by the dialog, which needs the
 * loading and preparing state for its layout and navigation, and rendered by
 * AcpRegistrySearchStep. Pass `enabled: false` while the step is hidden so the
 * search is not kept subscribed.
 */
export function useAcpRegistrySearch(environmentId: EnvironmentId, enabled: boolean) {
  const [input, setInput] = useState<{
    readonly text: string;
    readonly submitted: string;
    readonly typedAt: number | null;
  }>({ text: "", submitted: "", typedAt: null });
  const typingSettled = useDeadlinePassed(
    input.typedAt === null ? null : input.typedAt + ACP_REGISTRY_SEARCH_DEBOUNCE_MS,
  );
  const submittedQuery = typingSettled ? input.text.trim() : input.submitted;
  const [preparingId, setPreparingId] = useState<string | null>(null);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const search = useEnvironmentQuery(
    enabled
      ? serverEnvironment.searchAcpRegistry({
          environmentId,
          input: submittedQuery
            ? { query: submittedQuery }
            : { query: "", limit: ACP_REGISTRY_MAX_AGENTS },
        })
      : null,
    useMessages(),
  );
  const prepareAgent = useAtomCommand(serverEnvironment.prepareAcpRegistryAgent, {
    reportFailure: false,
  });

  return {
    query: input.text,
    search,
    preparingId,
    prepareError,
    type: (text: string) => {
      setPrepareError(null);
      setInput({
        text: text.slice(0, ACP_REGISTRY_SEARCH_QUERY_MAX_LENGTH),
        submitted: submittedQuery,
        typedAt: Date.now(),
      });
    },
    submit: () => {
      const trimmed = input.text.trim();
      setPrepareError(null);
      setInput({ text: trimmed, submitted: trimmed, typedAt: null });
      if (trimmed === submittedQuery) search.refresh();
    },
    prepare: async (
      agent: AcpRegistrySearchAgent,
      onPrepared: (agent: AcpRegistrySearchAgent) => void,
    ) => {
      if (!readEnvironmentScope(environmentId, AuthProvidersManageScope)) return;
      setPrepareError(null);
      setPreparingId(agent.id);
      const result = await prepareAgent({ environmentId, input: { agentId: agent.id } });
      setPreparingId(null);
      if (result._tag === "Success") {
        onPrepared(applyAcpRegistryPrepareResult(agent, result.value));
        return;
      }
      if (!isAtomCommandInterrupted(result)) {
        pipe(squashAtomCommandFailure(result), errorMessage, setPrepareError);
      }
    },
  };
}

export type AcpRegistrySearch = ReturnType<typeof useAcpRegistrySearch>;

interface AcpRegistrySearchStepProps {
  readonly environmentId: EnvironmentId;
  readonly registry: AcpRegistrySearch;
  readonly providerInstances: Readonly<Record<string, ProviderInstanceConfig>>;
  readonly onPrepared: (agent: AcpRegistrySearchAgent) => void;
  readonly onManualConfiguration: () => void;
  readonly onLocalConfiguration?: () => void;
  readonly onPresetSelected?: (preset: AcpLocalPreset) => void;
}

function isConfiguredAcpLocalPreset(
  providerInstances: Readonly<Record<string, ProviderInstanceConfig>>,
  presetId: string,
): boolean {
  return Object.values(providerInstances).some((instance) => {
    const config = instance.config as Readonly<Record<string, unknown>> | undefined;
    const commandPath = typeof config?.commandPath === "string" ? config.commandPath : null;
    return (
      instance.driver === "acpRegistry" &&
      config?.source === "local" &&
      acpLocalPresetForCommand(commandPath)?.id === presetId
    );
  });
}

export function AcpRegistrySearchStep({
  environmentId,
  registry,
  providerInstances,
  onPrepared,
  onManualConfiguration,
  onLocalConfiguration,
  onPresetSelected,
}: AcpRegistrySearchStepProps) {
  const gt = useGT();
  const canManageProviders = useEnvironmentScope(environmentId, AuthProvidersManageScope);
  const { query, search, preparingId, prepareError } = registry;

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    registry.submit();
  };

  const handlePrepare = (agent: AcpRegistrySearchAgent) => {
    void registry.prepare(agent, onPrepared);
  };

  const results =
    search.data?.agents.filter((agent) => !FIRST_CLASS_REGISTRY_AGENT_IDS.has(agent.id)) ?? null;
  const isInitialSearch = search.isPending && results === null;
  const isRefreshing = search.isPending && results !== null;
  const presets = onPresetSelected
    ? ACP_LOCAL_PRESETS.filter((preset) => matchesAcpLocalPreset(preset, query))
    : [];
  const resultCount = results?.length ?? 0;

  return (
    <section className="grid gap-3" aria-labelledby="acp-registry-search-heading">
      <h3 className="sr-only" id="acp-registry-search-heading">
        <T>Choose an agent</T>
      </h3>

      <form className="flex flex-wrap items-center gap-2" onSubmit={handleSearch}>
        <InputGroup className="min-w-40 flex-1">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          {/* Native search inputs clear on Escape even during IME composition. */}
          <InputGroupInput
            aria-label={gt("Search ACP Registry")}
            maxLength={ACP_REGISTRY_SEARCH_QUERY_MAX_LENGTH}
            disabled={preparingId !== null}
            enterKeyHint="search"
            onChange={(event) => registry.type(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape" || event.defaultPrevented) return;
              if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
              const composing = event.nativeEvent.isComposing || event.keyCode === 229;
              if (!composing && !query && !event.repeat) return;
              event.stopPropagation();
              if (composing) return;
              event.preventDefault();
              if (query) registry.type("");
            }}
            placeholder={gt("Search agents…")}
            role="searchbox"
            size="sm"
            type="text"
            value={query}
          />
        </InputGroup>
        <Button
          disabled={preparingId !== null}
          onClick={onManualConfiguration}
          size="sm"
          type="button"
          variant="ghost-muted"
        >
          <T>Enter manually</T>
        </Button>
        {onLocalConfiguration ? (
          <Button
            disabled={preparingId !== null}
            onClick={onLocalConfiguration}
            size="sm"
            type="button"
            variant="outline"
          >
            <T>Local ACP command</T>
          </Button>
        ) : null}
      </form>

      <div className="sr-only" role="status">
        {isInitialSearch
          ? gt("Searching the ACP Registry.")
          : isRefreshing
            ? gt("Refreshing ACP Registry results.")
            : results
              ? gt(
                  "{count, plural, one {{count} compatible agent found.} other {{count} compatible agents found.}}",
                  { count: resultCount },
                )
              : ""}
      </div>

      {search.error || prepareError ? (
        <Alert variant="error" role="status" aria-live="polite">
          <AlertDescription>{prepareError ?? search.error}</AlertDescription>
        </Alert>
      ) : null}

      {isInitialSearch ? (
        <div className="flex min-h-20 items-center justify-center text-sm text-muted-foreground">
          <T>Searching the registry...</T>
        </div>
      ) : null}

      {results || presets.length > 0 ? (
        resultCount === 0 && presets.length === 0 ? (
          <div className="flex min-h-28 flex-col items-center justify-center rounded-2xl border border-dashed px-4 text-center">
            <p className="text-sm font-medium">
              <T>No compatible agents found</T>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              <T>Try a broader search.</T>
            </p>
          </div>
        ) : (
          <ScrollArea scrollFade className="max-h-64">
            <div className="pr-2.5">
              {presets.map((preset) => {
                const alreadyAdded = isConfiguredAcpLocalPreset(providerInstances, preset.id);
                return (
                  <AgentRow
                    key={`preset:${preset.id}`}
                    icon={<preset.Icon className="size-6 text-muted-foreground" aria-hidden />}
                    name={preset.name}
                    description={preset.description()}
                    aboutUrl={preset.website}
                    alreadyAdded={alreadyAdded}
                    canAdd={canManageProviders && preparingId === null}
                    isPreparing={false}
                    progressLabel=""
                    preparingAriaLabel=""
                    onAdd={() => onPresetSelected?.(preset)}
                  />
                );
              })}
              {(results ?? []).map((agent) => (
                <AcpRegistryAgentRow
                  agent={agent}
                  alreadyAdded={isConfiguredAcpRegistryAgent(providerInstances, agent.id)}
                  canAdd={canManageProviders && preparingId === null}
                  isPreparing={preparingId === agent.id}
                  key={agent.id}
                  onAdd={handlePrepare}
                />
              ))}
            </div>
          </ScrollArea>
        )
      ) : null}
    </section>
  );
}

function AcpRegistryAgentRow({
  agent,
  alreadyAdded,
  canAdd,
  isPreparing,
  onAdd,
}: {
  readonly agent: AcpRegistrySearchAgent;
  readonly alreadyAdded: boolean;
  readonly canAdd: boolean;
  readonly isPreparing: boolean;
  readonly onAdd: (agent: AcpRegistrySearchAgent) => void;
}) {
  const gt = useGT();
  return (
    <AgentRow
      icon={
        <ProviderInstanceIcon
          driverKind={ProviderDriverKind.make("acpRegistry")}
          displayName={agent.name}
          acpRegistryAgentId={agent.id}
          acpRegistryIconUrl={agent.icon ?? undefined}
          iconClassName="size-6 rounded-md text-muted-foreground"
        />
      }
      name={agent.name}
      description={agent.description}
      aboutUrl={agent.website || agent.repository}
      alreadyAdded={alreadyAdded}
      canAdd={canAdd}
      isPreparing={isPreparing}
      progressLabel={agent.distribution === "binary" ? gt("Downloading") : gt("Preparing")}
      preparingAriaLabel={
        agent.distribution === "binary"
          ? gt("Downloading {name}", { name: agent.name })
          : gt("Preparing {name}", { name: agent.name })
      }
      onAdd={() => onAdd(agent)}
    />
  );
}

function AgentRow({
  icon,
  name,
  description,
  aboutUrl,
  alreadyAdded,
  canAdd,
  isPreparing,
  progressLabel,
  preparingAriaLabel,
  onAdd,
}: {
  readonly icon: ReactNode;
  readonly name: string;
  readonly description: string | null | undefined;
  readonly aboutUrl: string | null | undefined;
  readonly alreadyAdded: boolean;
  readonly canAdd: boolean;
  readonly isPreparing: boolean;
  readonly progressLabel: string;
  readonly preparingAriaLabel: string;
  readonly onAdd: () => void;
}) {
  const gt = useGT();
  return (
    <article className="min-w-0 py-2.5">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {icon}
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-baseline gap-2">
              <h4 className="min-w-0 truncate text-sm font-medium text-foreground">{name}</h4>
            </div>
            {description ? (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{description}</p>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {aboutUrl ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost-muted"
                    aria-label={gt("About {name}", { name })}
                    render={<a href={aboutUrl} target="_blank" rel="noreferrer" />}
                  >
                    <ExternalLinkIcon />
                  </Button>
                }
              />
              <TooltipPopup>
                <T>
                  About <Var>{name}</Var>
                </T>
              </TooltipPopup>
            </Tooltip>
          ) : null}
          <Button
            aria-label={
              alreadyAdded
                ? gt("Already added {name}", { name })
                : isPreparing
                  ? preparingAriaLabel
                  : gt("Add {name}", { name })
            }
            disabled={!canAdd || alreadyAdded}
            onClick={onAdd}
            size="xs"
            variant={isPreparing ? "secondary" : "outline"}
          >
            {alreadyAdded
              ? gt("Added")
              : isPreparing
                ? progressLabel
                : gt("Add", { $context: "verb, adds an agent" })}
          </Button>
        </div>
      </div>
    </article>
  );
}
