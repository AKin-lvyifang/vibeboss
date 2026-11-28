import type { VibeBossConfig, VibeBossMember } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { PlusIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { EffortSelect, ModelSelect, NoteField, effortLevels, memberModel } from "./MemberFields";
import { ProviderSelect, renameMention, useEnabledProviders } from "./VibeBossShared";

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

/** Names that cannot be saved: empty, odd characters, or used twice. */
export function invalidMemberName(config: VibeBossConfig, name: string): boolean {
  return (
    !NAME_PATTERN.test(name) || config.members.filter((member) => member.name === name).length > 1
  );
}

/** The lead and members tables at the top of the Roles & rules page. */
export function RolesSection({
  config,
  update,
}: {
  config: VibeBossConfig;
  update: (next: Partial<VibeBossConfig>) => void;
}) {
  const gt = useGT();
  const providers = useEnabledProviders();
  const invalidName = (name: string) => invalidMemberName(config, name);

  const updateMember = (member: VibeBossMember, next: VibeBossMember) => {
    update({
      members: config.members.map((item) => (item.id === member.id ? next : item)),
      leadRules: renameMention(config.leadRules, member.name, next.name),
    });
  };

  const providerOf = (member: VibeBossMember) =>
    providers.find((provider) => provider.instanceId === member.providerInstanceId);

  return (
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
                <NoteField
                  value={config.lead.note}
                  onChange={(note) => update({ lead: { ...config.lead, note } })}
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
                      // Models and levels belong to one agent; start fresh on a swap.
                      updateMember(member, {
                        ...member,
                        providerInstanceId,
                        model: "",
                        effort: "",
                      })
                    }
                  />
                </Cell>
                <Cell>
                  <ModelSelect
                    provider={providerOf(member)}
                    value={member.model}
                    onChange={(model) => {
                      const levels = effortLevels(memberModel(providerOf(member), model));
                      const keep = levels.some((level) => level.id === member.effort);
                      updateMember(member, {
                        ...member,
                        model,
                        effort: keep ? member.effort : "",
                      });
                    }}
                  />
                </Cell>
                <Cell>
                  <EffortSelect
                    model={memberModel(providerOf(member), member.model)}
                    value={member.effort}
                    onChange={(effort) => updateMember(member, { ...member, effort })}
                  />
                </Cell>
                <Cell>
                  <NoteField
                    value={member.note}
                    onChange={(note) => updateMember(member, { ...member, note })}
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
  );
}
