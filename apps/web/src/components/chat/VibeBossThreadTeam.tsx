// VibeBoss: the thread details card's "Team" section (delegated child threads grouped by team
// member) and "Deliverables" section (files a person opens, grouped by who made them).
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ThreadStructure } from "@t3tools/client-runtime/state/models";
import type {
  EnvironmentId,
  OrchestrationV2Subagent,
  ProviderDriverKind,
  ScopedThreadRef,
  ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import { extractInlineCodeSpans, extractMarkdownLinkHrefs } from "@t3tools/shared/markdownLinks";
import { useNavigate } from "@tanstack/react-router";
import { useGT } from "gt-react";
import {
  AppWindowIcon,
  CheckIcon,
  CircleDotIcon,
  FileTextIcon,
  FilmIcon,
  ImageIcon,
  PackageIcon,
  XIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { resolveInlineCodeFileLinkMeta, resolveMarkdownFileLinkMeta } from "../../markdown-links";
import { useRightPanelStore } from "../../rightPanelStore";
import { useEnvironmentProviders } from "../../state/environments";
import { useQuietThreadProjection } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { shellEnvironment } from "../../state/shell";
import { useAtomCommand } from "../../state/use-atom-command";
import { vibeBossEnvironment } from "../../state/vibeboss";
import { buildThreadRouteParams } from "../../threadRoutes";
import {
  type DeliverableKind,
  type TeamMember,
  deliverableKind,
  isDeliverable,
  memberForDelegation,
} from "../../vibebossDeliverables";
import { cn } from "../../lib/utils";
import { Spinner } from "../ui/spinner";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import { THREAD_DETAILS_PANEL_LOCKED_ROW_CLASS } from "./threadDetailsPanelStyles";

const RUNNING_STATUSES: ReadonlySet<OrchestrationV2Subagent["status"]> = new Set([
  "pending",
  "running",
  "waiting",
]);
const CREATED_OPERATIONS = new Set(["add", "create", "write"]);

interface Delegation {
  readonly subagent: OrchestrationV2Subagent;
  readonly childThreadId: ThreadId;
  readonly title: string;
}

interface Group<T> {
  readonly key: string;
  readonly name: string;
  readonly driver: ProviderDriverKind | null;
  readonly items: ReadonlyArray<T>;
}

interface DeliverableFile {
  readonly path: string;
  readonly openPath: string;
  readonly name: string;
  readonly kind: DeliverableKind;
}

function useTeamMembers(environmentId: EnvironmentId): ReadonlyArray<TeamMember> {
  const state = useEnvironmentQuery(vibeBossEnvironment.state({ environmentId, input: {} }));
  return state.data?.config.members ?? [];
}

function delegationsOf(projection: ThreadStructure | null): ReadonlyArray<Delegation> {
  return (projection?.subagents ?? []).flatMap((subagent) =>
    subagent.origin === "app_owned" && subagent.childThreadId !== null
      ? [{ subagent, childThreadId: subagent.childThreadId, title: subagent.title ?? "" }]
      : [],
  );
}

/** Children of one member share a group; a child no member claims is grouped by its agent. */
function groupDelegations(
  delegations: ReadonlyArray<Delegation>,
  members: ReadonlyArray<TeamMember>,
  providers: ReadonlyArray<ServerProvider>,
): ReadonlyArray<Group<Delegation>> {
  const groups = new Map<
    string,
    { name: string; driver: ProviderDriverKind; items: Delegation[] }
  >();
  for (const delegation of delegations) {
    const { subagent } = delegation;
    const { member, title } = memberForDelegation(
      {
        title: subagent.title,
        providerInstanceId: subagent.providerInstanceId,
        model: subagent.model,
      },
      members,
    );
    const key = member ? `member:${member.id}` : `agent:${subagent.providerInstanceId}`;
    const name =
      member?.name ??
      providers.find((provider) => provider.instanceId === subagent.providerInstanceId)
        ?.displayName ??
      subagent.providerInstanceId;
    const group = groups.get(key) ?? { name, driver: subagent.driver, items: [] };
    group.items.push({ ...delegation, title });
    groups.set(key, group);
  }
  return [...groups].map(([key, group]) => ({ key, ...group }));
}

function modelLabel(
  providers: ReadonlyArray<ServerProvider>,
  subagent: OrchestrationV2Subagent,
): string | null {
  const slug = subagent.executedModel ?? subagent.model;
  if (slug === null) return null;
  const model = providers
    .find((provider) => provider.instanceId === subagent.providerInstanceId)
    ?.models.find((candidate) => candidate.slug === slug);
  return model?.shortName ?? model?.name ?? slug;
}

function GroupHeading(props: {
  readonly driver: ProviderDriverKind | null;
  readonly name: string;
  readonly meta?: ReactNode;
}) {
  return (
    <div className={cn(THREAD_DETAILS_PANEL_LOCKED_ROW_CLASS, "flex items-center")}>
      {props.driver ? (
        <ProviderInstanceIcon driverKind={props.driver} displayName={props.name} size="compact" />
      ) : null}
      <span className="min-w-0 flex-1 truncate">{props.name}</span>
      {props.meta ? (
        <span className="shrink-0 text-xs font-normal text-muted-foreground">{props.meta}</span>
      ) : null}
    </div>
  );
}

function StatusIcon({ status }: { readonly status: OrchestrationV2Subagent["status"] }) {
  if (RUNNING_STATUSES.has(status)) return <Spinner aria-hidden size="sm" tone="muted" />;
  if (status === "completed")
    return <CheckIcon aria-hidden className="size-3.5 text-muted-foreground" />;
  if (status === "idle")
    return <CircleDotIcon aria-hidden className="size-3.5 text-muted-foreground" />;
  return <XIcon aria-hidden className="size-3.5 text-destructive" />;
}

/** Delegated child threads, grouped by the team member each one went to. */
export function ThreadTeamSection(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const gt = useGT();
  const navigate = useNavigate();
  const projection =
    useQuietThreadProjection(scopeThreadRef(props.environmentId, props.threadId))?.projection ??
    null;
  const members = useTeamMembers(props.environmentId);
  const providers = useEnvironmentProviders().get(props.environmentId) ?? [];
  const groups = groupDelegations(delegationsOf(projection), members, providers);
  if (groups.length === 0) return null;

  return (
    <ThreadDetailsSection
      headingId="thread-details-team-heading"
      title={gt("Team")}
      data-thread-team-panel
    >
      <div className="flex flex-col">
        {groups.map((group) => {
          const running = group.items.filter((item) =>
            RUNNING_STATUSES.has(item.subagent.status),
          ).length;
          return (
            <div key={group.key} className="flex flex-col">
              <GroupHeading
                driver={group.driver}
                name={group.name}
                meta={
                  running > 0
                    ? gt("{count} running", { count: running })
                    : gt("All done", { $context: "every delegated task finished" })
                }
              />
              {group.items.map((item) => {
                const model = modelLabel(providers, item.subagent);
                return (
                  <ThreadDetailsControl
                    key={item.subagent.id}
                    title={item.title}
                    onClick={() =>
                      void navigate({
                        to: "/$environmentId/$threadId",
                        params: buildThreadRouteParams(
                          scopeThreadRef(props.environmentId, item.childThreadId),
                        ),
                      })
                    }
                  >
                    <span aria-hidden className="w-4 shrink-0" />
                    <StatusIcon status={item.subagent.status} />
                    <span className="min-w-0 flex-1 truncate font-normal">
                      {item.title || gt("Subagent")}
                    </span>
                    {model ? (
                      <span className="shrink-0 text-xs text-muted-foreground">{model}</span>
                    ) : null}
                  </ThreadDetailsControl>
                );
              })}
            </div>
          );
        })}
      </div>
    </ThreadDetailsSection>
  );
}

function deliverablesOf(
  projection: ThreadStructure | null,
  fallbackCwd: string | null,
): ReadonlyArray<DeliverableFile> {
  if (projection === null) return [];
  const cwd = projection.thread.worktreePath ?? fallbackCwd ?? undefined;
  const files = new Map<string, DeliverableFile>();
  const add = (
    meta: ReturnType<typeof resolveMarkdownFileLinkMeta>,
    source: "mentioned" | "created",
  ) => {
    if (meta === null) return;
    const relative = meta.workspaceRelativePath ?? meta.targetPath;
    const kind = deliverableKind(meta.targetPath);
    if (kind === null || !isDeliverable(relative, source)) return;
    // The latest mention or edit wins, so repeated work on one file stays one row.
    files.delete(meta.targetPath);
    files.set(meta.targetPath, {
      path: meta.targetPath,
      openPath: meta.workspaceRelativePath ?? meta.targetPath,
      name: meta.basename,
      kind,
    });
  };
  for (const item of projection.turnItems) {
    if (item.type !== "file_change" || item.status !== "completed") continue;
    for (const change of item.changes ?? []) {
      if (CREATED_OPERATIONS.has(change.operation.toLowerCase())) {
        add(resolveMarkdownFileLinkMeta(change.path, cwd), "created");
      }
    }
  }
  for (const message of projection.messages) {
    if (message.role !== "assistant" || message.streaming) continue;
    for (const href of extractMarkdownLinkHrefs(message.text)) {
      add(resolveMarkdownFileLinkMeta(href, cwd), "mentioned");
    }
    for (const span of extractInlineCodeSpans(message.text)) {
      add(resolveInlineCodeFileLinkMeta(span, cwd), "mentioned");
    }
  }
  return [...files.values()].reverse();
}

const KIND_ICON = {
  page: AppWindowIcon,
  document: FileTextIcon,
  image: ImageIcon,
  media: FilmIcon,
  package: PackageIcon,
} satisfies Record<DeliverableKind, unknown>;

interface ThreadFiles {
  readonly threadId: ThreadId;
  readonly files: ReadonlyArray<DeliverableFile>;
}

/** Reads each thread's projection in turn; hooks cannot run in a loop over a changing list. */
function CollectThreadFiles(props: {
  readonly environmentId: EnvironmentId;
  readonly threadIds: ReadonlyArray<ThreadId>;
  readonly cwd: string | null;
  readonly collected: ReadonlyArray<ThreadFiles>;
  readonly children: (collected: ReadonlyArray<ThreadFiles>) => ReactNode;
}) {
  const [threadId, ...rest] = props.threadIds;
  if (threadId === undefined) return props.children(props.collected);
  return <CollectOneThread {...props} threadId={threadId} rest={rest} />;
}

function CollectOneThread(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly rest: ReadonlyArray<ThreadId>;
  readonly cwd: string | null;
  readonly collected: ReadonlyArray<ThreadFiles>;
  readonly children: (collected: ReadonlyArray<ThreadFiles>) => ReactNode;
}) {
  const projection =
    useQuietThreadProjection(scopeThreadRef(props.environmentId, props.threadId))?.projection ??
    null;
  const files = deliverablesOf(projection, props.cwd);
  return (
    <CollectThreadFiles
      environmentId={props.environmentId}
      threadIds={props.rest}
      cwd={props.cwd}
      collected={[...props.collected, { threadId: props.threadId, files }]}
    >
      {props.children}
    </CollectThreadFiles>
  );
}

/** Pages, documents, images, media and packages this thread and its delegated children made. */
export function ThreadDeliverablesSection(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly cwd: string | null;
}) {
  const gt = useGT();
  const threadRef: ScopedThreadRef = scopeThreadRef(props.environmentId, props.threadId);
  const projection = useQuietThreadProjection(threadRef)?.projection ?? null;
  const members = useTeamMembers(props.environmentId);
  const providers = useEnvironmentProviders().get(props.environmentId) ?? [];
  const reveal = useAtomCommand(shellEnvironment.openInEditor, { reportFailure: false });
  const delegationGroups = groupDelegations(delegationsOf(projection), members, providers);
  const lead = providers.find(
    (provider) => provider.instanceId === projection?.thread.providerInstanceId,
  );
  const threadIds = [
    props.threadId,
    ...delegationGroups.flatMap((group) => group.items.map((item) => item.childThreadId)),
  ];

  const open = (file: DeliverableFile) => {
    if (file.kind === "package") {
      void reveal({
        environmentId: props.environmentId,
        input: { cwd: file.path, editor: "file-manager", reveal: true },
      });
      return;
    }
    useRightPanelStore.getState().openFile(threadRef, file.openPath);
  };

  return (
    <CollectThreadFiles
      environmentId={props.environmentId}
      threadIds={threadIds}
      cwd={props.cwd}
      collected={[]}
    >
      {(collected) => {
        const filesOf = (threadId: ThreadId) =>
          collected.find((entry) => entry.threadId === threadId)?.files ?? [];
        // A file a child made stays with that child, even when the lead repeats it in its reply.
        const childPaths = new Set(
          collected
            .filter((entry) => entry.threadId !== props.threadId)
            .flatMap((entry) => entry.files.map((file) => file.path)),
        );
        const groups: ReadonlyArray<Group<DeliverableFile>> = [
          {
            key: "lead",
            name: gt("Lead", { $context: "the agent the user talks to in a VibeBoss team" }),
            driver: lead?.driver ?? null,
            items: filesOf(props.threadId).filter((file) => !childPaths.has(file.path)),
          },
          ...delegationGroups.map((group) => ({
            key: group.key,
            name: group.name,
            driver: group.driver,
            items: group.items.flatMap((item) => filesOf(item.childThreadId)),
          })),
        ].filter((group) => group.items.length > 0);
        if (groups.length === 0) return null;
        return (
          <ThreadDetailsSection
            headingId="thread-details-deliverables-heading"
            title={gt("Deliverables")}
            data-thread-deliverables-panel
          >
            <div className="flex flex-col">
              {groups.map((group) => (
                <div key={group.key} className="flex flex-col">
                  <GroupHeading driver={group.driver} name={group.name} />
                  {group.items.map((file) => {
                    const Icon = KIND_ICON[file.kind];
                    return (
                      <ThreadDetailsControl
                        key={file.path}
                        title={file.openPath}
                        onClick={() => open(file)}
                      >
                        <span aria-hidden className="w-4 shrink-0" />
                        <Icon aria-hidden className="size-3.5 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate font-normal">{file.name}</span>
                      </ThreadDetailsControl>
                    );
                  })}
                </div>
              ))}
            </div>
          </ThreadDetailsSection>
        );
      }}
    </CollectThreadFiles>
  );
}
