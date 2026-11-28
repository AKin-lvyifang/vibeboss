import type {
  ProviderDriverKind,
  VibeBossConfig,
  VibeBossReviewModel,
  VibeBossRuleSuggestion,
} from "@t3tools/contracts";
import { T, useGT, Var } from "gt-react";
import { AtSignIcon, CrownIcon, LayersIcon } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

import { cn } from "../../lib/utils";
import { useAtomCommand } from "../../state/use-atom-command";
import { vibeBossEnvironment } from "../../state/vibeboss";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Textarea } from "../ui/textarea";
import { applyRuleSuggestion } from "../../vibebossRuleEdits";
import { setRulesPage, useRulesPageStore } from "../../vibebossRuleReviewStore";
import { RuleCheckButton } from "./RuleCheckButton";
import { RuleReviewPanel } from "./RuleReviewPanel";
import { VibeBossPage, useVibeBossState, RolesRulesSwitch } from "./VibeBossShared";

const LEAD_TAB = "lead-rules";
const SHARED_TAB = "shared-rules";

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

/** Folder in muted text, file name in full, so the user sees exactly which file is written. */
function FilePath({ path }: { path: string }) {
  const cut = path.lastIndexOf("/") + 1;
  return (
    <span className="min-w-0 flex-1 truncate font-mono text-xs">
      <span className="text-muted-foreground">{path.slice(0, cut)}</span>
      <span className="font-medium text-foreground">{path.slice(cut)}</span>
    </span>
  );
}

function AppendedBlock({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="border-t px-4 py-3">
      <div className="mb-1 text-muted-foreground text-xs">{label}</div>
      <pre className="whitespace-pre-wrap font-mono text-muted-foreground text-xs leading-6">
        {children}
      </pre>
    </div>
  );
}

export function RulesPage() {
  const gt = useGT();
  const { environmentId, data, error, refresh } = useVibeBossState();
  const saveConfig = useAtomCommand(vibeBossEnvironment.saveConfig);
  const syncRules = useAtomCommand(vibeBossEnvironment.syncRules);
  const reviewRules = useAtomCommand(vibeBossEnvironment.reviewRules);
  const { draft, review, handled, applied, checking, modelStartedAt, lastModelMs } =
    useRulesPageStore();
  const modelReviewing = modelStartedAt !== null;
  const setDraft = (next: VibeBossConfig | null) => setRulesPage({ draft: next });
  const [selectedTab, setTab] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [backups, setBackups] = useState<number | null>(null);
  const leadRulesRef = useRef<HTMLTextAreaElement>(null);
  const config = draft ?? data?.config ?? null;
  const files = data?.files ?? [];
  const outOfSync = files.some((file) => !file.inSync);
  const tab = selectedTab ?? LEAD_TAB;
  const file = files.find((item) => item.targetId === tab) ?? null;
  const leadFile = files.find((item) => item.isLead) ?? null;

  const update = (next: Partial<VibeBossConfig>) => {
    if (config !== null) setDraft({ ...config, ...next });
  };

  const insertMention = (name: string) => {
    if (config === null) return;
    const field = leadRulesRef.current;
    const text = config.leadRules;
    const start = field?.selectionStart ?? text.length;
    const end = field?.selectionEnd ?? text.length;
    update({ leadRules: `${text.slice(0, start)}@${name} ${text.slice(end)}` });
  };

  // The check reads the saved rules, so unsaved edits are saved first. State goes to the store,
  // so the check keeps going and its findings stay when the user leaves the page.
  const runReview = async () => {
    if (environmentId === null) return;
    setRulesPage({ checking: true });
    const pending = useRulesPageStore.getState().draft;
    if (pending !== null) {
      const saved = await saveConfig({ environmentId, input: { config: pending } });
      if (saved._tag !== "Success") {
        setRulesPage({ checking: false });
        return;
      }
      setRulesPage({ draft: null });
      refresh();
    }
    const fixed = await reviewRules({ environmentId, input: {} });
    if (fixed._tag !== "Success") {
      setRulesPage({ checking: false });
      return;
    }
    const startedAt = Date.now();
    // The small model adds its findings when it answers; the fixed ones keep their ids.
    setRulesPage({
      checking: false,
      review: fixed.value,
      handled: [],
      applied: 0,
      modelStartedAt: startedAt,
    });
    const full = await reviewRules({ environmentId, input: { useModel: true } });
    setRulesPage({
      modelStartedAt: null,
      ...(full._tag === "Success"
        ? { review: full.value, lastModelMs: Date.now() - startedAt }
        : {}),
    });
  };

  const accept = (suggestions: ReadonlyArray<VibeBossRuleSuggestion>) => {
    if (config === null) return;
    setRulesPage({
      draft: suggestions.reduce(applyRuleSuggestion, config),
      handled: [...handled, ...suggestions.map((item) => item.id)],
      applied: applied + suggestions.length,
    });
  };

  // Saved at once and on its own, so unsaved rule edits stay a draft.
  const saveReviewModel = async (reviewModel: VibeBossReviewModel) => {
    if (environmentId === null || !data) return;
    if (draft !== null) setDraft({ ...draft, reviewModel });
    await saveConfig({ environmentId, input: { config: { ...data.config, reviewModel } } });
    refresh();
  };

  const labelOf = (target: string) =>
    target === "shared"
      ? gt("Shared rules")
      : target === "lead"
        ? gt("Lead rules")
        : (files.find((item) => item.targetId === target)?.label ?? target);

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
    if (synced._tag === "Success") {
      setBackups(synced.value.backups.length);
      setRulesPage({ applied: 0 });
    }
    refresh();
  };

  return (
    <VibeBossPage
      title={gt("Roles & rules")}
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
          {environmentId === null ? null : (
            <RuleCheckButton
              environmentId={environmentId}
              reviewModel={config?.reviewModel}
              checking={checking}
              disabled={checking || modelReviewing}
              onCheck={runReview}
              onReviewModelChange={saveReviewModel}
            />
          )}
          <Button size="sm" disabled={busy || (draft === null && !outOfSync)} onClick={saveAndSync}>
            <T>Sync rule files</T>
          </Button>
        </>
      }
    >
      <RolesRulesSwitch current="/rules" />
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      {data?.previewOnly ? (
        <p className="rounded-lg border border-dashed px-3 py-2 text-muted-foreground text-xs">
          <T>
            Development build: syncing writes to a preview folder and leaves your real global rules
            untouched.
          </T>
        </p>
      ) : null}
      {review !== null ? (
        <RuleReviewPanel
          review={review}
          modelStartedAt={modelStartedAt}
          lastModelMs={lastModelMs}
          handled={new Set(handled)}
          applied={applied}
          labelOf={labelOf}
          onAccept={accept}
          onDismiss={(id) => setRulesPage({ handled: [...handled, id] })}
          onClose={() => setRulesPage({ review: null })}
        />
      ) : null}
      {config === null ? null : (
        <div className="grid gap-6 md:grid-cols-4">
          <nav className="flex flex-col gap-1">
            <NavButton active={tab === SHARED_TAB} onClick={() => setTab(SHARED_TAB)}>
              <LayersIcon className="size-4" />
              <T>Shared rules</T>
            </NavButton>
            <NavButton active={tab === LEAD_TAB} onClick={() => setTab(LEAD_TAB)}>
              <CrownIcon className="size-4" />
              <T>Lead rules</T>
            </NavButton>
            <div className="mt-3 border-t px-2.5 pt-3 pb-0.5 text-muted-foreground text-xs">
              <T>Global rules</T>
            </div>
            {files.map((item) => (
              <NavButton
                key={item.targetId}
                active={tab === item.targetId}
                onClick={() => setTab(item.targetId)}
              >
                <ProviderInstanceIcon
                  driverKind={item.driver as ProviderDriverKind}
                  displayName={item.label}
                />
                <span className="flex-1">{item.label}</span>
                {item.isLead ? <CrownIcon className="size-3.5 text-muted-foreground" /> : null}
              </NavButton>
            ))}
          </nav>

          <div className="md:col-span-3">
            {tab === SHARED_TAB ? (
              <div className="overflow-hidden rounded-xl border">
                <div className="border-b bg-muted/40 px-4 py-2 text-muted-foreground text-xs">
                  <T>Written first into every agent's global rules</T>
                </div>
                <div className="p-3">
                  <Textarea
                    aria-label={gt("Shared rules")}
                    className="min-h-96"
                    value={config.sharedRules ?? ""}
                    onChange={(event) => update({ sharedRules: event.target.value })}
                  />
                </div>
              </div>
            ) : tab === LEAD_TAB ? (
              <div className="overflow-hidden rounded-xl border">
                <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2">
                  {leadFile ? (
                    <FilePath path={leadFile.agentPath} />
                  ) : (
                    <span className="flex-1 text-warning text-xs">
                      <T>The lead's agent is off or has no known rule file.</T>
                    </span>
                  )}
                  <Menu>
                    <MenuTrigger
                      render={<Button size="sm" variant="ghost" />}
                      disabled={config.members.length === 0}
                    >
                      <AtSignIcon />
                      <T>Insert member</T>
                    </MenuTrigger>
                    <MenuPopup align="end">
                      {config.members.map((member) => (
                        <MenuItem key={member.id} onClick={() => insertMention(member.name)}>
                          @{member.name}
                        </MenuItem>
                      ))}
                    </MenuPopup>
                  </Menu>
                </div>
                <div className="p-3">
                  <Textarea
                    ref={leadRulesRef}
                    aria-label={gt("Lead rules")}
                    className="min-h-96"
                    value={config.leadRules}
                    onChange={(event) => update({ leadRules: event.target.value })}
                  />
                </div>
              </div>
            ) : file ? (
              <div className="overflow-hidden rounded-xl border">
                <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2">
                  <FilePath path={file.agentPath} />
                  <span className={cn("text-xs", file.inSync ? "text-success" : "text-warning")}>
                    {file.inSync ? <T>Synced</T> : <T>Not synced</T>}
                  </span>
                </div>
                {(config.sharedRules ?? "").trim() !== "" ? (
                  <AppendedBlock label={<T>Shared rules, added first</T>}>
                    {config.sharedRules}
                  </AppendedBlock>
                ) : null}
                <div className="p-3">
                  <Textarea
                    aria-label={gt("Global rules for {agent}", { agent: file.label })}
                    className="min-h-80"
                    value={config.perAgent[file.targetId] ?? ""}
                    onChange={(event) =>
                      update({
                        perAgent: { ...config.perAgent, [file.targetId]: event.target.value },
                      })
                    }
                  />
                </div>
                {file.isLead ? (
                  <AppendedBlock label={<T>Lead rules, added after</T>}>
                    {config.leadRules}
                  </AppendedBlock>
                ) : null}
                <AppendedBlock label={<T>Added to every agent</T>}>
                  {gt(
                    "When the lead sends you a task, do only that task and do not delegate further.",
                  )}
                </AppendedBlock>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </VibeBossPage>
  );
}
