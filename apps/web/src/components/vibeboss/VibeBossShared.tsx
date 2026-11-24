import type { ProviderDriverKind, ServerProvider, VibeBossAgentKind } from "@t3tools/contracts";
import { useGT } from "gt-react";
import type { ReactNode } from "react";

import { isElectron } from "../../env";
import { useEnvironmentProviders, usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { vibeBossEnvironment } from "../../state/vibeboss";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarInset } from "../ui/sidebar";
import { WorkspacePageHeader } from "../WorkspacePageHeader";

export const AGENT_KINDS: ReadonlyArray<VibeBossAgentKind> = ["claude", "codex", "agy"];

// Product names stay English in every language.
const AGENT_LABEL: Record<VibeBossAgentKind, string> = {
  claude: "Claude",
  codex: "Codex",
  agy: "Agy",
};

const AGENT_DRIVER: Record<VibeBossAgentKind, ProviderDriverKind> = {
  claude: "claudeAgent" as ProviderDriverKind,
  codex: "codex" as ProviderDriverKind,
  agy: "antigravity" as ProviderDriverKind,
};

const DRIVER_LABEL: Partial<Record<string, string>> = {
  claudeAgent: "Claude",
  codex: "Codex",
  antigravity: "Agy",
};

export function AgentIcon({ kind, dim = false }: { kind: VibeBossAgentKind; dim?: boolean }) {
  return (
    <span className={dim ? "opacity-25" : undefined}>
      <ProviderInstanceIcon driverKind={AGENT_DRIVER[kind]} displayName={AGENT_LABEL[kind]} />
    </span>
  );
}

function providerName(provider: ServerProvider): string {
  return provider.displayName ?? DRIVER_LABEL[provider.driver] ?? provider.instanceId;
}

function ProviderIcon({ provider }: { provider: ServerProvider }) {
  return (
    <ProviderInstanceIcon
      driverKind={provider.driver}
      displayName={providerName(provider)}
      acpRegistryIconUrl={provider.iconUrl}
    />
  );
}

/** Enabled agents of the primary environment, the ones VibeBoss can assign work to. */
export function useEnabledProviders(): ReadonlyArray<ServerProvider> {
  const environmentId = usePrimaryEnvironmentId();
  const providersByEnvironment = useEnvironmentProviders();
  const providers = environmentId === null ? [] : (providersByEnvironment.get(environmentId) ?? []);
  return providers.filter((provider) => provider.enabled);
}

export function ProviderSelect({
  value,
  providers,
  onChange,
}: {
  value: string;
  providers: ReadonlyArray<ServerProvider>;
  onChange: (instanceId: string) => void;
}) {
  const gt = useGT();
  const selected = providers.find((provider) => provider.instanceId === value);
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (typeof next === "string") onChange(next);
      }}
    >
      <SelectTrigger size="sm" aria-label={gt("Agent")} className="w-full">
        <SelectValue>
          {() =>
            selected ? (
              <span className="flex min-w-0 items-center gap-2">
                <ProviderIcon provider={selected} />
                <span className="truncate">{providerName(selected)}</span>
              </span>
            ) : (
              <span className="truncate text-warning">
                {gt("{agent} is off", { agent: value })}
              </span>
            )
          }
        </SelectValue>
      </SelectTrigger>
      <SelectPopup>
        {providers.map((provider) => (
          <SelectItem key={provider.instanceId} value={provider.instanceId}>
            <span className="flex items-center gap-2">
              <ProviderIcon provider={provider} />
              {providerName(provider)}
            </span>
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

export function VibeBossPage({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        <WorkspacePageHeader electron={isElectron} className="border-b">
          <h1 className="flex-1 truncate font-medium text-sm">{title}</h1>
          {actions}
        </WorkspacePageHeader>
        <div className="scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-6">{children}</div>
        </div>
      </div>
    </SidebarInset>
  );
}

export function useVibeBossState() {
  const environmentId = usePrimaryEnvironmentId();
  const query = useEnvironmentQuery(
    environmentId === null ? null : vibeBossEnvironment.state({ environmentId, input: {} }),
  );
  return { environmentId, ...query };
}

const MENTION_TAIL = "(?![\\p{L}\\p{N}_-])";

/** Keeps `@name` references in the lead rules pointing at a member after it is renamed. */
export function renameMention(text: string, from: string, to: string): string {
  if (from === "" || from === to) return text;
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`@${escaped}${MENTION_TAIL}`, "gu"), `@${to}`);
}
