// VibeBoss: the "Cloud" tab of the Knowledge page. Cloud libraries live in the company's Xiaobang
// service; here the user only picks which ones conversations may search and follows the steps that
// publish the local folder to their own library.
import type {
  EnvironmentId,
  VibeBossKnowledgeCloudLibrary,
  VibeBossKnowledgeCloudState,
} from "@t3tools/contracts";
import { T, useGT, Var } from "gt-react";
import {
  CheckIcon,
  ChevronRightIcon,
  CloudOffIcon,
  ExternalLinkIcon,
  GlobeIcon,
  LockIcon,
  RouteIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { readLocalApi } from "../../localApi";
import { cn } from "../../lib/utils";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { vibeBossEnvironment } from "../../state/vibeboss";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../ui/empty";
import { Input } from "../ui/input";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { VibeBossSubPage } from "./VibeBossShared";

const CONSOLE_URL = "https://xiaobang.ctripcorp.com/admin/knowledge";

type Library = VibeBossKnowledgeCloudLibrary;
export type CloudPage = "picker" | "publish" | null;

const ROW = "flex w-full items-center gap-2.5 px-4 py-1.5 text-left text-sm";
const ROW_ICON =
  "flex size-4 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-4";

function StatusBadge({ library }: { readonly library: Library }) {
  return library.status === "ready" ? (
    <Badge variant="success">
      <T>Searchable</T>
    </Badge>
  ) : (
    <Badge variant="warning">
      {library.status === "building" ? <T>Building</T> : <T>No documents</T>}
    </Badge>
  );
}

function openExternal(url: string) {
  void readLocalApi()?.shell.openExternal(url);
}

function Stat(props: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-muted-foreground text-sm">{props.label}</dt>
      <dd className="font-semibold text-3xl text-foreground tabular-nums">{props.children}</dd>
    </div>
  );
}

/** One added library: a row that opens to what it is and how to remove it. */
function LibraryRow(props: { readonly library: Library; readonly onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const { library } = props;
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cn(ROW, "outline-none hover:bg-accent/50 focus-visible:bg-accent/50")}
      >
        <span className={ROW_ICON}>
          {library.visibility === "private" ? <LockIcon /> : <GlobeIcon />}
        </span>
        <span className="min-w-0 flex-1 truncate">{library.name}</span>
        <StatusBadge library={library} />
      </button>
      {open ? (
        <div className="flex flex-col gap-2 bg-muted/50 px-4 py-3 text-sm">
          {library.description !== "" ? <p>{library.description}</p> : null}
          <p className="break-all font-mono text-muted-foreground text-xs">{library.id}</p>
          <div className="flex gap-2">
            <Button size="xs" variant="outline" onClick={() => openExternal(CONSOLE_URL)}>
              <ExternalLinkIcon />
              <T>Open console</T>
            </Button>
            <Button size="xs" variant="ghost" onClick={props.onRemove}>
              <T>Remove</T>
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function KnowledgeCloudTab(props: {
  readonly state: VibeBossKnowledgeCloudState;
  readonly onOpen: (page: Exclude<CloudPage, null>) => void;
  readonly onRemove: (library: Library) => void;
  readonly onRecheck: () => void;
}) {
  const gt = useGT();
  const { state } = props;
  if (!state.configured) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CloudOffIcon />
          </EmptyMedia>
          <EmptyTitle>
            <T>Xiaobang is not connected</T>
          </EmptyTitle>
          <EmptyDescription>
            <T>
              Cloud libraries are reached through the Xiaobang MCP server in Claude. Sign in to it
              in Claude, then check again.
            </T>
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" onClick={props.onRecheck}>
            <T>Check again</T>
          </Button>
        </EmptyContent>
      </Empty>
    );
  }
  const target = state.libraries.find((library) => library.id === state.publish.targetId);
  const groups = (["private", "public"] as const)
    .map((visibility) => ({
      visibility,
      libraries: state.libraries.filter((library) => library.visibility === visibility),
    }))
    .filter((group) => group.libraries.length > 0);
  return (
    <>
      <dl className="flex gap-12">
        <Stat label={gt("Added")}>{state.libraries.length}</Stat>
        <Stat label={gt("Searchable")}>
          {state.libraries.filter((library) => library.status === "ready").length}
        </Stat>
        <Stat label={gt("Visible in Xiaobang")}>
          <button
            type="button"
            onClick={() => props.onOpen("picker")}
            className="outline-none hover:underline focus-visible:underline"
          >
            {state.catalogUpdatedAt === null ? "–" : state.catalogTotal}
          </button>
        </Stat>
      </dl>
      {target !== undefined && !state.publish.sourceLinked ? (
        <button
          type="button"
          onClick={() => props.onOpen("publish")}
          className="flex w-full items-center gap-2.5 rounded-xl border px-4 py-2.5 text-left text-sm outline-none hover:bg-accent/50 focus-visible:bg-accent/50"
        >
          <span className={ROW_ICON}>
            <RouteIcon />
          </span>
          <span className="min-w-0 flex-1">
            <T>
              Publishing the local knowledge base to <Var>{target.name}</Var> needs 1 manual step.
            </T>
          </span>
          <span className={ROW_ICON}>
            <ChevronRightIcon />
          </span>
        </button>
      ) : null}
      {groups.length === 0 ? (
        <p className="rounded-xl border px-4 py-6 text-center text-muted-foreground text-sm">
          <T>No cloud libraries</T>
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {groups.map((group) => (
            <div
              key={group.visibility}
              className="flex flex-col overflow-hidden rounded-xl border pb-2"
            >
              <h3 className="flex items-baseline gap-2 px-4 pt-3 pb-1.5 font-medium text-sm">
                {group.visibility === "private" ? <T>Private</T> : <T>Public</T>}
                <span className="font-normal text-muted-foreground text-xs tabular-nums">
                  {group.libraries.length}
                </span>
              </h3>
              {group.libraries.map((library) => (
                <LibraryRow
                  key={library.id}
                  library={library}
                  onRemove={() => props.onRemove(library)}
                />
              ))}
            </div>
          ))}
        </div>
      )}
      {target !== undefined && state.publish.sourceLinked ? (
        <p className="text-muted-foreground text-xs">
          <T>
            The local knowledge base is published to <Var>{target.name}</Var>.
          </T>{" "}
          <button
            type="button"
            onClick={() => props.onOpen("publish")}
            className="text-primary outline-none hover:underline focus-visible:underline"
          >
            <T>View steps</T>
          </button>
        </p>
      ) : null}
    </>
  );
}

function Step(props: {
  readonly index: number;
  readonly done: boolean;
  readonly title: ReactNode;
  readonly kind: ReactNode;
  readonly warn?: boolean;
  readonly children: ReactNode;
  readonly actions?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 border-b px-4 py-3.5 last:border-b-0">
      <span
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-full bg-accent font-semibold text-muted-foreground text-xs [&_svg]:size-3.5",
          props.done && "bg-success/16 text-success-foreground",
        )}
      >
        {props.done ? <CheckIcon /> : props.index}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h3 className="flex items-center gap-2 font-medium text-sm">
          {props.title}
          <Badge variant={props.warn ? "warning" : "outline"}>{props.kind}</Badge>
        </h3>
        <p className="text-muted-foreground text-sm">{props.children}</p>
        {props.actions ? <div className="mt-1 flex flex-wrap gap-2">{props.actions}</div> : null}
      </div>
    </div>
  );
}

function PublishSteps(props: {
  readonly state: VibeBossKnowledgeCloudState;
  readonly synced: number;
  readonly unsynced: number;
  readonly onSync: () => void;
  readonly onLinked: (linked: boolean) => void;
}) {
  const { state } = props;
  const target = state.libraries.find((library) => library.id === state.publish.targetId);
  const folderUrl = state.feishuFolderUrl;
  return (
    <div className="scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-6 py-6">
        <div className="overflow-hidden rounded-xl border">
          <Step
            index={1}
            done={folderUrl !== null && props.unsynced === 0}
            title={<T>Sync to Feishu</T>}
            kind={<T>Automatic</T>}
            actions={
              <>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={props.unsynced === 0}
                  onClick={props.onSync}
                >
                  <T>Sync to Feishu</T>
                </Button>
                {folderUrl !== null ? (
                  <Button size="xs" variant="outline" onClick={() => openExternal(folderUrl)}>
                    <ExternalLinkIcon />
                    <T>Open folder</T>
                  </Button>
                ) : null}
              </>
            }
          >
            {folderUrl === null ? (
              <T>The local knowledge base is synced to one Feishu folder, "VibeBoss 知识库".</T>
            ) : (
              <T>
                <Var>{props.synced}</Var> files are in the Feishu folder "VibeBoss 知识库".
              </T>
            )}
          </Step>
          <Step
            index={2}
            done={state.publish.sourceLinked}
            warn={!state.publish.sourceLinked}
            title={<T>Add as a data source</T>}
            kind={<T>Manual, once</T>}
            actions={
              state.publish.sourceLinked ? (
                <Button size="xs" variant="outline" onClick={() => props.onLinked(false)}>
                  <T>Unmark</T>
                </Button>
              ) : (
                <>
                  {folderUrl !== null ? (
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => void navigator.clipboard.writeText(folderUrl)}
                    >
                      <T>Copy link</T>
                    </Button>
                  ) : null}
                  <Button size="xs" variant="outline" onClick={() => openExternal(CONSOLE_URL)}>
                    <ExternalLinkIcon />
                    <T>Open console</T>
                  </Button>
                  <Button size="xs" onClick={() => props.onLinked(true)}>
                    <T>Mark as done</T>
                  </Button>
                </>
              )
            }
          >
            {state.publish.sourceLinked ? (
              <T>Added in the Xiaobang console.</T>
            ) : (
              <T>
                In the Xiaobang console, add that Feishu folder as a data source of{" "}
                <Var>{target?.name ?? ""}</Var>.
              </T>
            )}
          </Step>
          <Step
            index={3}
            done={false}
            title={<T>Cloud library update</T>}
            kind={<T>Automatic</T>}
            actions={
              state.publish.sourceLinked ? (
                <Button size="xs" variant="outline" onClick={() => openExternal(CONSOLE_URL)}>
                  <ExternalLinkIcon />
                  <T>Rebuild now</T>
                </Button>
              ) : undefined
            }
          >
            <T>
              The library updates on its own schedule and is searchable once done. To use it sooner,
              rebuild it in the console.
            </T>
          </Step>
        </div>
      </div>
    </div>
  );
}

type Visibility = "all" | "private" | "public";

function Picker(props: {
  readonly environmentId: EnvironmentId;
  readonly state: VibeBossKnowledgeCloudState;
  readonly onToggle: (library: Library) => void;
  readonly onFetch: () => void;
}) {
  const gt = useGT();
  const [query, setQuery] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("all");
  const [onlyReady, setOnlyReady] = useState(false);
  const { data } = useEnvironmentQuery(
    vibeBossEnvironment.knowledgeCloudCatalog({
      environmentId: props.environmentId,
      input: { query, visibility, onlyReady },
    }),
  );
  const added = new Set(props.state.libraries.map((library) => library.id));
  if (props.state.catalogUpdatedAt === null) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>
            <T>No library list yet</T>
          </EmptyTitle>
          <EmptyDescription>
            <T>
              Claude fetches the list from Xiaobang in a new conversation. Come back here when it
              finishes.
            </T>
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={props.onFetch}>
            <T>Fetch list</T>
          </Button>
        </EmptyContent>
      </Empty>
    );
  }
  const filtered = query.trim() !== "" || visibility !== "all" || onlyReady;
  return (
    <div className="scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-6 py-6">
        <Input
          type="search"
          value={query}
          aria-label={gt("Search cloud libraries")}
          placeholder={gt("Search name or description")}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="flex flex-wrap items-center gap-3">
          <ToggleGroup
            value={[visibility]}
            onValueChange={(value) => {
              const next = value[0] as Visibility | undefined;
              if (next) setVisibility(next);
            }}
          >
            <ToggleGroupItem value="all">
              <T>All</T>
            </ToggleGroupItem>
            <ToggleGroupItem value="private">
              <T>Private</T>
            </ToggleGroupItem>
            <ToggleGroupItem value="public">
              <T>Public</T>
            </ToggleGroupItem>
          </ToggleGroup>
          <Button
            size="sm"
            variant="outline"
            aria-pressed={onlyReady}
            onClick={() => setOnlyReady(!onlyReady)}
          >
            <T>Searchable only</T>
          </Button>
          <span className="flex-1" />
          <span className="text-muted-foreground text-xs tabular-nums">
            {data === null ? null : filtered ? (
              <T>
                <Var>{data.total}</Var> in total, <Var>{data.matched}</Var> match
              </T>
            ) : (
              <T>
                <Var>{data.total}</Var> in total, first <Var>{data.items.length}</Var> shown
              </T>
            )}
          </span>
        </div>
        {data !== null && data.items.length === 0 ? (
          <p className="rounded-xl border px-4 py-6 text-center text-muted-foreground text-sm">
            <T>No matching cloud libraries</T>
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border py-1">
            {(data?.items ?? []).map((library) => (
              <div key={library.id} className={ROW}>
                <span className={ROW_ICON}>
                  {library.visibility === "private" ? <LockIcon /> : <GlobeIcon />}
                </span>
                <span className="min-w-0 flex-1 truncate">{library.name}</span>
                <StatusBadge library={library} />
                <Button
                  size="xs"
                  variant={added.has(library.id) ? "outline" : "default"}
                  onClick={() => props.onToggle(library)}
                >
                  {added.has(library.id) ? <T>Remove</T> : <T>Add</T>}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** The cloud tab's second-level pages: picking libraries, and the publish steps. */
export function KnowledgeCloudPages(props: {
  readonly environmentId: EnvironmentId | null;
  readonly page: CloudPage;
  readonly state: VibeBossKnowledgeCloudState | null;
  readonly synced: number;
  readonly unsynced: number;
  readonly onClose: () => void;
  readonly onSaved: () => void;
  readonly onSync: () => void;
  readonly onFetchCatalog: () => void;
}) {
  const gt = useGT();
  const save = useAtomCommand(vibeBossEnvironment.saveKnowledgeCloud);
  const { environmentId, state } = props;
  const persist = async (next: Pick<VibeBossKnowledgeCloudState, "libraries" | "publish">) => {
    if (environmentId === null) return;
    await save({ environmentId, input: { libraries: next.libraries, publish: next.publish } });
    props.onSaved();
  };
  const toggle = (library: Library) => {
    if (state === null) return;
    const libraries = state.libraries.some((item) => item.id === library.id)
      ? state.libraries.filter((item) => item.id !== library.id)
      : [...state.libraries, library];
    // The first private library the user adds is the one their own folder publishes to.
    const stillThere = libraries.some((item) => item.id === state.publish.targetId);
    const targetId = stillThere
      ? state.publish.targetId
      : (libraries.find((item) => item.visibility === "private")?.id ?? null);
    void persist({
      libraries,
      publish: { targetId, sourceLinked: stillThere && state.publish.sourceLinked },
    });
  };
  return (
    <>
      <VibeBossSubPage
        open={props.page === "picker"}
        title={gt("Add cloud libraries")}
        onClose={props.onClose}
        actions={
          state?.catalogUpdatedAt ? (
            <Button size="sm" variant="ghost" onClick={props.onFetchCatalog}>
              <T>Refresh list</T>
            </Button>
          ) : undefined
        }
      >
        {environmentId !== null && state !== null ? (
          <Picker
            environmentId={environmentId}
            state={state}
            onToggle={toggle}
            onFetch={props.onFetchCatalog}
          />
        ) : null}
      </VibeBossSubPage>
      <VibeBossSubPage
        open={props.page === "publish"}
        title={gt("Publish to the cloud")}
        onClose={props.onClose}
      >
        {state !== null ? (
          <PublishSteps
            state={state}
            synced={props.synced}
            unsynced={props.unsynced}
            onSync={props.onSync}
            onLinked={(sourceLinked) =>
              void persist({
                libraries: state.libraries,
                publish: { ...state.publish, sourceLinked },
              })
            }
          />
        ) : null}
      </VibeBossSubPage>
    </>
  );
}

/** Removing a library also drops it as the publish target when it was one. */
export function withoutLibrary(
  state: VibeBossKnowledgeCloudState,
  library: Library,
): Pick<VibeBossKnowledgeCloudState, "libraries" | "publish"> {
  const libraries = state.libraries.filter((item) => item.id !== library.id);
  const kept = state.publish.targetId !== library.id;
  return {
    libraries,
    publish: {
      targetId: kept
        ? state.publish.targetId
        : (libraries.find((item) => item.visibility === "private")?.id ?? null),
      sourceLinked: kept && state.publish.sourceLinked,
    },
  };
}

export { CONSOLE_URL as XIAOBANG_CONSOLE_URL };
