import type {
  EnvironmentId,
  VibeBossKnowledgeDoc,
  VibeBossKnowledgeLogEntry,
  VibeBossKnowledgeState,
  VibeBossReviewModel,
} from "@t3tools/contracts";
import { T, useGT, Var } from "gt-react";
import {
  ChevronDownIcon,
  FolderOpenIcon,
  LibraryIcon,
  RefreshCwIcon,
  WaypointsIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

import { isElectron } from "../../env";
import { useClientSettings } from "../../hooks/useSettings";
import { readLocalApi } from "../../localApi";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { shellEnvironment } from "../../state/shell";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatDateTimeTimestamp } from "../../timestampFormat";
import { vibeBossEnvironment } from "../../state/vibeboss";
import { setKnowledgePage, useKnowledgePageStore } from "../../vibebossKnowledgeStore";
import { Button } from "../ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../ui/empty";
import { Group, GroupSeparator } from "../ui/group";
import { Input } from "../ui/input";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { Spinner } from "../ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { KnowledgeGraphPage } from "./KnowledgeGraph";
import { KnowledgeList } from "./KnowledgeList";
import { KnowledgeOverview } from "./KnowledgeOverview";
import { ReviewModelFields } from "./ReviewModelFields";
import { VibeBossPage } from "./VibeBossShared";

const ALL = "\0all";
const UNORGANIZED = "\0unorganized";

function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function OrganizeLog(props: {
  readonly log: ReadonlyArray<VibeBossKnowledgeLogEntry>;
  readonly busy: boolean;
  readonly onUndo: (entry: VibeBossKnowledgeLogEntry) => void;
}) {
  const gt = useGT();
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  if (props.log.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-1 text-muted-foreground text-xs">
        <T>Organizer history</T>
      </h2>
      <div className="overflow-hidden rounded-xl border">
        {props.log.slice(0, 8).map((entry) => (
          <div
            key={entry.id}
            className="flex items-start gap-3 border-b px-4 py-2.5 last:border-b-0"
          >
            <span className="w-36 shrink-0 pt-0.5 text-muted-foreground text-xs tabular-nums">
              {formatDateTimeTimestamp(entry.at, timestampFormat)}
            </span>
            <ul className="flex min-w-0 flex-1 flex-col gap-0.5 text-xs">
              {entry.moves.map((move) => (
                <li key={move.to} className="truncate">
                  <span className="text-muted-foreground">{fileName(move.from)} → </span>
                  {move.to}
                </li>
              ))}
            </ul>
            {entry.undone ? (
              <span className="pt-0.5 text-muted-foreground text-xs">
                <T>Undone</T>
              </span>
            ) : (
              <Button
                size="xs"
                variant="ghost"
                disabled={props.busy}
                aria-label={gt("Undo this organizer run")}
                onClick={() => props.onUndo(entry)}
              >
                <T>Undo</T>
              </Button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function OrganizeButton(props: {
  readonly environmentId: EnvironmentId;
  readonly model: VibeBossReviewModel | undefined;
  readonly organizing: boolean;
  readonly disabled: boolean;
  readonly onOrganize: () => void;
  readonly onModelChange: (model: VibeBossReviewModel) => void;
}) {
  const gt = useGT();
  return (
    <Group>
      <Button size="sm" variant="outline" disabled={props.disabled} onClick={props.onOrganize}>
        {props.organizing ? <T>Organizing…</T> : <T>Organize</T>}
      </Button>
      <GroupSeparator />
      <Popover>
        <PopoverTrigger
          render={<Button size="icon-sm" variant="outline" aria-label={gt("Organizer model")} />}
        >
          <ChevronDownIcon />
        </PopoverTrigger>
        <PopoverPopup align="end" className="w-72">
          <div className="flex flex-col gap-2">
            <PopoverTitle>
              <T>Organizer model</T>
            </PopoverTitle>
            <ReviewModelFields
              environmentId={props.environmentId}
              value={props.model}
              onChange={props.onModelChange}
            />
          </div>
        </PopoverPopup>
      </Popover>
    </Group>
  );
}

/** Shown until a folder is set. Any folder works; the default is created on first use. */
function KnowledgeSetup(props: {
  readonly defaultFolder: string;
  readonly onPick: (folder: string) => void;
}) {
  const gt = useGT();
  const [typed, setTyped] = useState("");
  const pickFolder = async () => {
    const picked = await readLocalApi()?.dialogs.pickFolder();
    if (picked) props.onPick(picked);
  };
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <LibraryIcon />
        </EmptyMedia>
        <EmptyTitle>
          <T>No knowledge base</T>
        </EmptyTitle>
        <EmptyDescription>
          <T>
            The default location is <Var>{props.defaultFolder}</Var>.
          </T>
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button onClick={() => props.onPick(props.defaultFolder)}>
            <T>Use default location</T>
          </Button>
          {isElectron ? (
            <Button variant="outline" onClick={() => void pickFolder()}>
              <T>Choose folder</T>
            </Button>
          ) : null}
        </div>
        {isElectron ? null : (
          <form
            className="flex w-full max-w-md items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (typed.trim() !== "") props.onPick(typed.trim());
            }}
          >
            <Input
              value={typed}
              aria-label={gt("Folder path")}
              placeholder={props.defaultFolder}
              onChange={(event) => setTyped(event.target.value)}
            />
            <Button type="submit" variant="outline" disabled={typed.trim() === ""}>
              <T>Use this folder</T>
            </Button>
          </form>
        )}
      </EmptyContent>
    </Empty>
  );
}

function matches(doc: VibeBossKnowledgeDoc, filter: string, query: string): boolean {
  if (filter === UNORGANIZED ? doc.organized : filter !== ALL && doc.category !== filter) {
    return false;
  }
  if (query === "") return true;
  return [doc.name, doc.summary, doc.audience, doc.originalName, doc.group].some((text) =>
    text.toLowerCase().includes(query),
  );
}

function KnowledgeBody(props: {
  readonly environmentId: EnvironmentId;
  readonly state: VibeBossKnowledgeState;
  readonly folder: string;
  readonly notice: string | null;
  readonly organizing: boolean;
  readonly onUndo: (entry: VibeBossKnowledgeLogEntry) => void;
  readonly onOpenDoc: (doc: VibeBossKnowledgeDoc) => void;
  readonly onOpenGraph: () => void;
}) {
  const gt = useGT();
  const [filter, setFilter] = useState(ALL);
  const [search, setSearch] = useState("");
  const { docs, categories } = props.state;
  const unorganized = docs.filter((doc) => !doc.organized).length;
  const query = search.trim().toLowerCase();
  const visible = docs.filter((doc) => matches(doc, filter, query));
  return (
    <>
      {docs.length > 0 ? <KnowledgeOverview docs={docs} /> : null}
      <div className="flex flex-wrap items-center gap-3">
        <ToggleGroup
          value={[filter]}
          onValueChange={(value) => {
            const next = value[0] as string | undefined;
            if (next) setFilter(next);
          }}
        >
          <ToggleGroupItem value={ALL}>
            <T>All</T>
            <span className="text-muted-foreground">{docs.length}</span>
          </ToggleGroupItem>
          {categories.map((category) => (
            <ToggleGroupItem key={category} value={category}>
              {category}
              <span className="text-muted-foreground">
                {docs.filter((doc) => doc.category === category).length}
              </span>
            </ToggleGroupItem>
          ))}
          {unorganized > 0 ? (
            <ToggleGroupItem value={UNORGANIZED}>
              <T>Unorganized</T>
              <span className="text-muted-foreground">{unorganized}</span>
            </ToggleGroupItem>
          ) : null}
        </ToggleGroup>
        <span className="flex-1" />
        <Button size="sm" variant="outline" onClick={props.onOpenGraph}>
          <WaypointsIcon />
          <T>Knowledge graph</T>
        </Button>
        <div className="w-56">
          <Input
            size="sm"
            type="search"
            value={search}
            aria-label={gt("Search knowledge")}
            placeholder={gt("Search")}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>
      {props.organizing ? (
        <p className="flex items-center gap-2 text-muted-foreground text-sm">
          <Spinner />
          <T>Naming and filing new files…</T>
        </p>
      ) : props.notice !== null ? (
        <p className="text-sm text-warning-foreground">{props.notice}</p>
      ) : null}
      {visible.length === 0 ? (
        <p className="rounded-xl border px-4 py-6 text-center text-muted-foreground text-sm">
          {docs.length === 0 ? (
            <T>Put files in the folder. VibeBoss names and files them.</T>
          ) : (
            <T>Nothing here</T>
          )}
        </p>
      ) : (
        <KnowledgeList docs={visible} onOpen={props.onOpenDoc} />
      )}
      {filter === ALL && query === "" ? (
        <OrganizeLog log={props.state.log} busy={props.organizing} onUndo={props.onUndo} />
      ) : null}
    </>
  );
}

export function KnowledgePage() {
  const gt = useGT();
  const environmentId = usePrimaryEnvironmentId();
  const { data, error, refresh } = useEnvironmentQuery(
    environmentId === null ? null : vibeBossEnvironment.knowledge({ environmentId, input: {} }),
  );
  const saveConfig = useAtomCommand(vibeBossEnvironment.saveKnowledgeConfig);
  const organize = useAtomCommand(vibeBossEnvironment.organizeKnowledge);
  const undo = useAtomCommand(vibeBossEnvironment.undoKnowledge);
  const reveal = useAtomCommand(shellEnvironment.openInEditor, { reportFailure: false });
  const organizing = useKnowledgePageStore((state) => state.organizing);
  const notice = useKnowledgePageStore((state) => state.notice);
  const folder = data?.config.folder ?? null;
  const unorganized = (data?.docs ?? []).filter((doc) => !doc.organized);
  const automatic = unorganized
    .filter((doc) => !doc.held)
    .map((doc) => doc.path)
    .join("\n");

  const runOrganize = async (includeHeld: boolean) => {
    if (environmentId === null || useKnowledgePageStore.getState().organizing) return;
    setKnowledgePage({ organizing: true, notice: null });
    const result = await organize({ environmentId, input: { includeHeld } });
    setKnowledgePage({
      organizing: false,
      notice: result._tag === "Success" ? result.value.modelError : null,
    });
    refresh();
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- files that appeared in the folder start the organizer once
  useEffect(() => {
    if (automatic === "" || useKnowledgePageStore.getState().attempted === automatic) return;
    setKnowledgePage({ attempted: automatic });
    void runOrganize(false);
  });

  const setFolder = async (next: string) => {
    if (environmentId === null || !data) return;
    await saveConfig({ environmentId, input: { config: { ...data.config, folder: next } } });
    refresh();
  };

  const setModel = async (organizerModel: VibeBossReviewModel) => {
    if (environmentId === null || !data) return;
    await saveConfig({ environmentId, input: { config: { ...data.config, organizerModel } } });
    refresh();
  };

  const [graphOpen, setGraphOpen] = useState(false);
  const openDoc = (doc: VibeBossKnowledgeDoc) => {
    if (environmentId === null || folder === null) return;
    void reveal({
      environmentId,
      input: {
        cwd: `${folder.replace(/[\\/]+$/, "")}/${doc.path}`,
        editor: "file-manager",
        reveal: true,
      },
    });
  };

  const runUndo = async (entry: VibeBossKnowledgeLogEntry) => {
    if (environmentId === null) return;
    await undo({ environmentId, input: { logId: entry.id } });
    refresh();
  };

  return (
    <VibeBossPage
      title={gt("Knowledge")}
      overlay={
        <KnowledgeGraphPage
          open={graphOpen}
          docs={data?.docs ?? []}
          onOpen={openDoc}
          onClose={() => setGraphOpen(false)}
        />
      }
      actions={
        environmentId !== null && data && folder !== null ? (
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                void reveal({
                  environmentId,
                  input: { cwd: folder, editor: "file-manager", reveal: false },
                })
              }
            >
              <FolderOpenIcon />
              <T>Open folder</T>
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={gt("Refresh")}
              onClick={() => refresh()}
            >
              <RefreshCwIcon />
            </Button>
            <OrganizeButton
              environmentId={environmentId}
              model={data.config.organizerModel}
              organizing={organizing}
              disabled={organizing || unorganized.length === 0}
              onOrganize={() => void runOrganize(true)}
              onModelChange={(model) => void setModel(model)}
            />
          </>
        ) : null
      }
    >
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      {environmentId === null || !data ? null : folder === null ? (
        <KnowledgeSetup
          defaultFolder={data.defaultFolder}
          onPick={(next) => void setFolder(next)}
        />
      ) : (
        <KnowledgeBody
          environmentId={environmentId}
          state={data}
          folder={folder}
          notice={notice}
          organizing={organizing}
          onUndo={(entry) => void runUndo(entry)}
          onOpenDoc={openDoc}
          onOpenGraph={() => setGraphOpen(true)}
        />
      )}
    </VibeBossPage>
  );
}
