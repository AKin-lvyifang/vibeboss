import type { VibeBossAgentEntry, VibeBossAgentKind, VibeBossConfig } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { PlusIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { useAtomCommand } from "../../state/use-atom-command";
import { vibeBossEnvironment } from "../../state/vibeboss";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import {
  AGENT_KINDS,
  AGENT_LABEL,
  AgentIcon,
  VibeBossPage,
  useVibeBossState,
} from "./VibeBossShared";

function KindSelect({
  value,
  onChange,
}: {
  value: VibeBossAgentKind;
  onChange: (kind: VibeBossAgentKind) => void;
}) {
  const gt = useGT();
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (AGENT_KINDS.includes(next as VibeBossAgentKind)) onChange(next as VibeBossAgentKind);
      }}
    >
      <SelectTrigger size="sm" aria-label={gt("Agent")} className="w-28">
        <SelectValue>{(kind: VibeBossAgentKind) => AGENT_LABEL[kind]}</SelectValue>
      </SelectTrigger>
      <SelectPopup>
        {AGENT_KINDS.map((kind) => (
          <SelectItem key={kind} value={kind}>
            {AGENT_LABEL[kind]}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

function AgentRow({
  entry,
  lead,
  onChange,
  onRemove,
}: {
  entry: VibeBossAgentEntry;
  lead: boolean;
  onChange: (entry: VibeBossAgentEntry) => void;
  onRemove?: () => void;
}) {
  const gt = useGT();
  return (
    <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3 last:border-b-0">
      <AgentIcon kind={entry.kind} />
      <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1">
        {lead ? (
          <span className="font-medium text-sm">
            <T>Lead</T>
          </span>
        ) : null}
        <Input
          size="sm"
          aria-label={gt("What it is for")}
          value={entry.use}
          placeholder={gt("What it is for")}
          onChange={(event) => onChange({ ...entry, use: event.target.value })}
        />
      </div>
      <KindSelect value={entry.kind} onChange={(kind) => onChange({ ...entry, kind })} />
      <Input
        size="sm"
        aria-label={gt("Model")}
        className="w-40"
        value={entry.model}
        placeholder={lead ? gt("Pick it in the chat") : gt("Model")}
        onChange={(event) => onChange({ ...entry, model: event.target.value })}
      />
      {lead ? (
        <span className="w-28 text-muted-foreground text-xs">
          <T>Effort is set in the chat</T>
        </span>
      ) : (
        <Input
          size="sm"
          aria-label={gt("Effort", { $context: "reasoning effort level of a model" })}
          className="w-28"
          value={entry.effort}
          placeholder={gt("Effort", { $context: "reasoning effort level of a model" })}
          onChange={(event) => onChange({ ...entry, effort: event.target.value })}
        />
      )}
      {onRemove ? (
        <Button size="icon-sm" variant="ghost" aria-label={gt("Remove")} onClick={onRemove}>
          <XIcon />
        </Button>
      ) : (
        <span className="w-8" />
      )}
    </div>
  );
}

export function AgentsPage() {
  const gt = useGT();
  const { environmentId, data, error, refresh } = useVibeBossState();
  const saveConfig = useAtomCommand(vibeBossEnvironment.saveConfig);
  const [draft, setDraft] = useState<VibeBossConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const config = draft ?? data?.config ?? null;

  const update = (next: Partial<VibeBossConfig>) => {
    if (config !== null) setDraft({ ...config, ...next });
  };

  const save = async () => {
    if (environmentId === null || draft === null) return;
    setSaving(true);
    const result = await saveConfig({ environmentId, input: { config: draft } });
    setSaving(false);
    if (result._tag === "Success") {
      setDraft(null);
      refresh();
    }
  };

  return (
    <VibeBossPage
      title={gt("Agents")}
      actions={
        <Button size="sm" disabled={draft === null || saving} onClick={save}>
          <T>Save</T>
        </Button>
      }
    >
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      {config === null ? null : (
        <>
          <section className="overflow-hidden rounded-xl border">
            <AgentRow entry={config.lead} lead onChange={(lead) => update({ lead })} />
            {config.helpers.map((entry) => (
              <AgentRow
                key={entry.id}
                entry={entry}
                lead={false}
                onChange={(next) =>
                  update({
                    helpers: config.helpers.map((item) => (item.id === entry.id ? next : item)),
                  })
                }
                onRemove={() =>
                  update({ helpers: config.helpers.filter((item) => item.id !== entry.id) })
                }
              />
            ))}
            <div className="px-4 py-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  update({
                    helpers: [
                      ...config.helpers,
                      {
                        id: `agent-${Date.now().toString(36)}`,
                        kind: "agy",
                        model: "",
                        effort: "",
                        use: "",
                      },
                    ],
                  })
                }
              >
                <PlusIcon />
                <T>Add agent</T>
              </Button>
            </div>
          </section>
          <section className="flex flex-col gap-2">
            <h2 className="font-medium text-sm">
              <T>Collaboration guide</T>
            </h2>
            <Textarea
              aria-label={gt("Collaboration guide")}
              className="min-h-56"
              value={config.coop}
              onChange={(event) => update({ coop: event.target.value })}
            />
          </section>
        </>
      )}
    </VibeBossPage>
  );
}
