import type { ProviderDriverKind, ServerProvider, VibeBossAgentKind } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { T, useGT } from "gt-react";
import { ArrowLeftIcon, BotIcon } from "lucide-react";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import type { ReactNode } from "react";

import { isElectron } from "../../env";
import { useEnvironmentProviders, usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { vibeBossEnvironment } from "../../state/vibeboss";
import { ScrollIcon } from "../animate-ui/icons/scroll";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarInset } from "../ui/sidebar";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
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
  overlay,
  children,
}: {
  title: string;
  actions?: ReactNode;
  /** A second-level page that slides over this one. */
  overlay?: ReactNode;
  children: ReactNode;
}) {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
        <WorkspacePageHeader electron={isElectron} className="border-b">
          <h1 className="flex-1 truncate font-medium text-sm">{title}</h1>
          {actions}
        </WorkspacePageHeader>
        <div className="scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-6">{children}</div>
        </div>
        {overlay}
      </div>
    </SidebarInset>
  );
}

/** Roles and Rules share one sidebar entry; this switch at the top of each page moves between them. */
export function RolesRulesSwitch({ current }: { current: "/agents" | "/rules" }) {
  const navigate = useNavigate();
  return (
    <ToggleGroup
      value={[current]}
      onValueChange={(value) => {
        const next = value[0] as "/agents" | "/rules" | undefined;
        if (next && next !== current) void navigate({ to: next });
      }}
    >
      <ToggleGroupItem value="/agents">
        <BotIcon />
        <T>Roles</T>
      </ToggleGroupItem>
      <ToggleGroupItem value="/rules">
        <ScrollIcon />
        <T>Rules</T>
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

/** A second-level page that slides in over a VibeBoss page; pass it as the page's `overlay`. */
export function VibeBossSubPage(props: {
  readonly open: boolean;
  readonly title: string;
  readonly actions?: ReactNode;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const gt = useGT();
  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence>
        {props.open ? (
          <motion.div
            className="absolute inset-0 z-10 flex flex-col bg-background"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.26, ease: [0.32, 0.72, 0, 1] }}
          >
            <WorkspacePageHeader electron={isElectron} className="border-b">
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={gt("Back")}
                onClick={props.onClose}
              >
                <ArrowLeftIcon />
              </Button>
              <h1 className="flex-1 truncate font-medium text-sm">{props.title}</h1>
              {props.actions}
            </WorkspacePageHeader>
            {props.children}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </MotionConfig>
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
