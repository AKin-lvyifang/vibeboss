import type {
  EnvironmentId,
  ProjectId,
  VibeBossMemoryFile,
  VibeBossMemoryKind,
  VibeBossMemoryLogEntry,
  VibeBossMemoryState,
} from "@t3tools/contracts";
import {
  ArchiveIcon,
  ArrowLeftIcon,
  BrainIcon,
  BrushCleaningIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleDotIcon,
  FileTextIcon,
  FolderOpenIcon,
  HistoryIcon,
  ListChecksIcon,
  PencilIcon,
  PlusIcon,
  RulerIcon,
} from "lucide-react";
import { T, useGT } from "gt-react";
import { type ReactNode, useState } from "react";

import { cn } from "~/lib/utils";
import { useClientSettings } from "../../hooks/useSettings";
import { useEnvironmentQuery } from "../../state/query";
import { shellEnvironment } from "../../state/shell";
import { useAtomCommand } from "../../state/use-atom-command";
import { vibeBossEnvironment } from "../../state/vibeboss";
import { formatDayAwareTimestamp, formatShortTimestamp } from "../../timestampFormat";
import ChatMarkdown from "../ChatMarkdown";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** What the memory tab shows: a category, the update log, or one file as `file:<path>`. */
export type MemoryView = "current" | "decisions" | "spec" | "task" | "archive" | "log";

const LIST_KINDS = new Set<VibeBossMemoryKind>(["spec", "task", "archive"]);
const INDENT = ["ps-2", "ps-7", "ps-12", "ps-17"] as const;

const KIND_ICON = {
  current: FileTextIcon,
  decisions: ListChecksIcon,
  spec: RulerIcon,
  task: CircleDotIcon,
  archive: ArchiveIcon,
} as const;

interface MemoryTarget {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}

/** The category a `view` belongs to, and the file it opens if any. */
function parseView(view: string | undefined): { category: MemoryView; path: string | null } {
  if (view?.startsWith("file:")) {
    const path = view.slice(5);
    const kind: MemoryView = path.startsWith("spec/")
      ? "spec"
      : path.startsWith("tasks/")
        ? "task"
        : path.startsWith("archive/")
          ? "archive"
          : path === "decisions.md"
            ? "decisions"
            : "current";
    return LIST_KINDS.has(kind as VibeBossMemoryKind)
      ? { category: kind, path }
      : { category: kind, path: null };
  }
  const known = ["current", "decisions", "spec", "task", "archive", "log"] as const;
  return { category: known.find((entry) => entry === view) ?? "current", path: null };
}

function useTimestamp() {
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  return (iso: string) => formatDayAwareTimestamp(iso, timestampFormat);
}

function useKindLabel() {
  const gt = useGT();
  return (kind: VibeBossMemoryKind) =>
    ({
      current: gt("Current state"),
      decisions: gt("Decisions"),
      spec: gt("Project specs"),
      task: gt("Tasks"),
      archive: gt("Archive", { $context: "noun, finished tasks" }),
    })[kind];
}

function IconAction(props: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label={props.label}
            disabled={props.disabled}
            onClick={props.onClick}
          />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipPopup>{props.label}</TooltipPopup>
    </Tooltip>
  );
}

/** Tidy and Open folder: shown at the right of every view's header. */
function MemoryTools(props: MemoryTarget & { folder: string; onTidied: () => void }) {
  const gt = useGT();
  const tidyMemory = useAtomCommand(vibeBossEnvironment.tidyMemory);
  const reveal = useAtomCommand(shellEnvironment.openInEditor, { reportFailure: false });
  const [tidying, setTidying] = useState(false);
  return (
    <>
      <IconAction
        label={tidying ? gt("Tidying…") : gt("Tidy", { $context: "verb, tidies project memory" })}
        disabled={tidying}
        onClick={async () => {
          setTidying(true);
          await tidyMemory({
            environmentId: props.environmentId,
            input: { projectId: props.projectId },
          });
          setTidying(false);
          props.onTidied();
        }}
      >
        <BrushCleaningIcon aria-hidden className={tidying ? "animate-pulse" : undefined} />
      </IconAction>
      <IconAction
        label={gt("Open folder")}
        onClick={() =>
          void reveal({
            environmentId: props.environmentId,
            input: { cwd: props.folder, editor: "file-manager", reveal: false },
          })
        }
      >
        <FolderOpenIcon aria-hidden />
      </IconAction>
    </>
  );
}

function Header(props: { back?: () => void; title: string; children?: ReactNode }) {
  const gt = useGT();
  return (
    <div className="flex h-11 shrink-0 items-center gap-1 ps-4 pe-2">
      {props.back ? (
        <Button
          size="icon-xs"
          variant="ghost-muted"
          aria-label={gt("Back")}
          onClick={props.back}
          className="-ms-2"
        >
          <ArrowLeftIcon aria-hidden />
        </Button>
      ) : null}
      <h2 className="min-w-0 flex-1 truncate font-semibold text-sm">{props.title}</h2>
      <div className="flex shrink-0 items-center gap-0.5">{props.children}</div>
    </div>
  );
}

/** One file: read as Markdown, edited in place. */
function MemoryDocument(props: {
  target: MemoryTarget;
  memory: VibeBossMemoryState;
  file: VibeBossMemoryFile;
  title: string;
  tools: ReactNode;
  back: (() => void) | undefined;
  onChanged: () => void;
  onArchived: () => void;
}) {
  const gt = useGT();
  const time = useTimestamp();
  const { file, target } = props;
  const content = useEnvironmentQuery(
    vibeBossEnvironment.readMemory({
      environmentId: target.environmentId,
      input: { projectId: target.projectId, path: file.path },
    }),
  );
  const write = useAtomCommand(vibeBossEnvironment.writeMemory);
  const archive = useAtomCommand(vibeBossEnvironment.archiveMemory);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const text = content.data?.content ?? "";

  const save = async () => {
    if (draft === null) return;
    setSaving(true);
    const result = await write({
      environmentId: target.environmentId,
      input: { projectId: target.projectId, path: file.path, content: draft },
    });
    setSaving(false);
    if (result._tag !== "Success") return;
    setDraft(null);
    content.refresh();
    props.onChanged();
  };

  return (
    <>
      <Header title={props.title} {...(props.back ? { back: props.back } : {})}>
        {draft !== null ? (
          <>
            <Button size="xs" variant="ghost" onClick={() => setDraft(null)}>
              {gt("Cancel")}
            </Button>
            <Button size="xs" disabled={saving} onClick={() => void save()}>
              <T>Save</T>
            </Button>
          </>
        ) : (
          <>
            {file.kind === "task" ? (
              <IconAction
                label={gt("Archive", { $context: "verb, moves a finished task to the archive" })}
                onClick={async () => {
                  const result = await archive({
                    environmentId: target.environmentId,
                    input: { projectId: target.projectId, path: file.path },
                  });
                  if (result._tag === "Success") props.onArchived();
                }}
              >
                <ArchiveIcon aria-hidden />
              </IconAction>
            ) : null}
            <IconAction
              label={gt("Edit")}
              disabled={content.data === undefined}
              onClick={() => setDraft(text)}
            >
              <PencilIcon aria-hidden />
            </IconAction>
            {props.tools}
          </>
        )}
      </Header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        {draft !== null ? (
          <div className="flex h-full flex-col gap-2">
            {file.kind === "decisions" ? (
              <p className="text-muted-foreground text-xs">
                <T>Add new decisions at the end. Earlier decisions stay.</T>
              </p>
            ) : null}
            <Textarea
              autoFocus
              aria-label={props.title}
              className="min-h-80 flex-1"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
          </div>
        ) : (
          <>
            <p className="mb-3 text-muted-foreground text-xs tabular-nums">
              {time(file.modifiedAt)}
            </p>
            {text.trim() === "" ? (
              <p className="text-muted-foreground text-sm">
                <T>Nothing here yet</T>
              </p>
            ) : (
              <ChatMarkdown
                text={text}
                cwd={props.memory.folder}
                environmentId={target.environmentId}
              />
            )}
          </>
        )}
      </div>
    </>
  );
}

/** Spec files nested by folder: `spec/界面/文案.md` sits in the 界面 folder. */
interface SpecFolder {
  readonly folders: Map<string, SpecFolder>;
  readonly files: Array<VibeBossMemoryFile>;
}

function specTree(files: ReadonlyArray<VibeBossMemoryFile>): SpecFolder {
  const root: SpecFolder = { folders: new Map(), files: [] };
  for (const file of files) {
    let node = root;
    for (const part of file.path.split("/").slice(1, -1)) {
      let next = node.folders.get(part);
      if (next === undefined) {
        next = { folders: new Map(), files: [] };
        node.folders.set(part, next);
      }
      node = next;
    }
    node.files.push(file);
  }
  return root;
}

const ROW =
  "flex min-h-9 w-full items-center gap-2 rounded-md pe-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none";

function FileRow(props: { file: VibeBossMemoryFile; depth: number; onOpen: () => void }) {
  const time = useTimestamp();
  return (
    <button
      type="button"
      onClick={props.onOpen}
      className={cn(INDENT[Math.min(props.depth, INDENT.length - 1)], ROW)}
    >
      <FileTextIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">
        {props.file.kind === "archive"
          ? props.file.path.replace(/^archive\//, "").replace(/\.md$/, "")
          : props.file.title}
      </span>
      <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
        {time(props.file.modifiedAt)}
      </span>
    </button>
  );
}

function SpecRows(props: {
  folder: SpecFolder;
  depth: number;
  prefix: string;
  closed: ReadonlySet<string>;
  onToggle: (key: string) => void;
  onOpen: (file: VibeBossMemoryFile) => void;
}) {
  return (
    <>
      {[...props.folder.folders].map(([name, child]) => {
        const key = `${props.prefix}${name}/`;
        const isOpen = !props.closed.has(key);
        const Chevron = isOpen ? ChevronDownIcon : ChevronRightIcon;
        return (
          <div key={key}>
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => props.onToggle(key)}
              className={cn(INDENT[Math.min(props.depth, INDENT.length - 1)], ROW)}
            >
              <Chevron aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{name}</span>
            </button>
            {isOpen ? (
              <SpecRows {...props} folder={child} depth={props.depth + 1} prefix={key} />
            ) : null}
          </div>
        );
      })}
      {props.folder.files.map((file) => (
        <FileRow
          key={file.path}
          file={file}
          depth={props.depth}
          onOpen={() => props.onOpen(file)}
        />
      ))}
    </>
  );
}

function NewFileInput(props: {
  placeholder: string;
  onCreate: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const submit = () => {
    const trimmed = name.trim().replace(/^\/+|\/+$/g, "");
    if (trimmed !== "") props.onCreate(trimmed);
  };
  return (
    <div className="mb-2 flex items-center gap-2">
      <Input
        size="sm"
        autoFocus
        aria-label={props.placeholder}
        placeholder={props.placeholder}
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => (name.trim() === "" ? props.onCancel() : undefined)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter") submit();
          if (event.key === "Escape") props.onCancel();
        }}
      />
    </div>
  );
}

function LogList(props: {
  target: MemoryTarget;
  onOpen: (entry: VibeBossMemoryLogEntry) => void;
  onUndone: () => void;
}) {
  const gt = useGT();
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const log = useEnvironmentQuery(
    vibeBossEnvironment.memoryLog({
      environmentId: props.target.environmentId,
      input: { projectId: props.target.projectId },
    }),
  );
  const undo = useAtomCommand(vibeBossEnvironment.undoMemory);
  const [busy, setBusy] = useState(false);
  const days = new Map<string, Array<VibeBossMemoryLogEntry>>();
  for (const entry of log.data?.entries ?? []) {
    const day = new Date(entry.at).toLocaleDateString();
    days.set(day, [...(days.get(day) ?? []), entry]);
  }
  const author = (entry: VibeBossMemoryLogEntry) =>
    entry.author === "agent"
      ? gt("Lead", { $context: "the lead agent that wrote project memory" })
      : entry.author === "user"
        ? gt("You")
        : gt("VibeBoss");
  if (log.data !== undefined && days.size === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        <T>No updates yet</T>
      </p>
    );
  }
  return (
    <>
      {[...days].map(([day, entries]) => (
        <div key={day} className="mb-3">
          <div className="px-2 pb-1 text-muted-foreground text-xs">{day}</div>
          {entries.map((entry) => (
            <div key={entry.id} className="flex min-h-10 items-center gap-2 rounded-md px-2">
              <span className="w-16 shrink-0 text-muted-foreground text-xs tabular-nums">
                {formatShortTimestamp(entry.at, timestampFormat)}
              </span>
              <button
                type="button"
                disabled={entry.paths.length === 0}
                onClick={() => props.onOpen(entry)}
                className="min-w-0 flex-1 py-1 text-left"
              >
                <span
                  className={cn(
                    "block truncate text-sm",
                    entry.undone ? "text-muted-foreground line-through" : "font-medium",
                  )}
                >
                  {entry.summary}
                </span>
                <span className="block truncate text-muted-foreground text-xs">
                  {entry.source === "" ? author(entry) : `${author(entry)} · ${entry.source}`}
                </span>
              </button>
              {entry.undone ? (
                <span className="shrink-0 text-muted-foreground text-xs">
                  <T>Undone</T>
                </span>
              ) : (
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    await undo({
                      environmentId: props.target.environmentId,
                      input: { projectId: props.target.projectId, logId: entry.id },
                    });
                    setBusy(false);
                    log.refresh();
                    props.onUndone();
                  }}
                >
                  <T>Undo</T>
                </Button>
              )}
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

function EmptyMemory(props: MemoryTarget & { legacy: boolean; onCreated: () => void }) {
  const gt = useGT();
  const create = useAtomCommand(vibeBossEnvironment.createMemory);
  const [creating, setCreating] = useState(false);
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <BrainIcon aria-hidden className="size-7 text-muted-foreground" />
      <p className="text-muted-foreground text-sm">
        {props.legacy ? gt("No memory yet. Codex memory found.") : gt("No memory yet")}
      </p>
      <Button
        size="sm"
        disabled={creating}
        onClick={async () => {
          setCreating(true);
          await create({
            environmentId: props.environmentId,
            input: { projectId: props.projectId },
          });
          setCreating(false);
          props.onCreated();
        }}
      >
        {creating
          ? props.legacy
            ? gt("Creating and importing…")
            : gt("Creating…")
          : props.legacy
            ? gt("Create memory and import")
            : gt("Create memory")}
      </Button>
    </div>
  );
}

/** A project's memory as a right panel tab: categories on the left, the chosen one beside them. */
export function ProjectMemoryPanel(
  props: MemoryTarget & { view: string | undefined; onViewChange: (view: string) => void },
) {
  const gt = useGT();
  const kindLabel = useKindLabel();
  const { data: memory, refresh } = useEnvironmentQuery(
    vibeBossEnvironment.memory({
      environmentId: props.environmentId,
      input: { projectId: props.projectId },
    }),
  );
  const [closedFolders, setClosedFolders] = useState<ReadonlySet<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const write = useAtomCommand(vibeBossEnvironment.writeMemory);

  if (memory == null) return null;
  if (!memory.available) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-muted-foreground text-sm">
        <T>This project's folder is not reachable from here.</T>
      </div>
    );
  }
  if (!memory.exists) {
    return (
      <EmptyMemory
        environmentId={props.environmentId}
        projectId={props.projectId}
        legacy={memory.legacy}
        onCreated={refresh}
      />
    );
  }

  const { category, path } = parseView(props.view);
  const show = (view: string) => {
    setAdding(false);
    props.onViewChange(view);
  };
  const byKind = (kind: VibeBossMemoryKind) => memory.files.filter((file) => file.kind === kind);
  const tools = (
    <MemoryTools
      environmentId={props.environmentId}
      projectId={props.projectId}
      folder={memory.folder}
      onTidied={refresh}
    />
  );
  const openFile = (file: VibeBossMemoryFile) =>
    show(LIST_KINDS.has(file.kind) ? `file:${file.path}` : file.kind);
  const createFile = async (filePath: string) => {
    const result = await write({
      environmentId: props.environmentId,
      input: {
        projectId: props.projectId,
        path: filePath,
        content: filePath.startsWith("tasks/") ? "## 目标\n\n## 范围\n\n## 待确认\n" : "",
      },
    });
    if (result._tag !== "Success") return;
    refresh();
    show(`file:${filePath}`);
  };

  const navItem = (view: MemoryView, label: string, Icon: typeof FileTextIcon, count?: number) => (
    <button
      key={view}
      type="button"
      aria-current={category === view ? "page" : undefined}
      onClick={() => show(view)}
      className={cn(
        "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-accent hover:text-foreground",
        category === view ? "bg-accent font-medium text-foreground" : "text-muted-foreground",
      )}
    >
      <Icon aria-hidden className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count === undefined ? null : (
        <span className="text-muted-foreground text-xs tabular-nums">{count}</span>
      )}
    </button>
  );

  let body: ReactNode;
  const openedFile =
    path !== null
      ? memory.files.find((file) => file.path === path)
      : category === "current" || category === "decisions"
        ? byKind(category)[0]
        : undefined;
  if (category === "log") {
    body = (
      <>
        <Header title={gt("Update history")}>{tools}</Header>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-6">
          <LogList
            target={props}
            onUndone={refresh}
            onOpen={(entry) => {
              const file = memory.files.find((candidate) => entry.paths.includes(candidate.path));
              if (file) openFile(file);
            }}
          />
        </div>
      </>
    );
  } else if (openedFile !== undefined) {
    body = (
      <MemoryDocument
        key={openedFile.path}
        target={props}
        memory={memory}
        file={openedFile}
        title={LIST_KINDS.has(openedFile.kind) ? openedFile.title : kindLabel(openedFile.kind)}
        tools={tools}
        back={path !== null ? () => show(category) : undefined}
        onChanged={refresh}
        onArchived={() => {
          refresh();
          show("archive");
        }}
      />
    );
  } else {
    const kind = category as VibeBossMemoryKind;
    const files = byKind(kind);
    body = (
      <>
        <Header title={kindLabel(kind)}>
          {kind === "spec" || kind === "task" ? (
            <IconAction
              label={kind === "spec" ? gt("New spec") : gt("New task")}
              onClick={() => setAdding(true)}
            >
              <PlusIcon aria-hidden />
            </IconAction>
          ) : null}
          {tools}
        </Header>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-6">
          {adding ? (
            <NewFileInput
              placeholder={kind === "spec" ? gt("Spec name, or folder/name") : gt("Task name")}
              onCancel={() => setAdding(false)}
              onCreate={(name) =>
                void createFile(
                  kind === "spec" ? `spec/${name}.md` : `tasks/${name.replaceAll("/", " ")}.md`,
                )
              }
            />
          ) : null}
          {files.length === 0 && !adding ? (
            <p className="px-2 text-muted-foreground text-sm">
              <T>Nothing here yet</T>
            </p>
          ) : kind === "spec" ? (
            <SpecRows
              folder={specTree(files)}
              depth={0}
              prefix=""
              closed={closedFolders}
              onToggle={(key) =>
                setClosedFolders((current) => {
                  const next = new Set(current);
                  if (next.has(key)) next.delete(key);
                  else next.add(key);
                  return next;
                })
              }
              onOpen={openFile}
            />
          ) : (
            files.map((file) => (
              <FileRow key={file.path} file={file} depth={0} onOpen={() => openFile(file)} />
            ))
          )}
        </div>
      </>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      <nav className="flex w-36 shrink-0 flex-col gap-0.5 overflow-y-auto border-e p-2">
        {(["current", "decisions", "spec", "task", "archive"] as const).map((kind) =>
          navItem(
            kind,
            kindLabel(kind),
            KIND_ICON[kind],
            LIST_KINDS.has(kind) ? byKind(kind).length : undefined,
          ),
        )}
        <span className="flex-1" />
        {navItem("log", gt("Update history"), HistoryIcon)}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">{body}</div>
    </div>
  );
}
