import type { ProviderDriverKind, VibeBossAgentKind } from "@t3tools/contracts";
import type { ReactNode } from "react";

import { isElectron } from "../../env";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { vibeBossEnvironment } from "../../state/vibeboss";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { SidebarInset } from "../ui/sidebar";
import { WorkspacePageHeader } from "../WorkspacePageHeader";

export const AGENT_KINDS: ReadonlyArray<VibeBossAgentKind> = ["claude", "codex", "agy"];

// Product names stay English in every language.
export const AGENT_LABEL: Record<VibeBossAgentKind, string> = {
  claude: "Claude",
  codex: "Codex",
  agy: "Agy",
};

const AGENT_DRIVER: Record<VibeBossAgentKind, ProviderDriverKind> = {
  claude: "claudeAgent" as ProviderDriverKind,
  codex: "codex" as ProviderDriverKind,
  agy: "antigravity" as ProviderDriverKind,
};

export function AgentIcon({ kind, dim = false }: { kind: VibeBossAgentKind; dim?: boolean }) {
  return (
    <span className={dim ? "opacity-25" : undefined}>
      <ProviderInstanceIcon driverKind={AGENT_DRIVER[kind]} displayName={AGENT_LABEL[kind]} />
    </span>
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
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-6">{children}</div>
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
