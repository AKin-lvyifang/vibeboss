// VibeBoss: the composer chip that says whether this conversation loads the knowledge base.
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { T, useGT } from "gt-react";
import { LibraryIcon } from "lucide-react";

import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { vibeBossEnvironment } from "../../state/vibeboss";
import {
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { ComposerControl, ComposerControlIcon, type ComposerControlSize } from "./ComposerControl";
import { useComposerMenuProps } from "./composerEventScope";
import { useComposerMenuState } from "./useComposerMenuState";

const LABEL_MAX_CHARS = 8;

/** Short enough to sit beside the other composer chips: all, the names, or "first +N". */
function knowledgeChipLabel(
  selected: ReadonlyArray<string>,
  all: ReadonlyArray<string>,
  allLabel: string,
): string {
  if (selected.length === all.length) return allLabel;
  const joined = selected.join("、");
  if ([...joined].length <= LABEL_MAX_CHARS) return joined;
  return `${selected[0]} +${selected.length - 1}`;
}

export function VibeBossKnowledgeControl(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly projectId: ProjectId | null;
  readonly size: ComposerControlSize;
  readonly hidden: boolean;
}) {
  const gt = useGT();
  const navigate = useNavigate();
  const menuProps = useComposerMenuProps();
  const [open, setOpen] = useComposerMenuState(props.hidden);
  const input = { threadId: props.threadId, projectId: props.projectId };
  const { data, refresh } = useEnvironmentQuery(
    vibeBossEnvironment.knowledgeSelection({ environmentId: props.environmentId, input }),
  );
  const setSelection = useAtomCommand(vibeBossEnvironment.setKnowledgeSelection);
  // Until a knowledge folder is set there is nothing to load, so the composer shows no chip.
  if (!data?.available) return null;

  const { selection, categories } = data;
  const selected =
    selection.categories === null
      ? categories
      : categories.filter((category) => selection.categories!.includes(category));
  const loading = selection.enabled && selected.length > 0;

  const save = async (
    next: { enabled: boolean; categories: ReadonlyArray<string> },
    asProjectDefault = false,
  ) => {
    await setSelection({
      environmentId: props.environmentId,
      input: {
        ...input,
        selection: {
          enabled: next.enabled,
          categories: next.categories.length === categories.length ? null : [...next.categories],
        },
        asProjectDefault,
      },
    });
    refresh();
  };

  return (
    <Menu open={open} onOpenChange={setOpen}>
      <MenuTrigger
        render={
          <ComposerControl
            size={props.size}
            aria-label={loading ? gt("Knowledge: loaded") : gt("Knowledge: not loaded")}
          />
        }
      >
        <ComposerControlIcon
          icon={LibraryIcon}
          size={props.size}
          {...(loading ? { className: "text-primary" } : {})}
        />
        {loading ? (
          <span data-composer-control-label className="max-w-32 truncate">
            {knowledgeChipLabel(selected, categories, gt("All knowledge"))}
          </span>
        ) : null}
      </MenuTrigger>
      <MenuPopup align="start" {...menuProps}>
        <MenuCheckboxItem
          variant="switch"
          checked={selection.enabled}
          onCheckedChange={(enabled) => void save({ enabled, categories: selected })}
        >
          <T>Load knowledge in this conversation</T>
        </MenuCheckboxItem>
        {selection.enabled ? (
          <>
            <MenuSeparator />
            {categories.map((category) => (
              <MenuCheckboxItem
                key={category}
                checked={selected.includes(category)}
                onCheckedChange={(checked) =>
                  void save({
                    enabled: true,
                    categories: categories.filter((item) =>
                      item === category ? checked : selected.includes(item),
                    ),
                  })
                }
              >
                {category}
              </MenuCheckboxItem>
            ))}
          </>
        ) : null}
        <MenuSeparator />
        {props.projectId === null || (!selection.enabled && data.isProjectDefault) ? null : (
          <MenuItem
            disabled={data.isProjectDefault}
            closeOnClick={false}
            onClick={() => void save({ enabled: selection.enabled, categories: selected }, true)}
          >
            {data.isProjectDefault ? <T>Project default</T> : <T>Set as project default</T>}
          </MenuItem>
        )}
        <MenuItem onClick={() => void navigate({ to: "/knowledge" })}>
          <T>Manage knowledge</T>
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}
