import { T, useGT, Var } from "gt-react";
import { Columns2Icon, ListPlusIcon, SquarePenIcon, XIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "../../lib/utils";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import type { CustomSection } from "../../vibebossSplitView";
import { ProjectFavicon } from "../ProjectFavicon";
import { Button } from "../ui/button";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

function IconAction({
  label,
  active = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-xs"
            variant={active ? "secondary" : "ghost-muted"}
            aria-label={label}
            aria-pressed={active}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}

/** Separates the nav rows above from the thread list, and switches the split view. */
export function SidebarSessionsHeading(props: { split: boolean; onToggleSplit: () => void }) {
  const gt = useGT();
  return (
    <div className="mt-3 flex h-8 items-center gap-2 border-t border-sidebar-border px-2 pt-3">
      <span className="flex-1 font-medium text-sm text-sidebar-foreground">
        {props.split ? <T>Projects</T> : <T>Threads</T>}
      </span>
      <IconAction label={gt("Split by project")} active={props.split} onClick={props.onToggleSplit}>
        <Columns2Icon aria-hidden />
      </IconAction>
    </div>
  );
}

/** The split view's first column: pick the project whose threads fill the second column. */
export function SplitProjectList(props: {
  groups: ReadonlyArray<SidebarProjectSnapshot>;
  selectedKey: string | null;
  onSelect: (group: SidebarProjectSnapshot) => void;
}) {
  return (
    <ul className="flex flex-col gap-px px-2 pb-2">
      {props.groups.map((group) => (
        <li key={group.projectKey} className="list-none">
          <button
            type="button"
            aria-current={props.selectedKey === group.projectKey}
            onClick={() => props.onSelect(group)}
            className={cn(
              "flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-(--control-radius) px-(--sidebar-row-content-inset) text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              props.selectedKey === group.projectKey
                ? "bg-sidebar-row-active font-medium text-sidebar-foreground"
                : "text-sidebar-foreground/90 hover:bg-sidebar-row-hover",
            )}
          >
            <ProjectFavicon project={group} className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{group.displayName}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Top of the second column, level with the main header. */
export function SplitColumnHeader(props: {
  project: SidebarProjectSnapshot | null;
  onNewThread: () => void;
  onAddSection: () => void;
}) {
  const gt = useGT();
  return (
    <div className="flex h-(--workspace-topbar-height) shrink-0 items-center gap-2 border-b border-sidebar-border px-3">
      {props.project ? (
        <ProjectFavicon project={props.project} className="size-4 shrink-0" />
      ) : null}
      <span className="min-w-0 flex-1 truncate font-medium text-sm">
        {props.project?.displayName ?? gt("Pick a project")}
      </span>
      <IconAction label={gt("New section")} onClick={props.onAddSection}>
        <ListPlusIcon aria-hidden />
      </IconAction>
      {props.project ? (
        <IconAction
          label={gt("New thread in {project}", { project: props.project.displayName })}
          onClick={props.onNewThread}
        >
          <SquarePenIcon aria-hidden />
        </IconAction>
      ) : null}
    </div>
  );
}

/** A user-made section: click to fold, double-click to rename, × to remove (threads go back to Active). */
export function CustomSectionHeader(props: {
  section: CustomSection;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  onRename: (name: string) => void;
  onRemove: () => void;
}) {
  const gt = useGT();
  const [editing, setEditing] = useState(props.section.name === "");
  const [name, setName] = useState(props.section.name);
  const commit = () => {
    setEditing(false);
    const next = name.trim() || props.section.name || gt("New section");
    setName(next);
    if (next !== props.section.name) props.onRename(next);
  };

  return (
    <li className="group/custom-section relative mx-0.5 mt-2 list-none">
      {editing ? (
        <input
          autoFocus
          aria-label={gt("Section name")}
          className="h-8 w-full rounded-md border border-sidebar-border bg-transparent px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
            if (event.key === "Escape") {
              setName(props.section.name);
              setEditing(false);
            }
          }}
        />
      ) : (
        <>
          <CollapsibleSectionHeader
            expanded={!props.collapsed}
            onClick={props.onToggle}
            onDoubleClick={() => setEditing(true)}
            accessory={<span className="font-normal tabular-nums">{props.count}</span>}
          >
            {props.section.name}
          </CollapsibleSectionHeader>
          <span className="absolute inset-y-0 right-10 flex items-center opacity-0 focus-within:opacity-100 group-hover/custom-section:opacity-100 pointer-coarse:opacity-100">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost-muted"
                    aria-label={gt("Remove section {name}", { name: props.section.name })}
                    onClick={props.onRemove}
                  />
                }
              >
                <XIcon aria-hidden />
              </TooltipTrigger>
              <TooltipPopup>
                <T>
                  Remove <Var>{props.section.name}</Var>; its threads go back to Active
                </T>
              </TooltipPopup>
            </Tooltip>
          </span>
        </>
      )}
    </li>
  );
}
