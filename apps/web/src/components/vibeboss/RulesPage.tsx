import type { VibeBossAgentKind, VibeBossConfig } from "@t3tools/contracts";
import { T, useGT, Var } from "gt-react";
import { useState, type ReactNode } from "react";

import { cn } from "../../lib/utils";
import { useAtomCommand } from "../../state/use-atom-command";
import { vibeBossEnvironment } from "../../state/vibeboss";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import {
  AGENT_KINDS,
  AGENT_LABEL,
  AgentIcon,
  VibeBossPage,
  useVibeBossState,
} from "./VibeBossShared";

type RuleTab = VibeBossAgentKind | "shared";

function NavButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm",
        active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60",
      )}
    >
      {children}
    </button>
  );
}

function Block({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="border-b px-4 py-3 last:border-b-0">
      <div className="mb-1 text-muted-foreground text-xs">{label}</div>
      {children}
    </div>
  );
}

export function RulesPage() {
  const gt = useGT();
  const { environmentId, data, error, refresh } = useVibeBossState();
  const saveConfig = useAtomCommand(vibeBossEnvironment.saveConfig);
  const syncRules = useAtomCommand(vibeBossEnvironment.syncRules);
  const [tab, setTab] = useState<RuleTab>("claude");
  const [draft, setDraft] = useState<VibeBossConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [backups, setBackups] = useState<number | null>(null);
  const config = draft ?? data?.config ?? null;
  const outOfSync = data?.files.some((file) => !file.inSync) ?? false;

  const update = (next: Partial<VibeBossConfig>) => {
    if (config !== null) setDraft({ ...config, ...next });
  };

  const saveAndSync = async () => {
    if (environmentId === null) return;
    setBusy(true);
    setBackups(null);
    if (draft !== null) {
      const saved = await saveConfig({ environmentId, input: { config: draft } });
      if (saved._tag !== "Success") {
        setBusy(false);
        return;
      }
      setDraft(null);
    }
    const synced = await syncRules({ environmentId, input: {} });
    setBusy(false);
    if (synced._tag === "Success") setBackups(synced.value.backups.length);
    refresh();
  };

  const file = tab === "shared" ? null : (data?.files.find((item) => item.kind === tab) ?? null);

  return (
    <VibeBossPage
      title={gt("Rules")}
      actions={
        <>
          {backups !== null ? (
            <span className="text-muted-foreground text-xs">
              {backups > 0 ? (
                <T>
                  Synced. Backed up <Var>{backups}</Var> original files.
                </T>
              ) : (
                <T>Synced.</T>
              )}
            </span>
          ) : null}
          <Button size="sm" disabled={busy || (draft === null && !outOfSync)} onClick={saveAndSync}>
            <T>Sync to all agents</T>
          </Button>
        </>
      }
    >
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      {data?.previewOnly ? (
        <p className="rounded-lg border border-dashed px-3 py-2 text-muted-foreground text-xs">
          <T>
            Development build: syncing writes to a preview folder and leaves your real global rules
            untouched.
          </T>
        </p>
      ) : null}
      {config === null ? null : (
        <div className="grid gap-6 md:grid-cols-[200px_1fr]">
          <nav className="flex flex-col gap-1">
            <div className="px-2.5 pt-1 pb-0.5 text-muted-foreground text-xs">
              <T>Global rules per agent</T>
            </div>
            {AGENT_KINDS.map((kind) => (
              <NavButton key={kind} active={tab === kind} onClick={() => setTab(kind)}>
                <AgentIcon kind={kind} />
                {AGENT_LABEL[kind]}
              </NavButton>
            ))}
            <div className="px-2.5 pt-3 pb-0.5 text-muted-foreground text-xs">
              <T>Used by all agents</T>
            </div>
            <NavButton active={tab === "shared"} onClick={() => setTab("shared")}>
              <T>Shared</T>
            </NavButton>
          </nav>
          {tab === "shared" ? (
            <Textarea
              aria-label={gt("Shared")}
              className="min-h-80"
              placeholder={gt("Tone, style and general principles every agent follows")}
              value={config.shared}
              onChange={(event) => update({ shared: event.target.value })}
            />
          ) : (
            <div className="overflow-hidden rounded-xl border">
              <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2 font-mono text-xs">
                <span className="min-w-0 flex-1 truncate">{file?.path}</span>
                <span className={file?.inSync ? "text-success" : "text-warning"}>
                  {file?.inSync ? <T>Synced</T> : <T>Not synced</T>}
                </span>
              </div>
              <Block label={<T>Shared</T>}>
                <pre className="whitespace-pre-wrap font-mono text-muted-foreground text-xs leading-6">
                  {config.shared.trim() || gt("(empty)")}
                </pre>
              </Block>
              <Block label={<T>Collaboration guide · edit it on the Agents page</T>}>
                <pre className="whitespace-pre-wrap font-mono text-muted-foreground text-xs leading-6">
                  {config.coop}
                </pre>
              </Block>
              <Block
                label={
                  <T>
                    Only for <Var>{AGENT_LABEL[tab]}</Var>
                  </T>
                }
              >
                <Textarea
                  aria-label={gt("Only for {agent}", { agent: AGENT_LABEL[tab] })}
                  className="min-h-64"
                  value={config.perAgent[tab]}
                  onChange={(event) =>
                    update({ perAgent: { ...config.perAgent, [tab]: event.target.value } })
                  }
                />
              </Block>
            </div>
          )}
        </div>
      )}
    </VibeBossPage>
  );
}
