import type { VibeBossCapability } from "@t3tools/contracts";
import { msg, T, useGT, useMessages } from "gt-react";
import { useState } from "react";

import { usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { vibeBossEnvironment } from "../../state/vibeboss";
import { Badge } from "../ui/badge";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { AGENT_KINDS, AgentIcon, VibeBossPage } from "./VibeBossShared";

type Section = "skills" | "mcpServers" | "plugins";
type Filter = "all" | "shared" | "own" | "differs";

const SECTIONS: ReadonlyArray<Section> = ["skills", "mcpServers", "plugins"];
const SECTION_LABEL: Record<Exclude<Section, "mcpServers">, string> = {
  skills: msg("Skills"),
  plugins: msg("Plugins"),
};

const FILTER_LABEL: Record<Filter, string> = {
  all: msg("All", { $context: "filter showing every item" }),
  shared: msg("Shared", { $context: "filter: installed for more than one agent" }),
  own: msg("Only one agent"),
  differs: msg("Versions differ"),
};

function matches(item: VibeBossCapability, filter: Filter) {
  switch (filter) {
    case "all":
      return true;
    case "shared":
      return item.kinds.length > 1;
    case "own":
      return item.kinds.length === 1;
    case "differs":
      return item.differs;
  }
}

export function CapabilitiesPage() {
  const gt = useGT();
  const m = useMessages();
  const environmentId = usePrimaryEnvironmentId();
  const { data, error } = useEnvironmentQuery(
    environmentId === null ? null : vibeBossEnvironment.capabilities({ environmentId, input: {} }),
  );
  const [section, setSection] = useState<Section>("skills");
  const [filter, setFilter] = useState<Filter>("all");
  const items = (data?.[section] ?? []).filter((item) => matches(item, filter));

  return (
    <VibeBossPage title={gt("Skills, MCP & plugins")}>
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        <ToggleGroup
          value={[section]}
          onValueChange={(value) => {
            const next = value[0] as Section | undefined;
            if (next) setSection(next);
          }}
        >
          {SECTIONS.map((key) => (
            <ToggleGroupItem key={key} value={key}>
              {key === "mcpServers" ? "MCP" : m(SECTION_LABEL[key])}
              <span className="text-muted-foreground">{data?.[key].length ?? ""}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <span className="flex-1" />
        <ToggleGroup
          value={[filter]}
          onValueChange={(value) => {
            const next = value[0] as Filter | undefined;
            if (next) setFilter(next);
          }}
        >
          {(Object.keys(FILTER_LABEL) as Array<Filter>).map((key) => (
            <ToggleGroupItem key={key} value={key}>
              {m(FILTER_LABEL[key])}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <section className="overflow-hidden rounded-xl border">
        {items.length === 0 ? (
          <p className="px-4 py-6 text-center text-muted-foreground text-sm">
            <T>Nothing here</T>
          </p>
        ) : (
          items.map((item) => (
            <div
              key={item.name}
              className="flex items-center gap-3 border-b px-4 py-2.5 last:border-b-0"
            >
              <span className="min-w-0 flex-1 truncate text-sm">{item.name}</span>
              {item.differs ? (
                <Badge variant="warning">
                  <T>Versions differ</T>
                </Badge>
              ) : null}
              <span className="flex items-center gap-1.5">
                {AGENT_KINDS.map((kind) => (
                  <AgentIcon key={kind} kind={kind} dim={!item.kinds.includes(kind)} />
                ))}
              </span>
            </div>
          ))
        )}
      </section>
    </VibeBossPage>
  );
}
