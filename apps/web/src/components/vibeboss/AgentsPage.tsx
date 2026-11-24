import type { VibeBossConfig, VibeBossMember } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { PlusIcon, XIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { useAtomCommand } from "../../state/use-atom-command";
import { vibeBossEnvironment } from "../../state/vibeboss";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  ProviderSelect,
  VibeBossPage,
  renameMention,
  useEnabledProviders,
  useVibeBossState,
} from "./VibeBossShared";

// Both tables share these widths so every column lines up from the lead down.
function Columns() {
  return (
    <colgroup>
      <col className="w-36" />
      <col className="w-48" />
      <col className="w-48" />
      <col className="w-28" />
      <col />
      <col className="w-12" />
    </colgroup>
  );
}

function HeaderRow() {
  const cell = "px-2 pb-2 text-left font-normal text-muted-foreground text-xs first:pl-4";
  return (
    <thead>
      <tr>
        <th className={cell}>
          <T>Name</T>
        </th>
        <th className={cell}>
          <T>Agent</T>
        </th>
        <th className={cell}>
          <T>Model</T>
        </th>
        <th className={cell}>
          <T context="reasoning effort level of a model">Effort</T>
        </th>
        <th className={cell}>
          <T>Note</T>
        </th>
        <th className={cell} />
      </tr>
    </thead>
  );
}

function Cell({ children }: { children?: ReactNode }) {
  return <td className="px-2 py-2 align-middle first:pl-4 last:pr-3">{children}</td>;
}

const NAME_PATTERN = /^[\p{L}\p{N}_-]+$/u;

export function AgentsPage() {
  const gt = useGT();
  const { environmentId, data, error, refresh } = useVibeBossState();
  const providers = useEnabledProviders();
  const saveConfig = useAtomCommand(vibeBossEnvironment.saveConfig);
  const [draft, setDraft] = useState<VibeBossConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const config = draft ?? data?.config ?? null;

  const update = (next: Partial<VibeBossConfig>) => {
    if (config !== null) setDraft({ ...config, ...next });
  };

  const updateMember = (member: VibeBossMember, next: VibeBossMember) => {
    if (config === null) return;
    update({
      members: config.members.map((item) => (item.id === member.id ? next : item)),
      leadRules: renameMention(config.leadRules, member.name, next.name),
    });
  };

  const names = config?.members.map((member) => member.name) ?? [];
  const invalidName = (name: string) =>
    !NAME_PATTERN.test(name) || names.filter((item) => item === name).length > 1;

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
      title={gt("Roles")}
      actions={
        <Button
          size="sm"
          disabled={draft === null || saving || names.some(invalidName)}
          onClick={save}
        >
          <T>Save</T>
        </Button>
      }
    >
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      {config === null ? null : (
        <>
          <section className="overflow-hidden rounded-xl border pt-3">
            <table className="w-full table-fixed text-sm">
              <Columns />
              <HeaderRow />
              <tbody>
                <tr className="border-t">
                  <Cell>
                    <span className="font-medium">
                      <T>Lead</T>
                    </span>
                  </Cell>
                  <Cell>
                    <ProviderSelect
                      value={config.lead.providerInstanceId}
                      providers={providers}
                      onChange={(providerInstanceId) =>
                        update({ lead: { ...config.lead, providerInstanceId } })
                      }
                    />
                  </Cell>
                  <Cell>
                    <span className="px-2 text-muted-foreground text-xs">
                      <T>Picked in the chat</T>
                    </span>
                  </Cell>
                  <Cell>
                    <span className="px-2 text-muted-foreground text-xs">
                      <T>In the chat</T>
                    </span>
                  </Cell>
                  <Cell>
                    <Input
                      size="sm"
                      aria-label={gt("Note")}
                      value={config.lead.note}
                      onChange={(event) =>
                        update({ lead: { ...config.lead, note: event.target.value } })
                      }
                    />
                  </Cell>
                  <Cell />
                </tr>
              </tbody>
            </table>
          </section>

          <section className="overflow-hidden rounded-xl border pt-3">
            <table className="w-full table-fixed text-sm">
              <Columns />
              <HeaderRow />
              <tbody>
                {config.members.map((member) => (
                  <tr key={member.id} className="border-t">
                    <Cell>
                      <Input
                        size="sm"
                        aria-label={gt("Name")}
                        aria-invalid={invalidName(member.name)}
                        value={member.name}
                        placeholder="worker"
                        onChange={(event) =>
                          updateMember(member, { ...member, name: event.target.value.trim() })
                        }
                      />
                    </Cell>
                    <Cell>
                      <ProviderSelect
                        value={member.providerInstanceId}
                        providers={providers}
                        onChange={(providerInstanceId) =>
                          updateMember(member, { ...member, providerInstanceId })
                        }
                      />
                    </Cell>
                    <Cell>
                      <Input
                        size="sm"
                        aria-label={gt("Model")}
                        value={member.model}
                        onChange={(event) =>
                          updateMember(member, { ...member, model: event.target.value })
                        }
                      />
                    </Cell>
                    <Cell>
                      <Input
                        size="sm"
                        aria-label={gt("Effort", { $context: "reasoning effort level of a model" })}
                        value={member.effort}
                        onChange={(event) =>
                          updateMember(member, { ...member, effort: event.target.value })
                        }
                      />
                    </Cell>
                    <Cell>
                      <Input
                        size="sm"
                        aria-label={gt("Note")}
                        value={member.note}
                        onChange={(event) =>
                          updateMember(member, { ...member, note: event.target.value })
                        }
                      />
                    </Cell>
                    <Cell>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={gt("Remove {name}", { name: member.name })}
                        onClick={() =>
                          update({
                            members: config.members.filter((item) => item.id !== member.id),
                          })
                        }
                      >
                        <XIcon />
                      </Button>
                    </Cell>
                  </tr>
                ))}
                <tr className="border-t">
                  <td colSpan={6} className="px-2 py-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        update({
                          members: [
                            ...config.members,
                            {
                              id: `member-${Date.now().toString(36)}`,
                              name: `worker${config.members.length + 1}`,
                              providerInstanceId: providers[0]?.instanceId ?? "codex",
                              model: "",
                              effort: "",
                              note: "",
                            },
                          ],
                        })
                      }
                    >
                      <PlusIcon />
                      <T>Add member</T>
                    </Button>
                  </td>
                </tr>
              </tbody>
            </table>
          </section>
        </>
      )}
    </VibeBossPage>
  );
}
