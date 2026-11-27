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
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuItemDetail,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { ComposerControl, ComposerControlIcon, type ComposerControlSize } from "./ComposerControl";
import { useComposerMenuProps } from "./composerEventScope";
import { useComposerMenuState } from "./useComposerMenuState";

/**
 * Short enough to sit beside the other composer chips. Both sides read "source + count"; with
 * cloud libraries added but none picked, "all local" keeps the label from implying they load.
 */
function knowledgeChipLabel(input: {
  readonly local: ReadonlyArray<string>;
  readonly allLocal: boolean;
  readonly cloud: number;
  readonly hasCloud: boolean;
  readonly text: {
    readonly everything: string;
    readonly allLocal: string;
    readonly local: string;
    readonly cloud: string;
  };
}): string {
  const { local, cloud, text } = input;
  const first = local[0] ?? "";
  if (cloud === 0) {
    if (local.length === 0) return "";
    if (input.allLocal) return input.hasCloud ? text.allLocal : text.everything;
    if (local.length === 1) return first;
    return [...first].length <= 5
      ? `${first} +${local.length - 1}`
      : `${text.local} ${local.length}`;
  }
  const cloudPart = `${text.cloud} ${cloud}`;
  if (local.length === 0) return cloudPart;
  const localPart = input.allLocal
    ? text.local
    : local.length === 1 && [...first].length <= 4
      ? first
      : `${text.local} ${local.length}`;
  return `${localPart} · ${cloudPart}`;
}

export function VibeBossKnowledgeControl(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly projectId: ProjectId | null;
  readonly size: ComposerControlSize;
  readonly hidden: boolean;
  /** Cloud libraries are reached through Claude's MCP server, so only Claude can search them. */
  readonly cloudAvailable: boolean;
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
  const libraries = data.cloudLibraries;
  const chosenCloud = libraries.filter(
    (library) => library.status === "ready" && (selection.cloud ?? []).includes(library.id),
  );
  const activeCloud = props.cloudAvailable ? chosenCloud.length : 0;
  const loading = selection.enabled && (selected.length > 0 || activeCloud > 0);

  const save = async (
    next: { enabled: boolean; categories: ReadonlyArray<string>; cloud?: ReadonlyArray<string> },
    asProjectDefault = false,
  ) => {
    await setSelection({
      environmentId: props.environmentId,
      input: {
        ...input,
        selection: {
          enabled: next.enabled,
          categories: next.categories.length === categories.length ? null : [...next.categories],
          cloud: [...(next.cloud ?? chosenCloud.map((library) => library.id))],
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
            {knowledgeChipLabel({
              local: selected,
              allLocal: selected.length === categories.length,
              cloud: activeCloud,
              hasCloud: libraries.length > 0,
              text: {
                everything: gt("All knowledge"),
                allLocal: gt("All local"),
                local: gt("Local", { $context: "knowledge kept on this computer" }),
                cloud: gt("Cloud", { $context: "knowledge kept in the cloud" }),
              },
            })}
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
            <MenuGroup>
              {libraries.length > 0 ? (
                <MenuGroupLabel>
                  <T>Local</T>
                </MenuGroupLabel>
              ) : null}
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
            </MenuGroup>
            {libraries.length > 0 ? (
              <>
                <MenuSeparator />
                <MenuGroup>
                  <MenuGroupLabel>
                    <T>Cloud</T>
                  </MenuGroupLabel>
                  {props.cloudAvailable ? null : (
                    <MenuItem disabled>
                      <T>Available with Claude only.</T>
                    </MenuItem>
                  )}
                  {libraries.map((library) => (
                    <MenuCheckboxItem
                      key={library.id}
                      disabled={!props.cloudAvailable || library.status !== "ready"}
                      checked={chosenCloud.some((item) => item.id === library.id)}
                      onCheckedChange={(checked) =>
                        void save({
                          enabled: true,
                          categories: selected,
                          cloud: libraries
                            .filter((item) =>
                              item.id === library.id
                                ? checked
                                : chosenCloud.some((chosen) => chosen.id === item.id),
                            )
                            .map((item) => item.id),
                        })
                      }
                    >
                      <span className="min-w-0 flex-1 truncate">{library.name}</span>
                      {library.status === "ready" ? null : (
                        <MenuItemDetail>
                          {library.status === "building" ? <T>Building</T> : <T>No documents</T>}
                        </MenuItemDetail>
                      )}
                    </MenuCheckboxItem>
                  ))}
                </MenuGroup>
              </>
            ) : null}
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
