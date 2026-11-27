import type {
  EnvironmentId,
  ProjectId,
  VibeBossMemoryFile,
  VibeBossMemoryLogEntry,
} from "@t3tools/contracts";
import {
  ArchiveIcon,
  ArrowLeftIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleDotIcon,
  FileTextIcon,
  FolderIcon,
  FolderOpenIcon,
  ListChecksIcon,
  PencilIcon,
  PlusIcon,
  RulerIcon,
} from "lucide-react";
import { T, useGT } from "gt-react";
import { useState } from "react";

import { cn } from "~/lib/utils";
import { useClientSettings } from "../../hooks/useSettings";
import { useEnvironmentQuery } from "../../state/query";
import { shellEnvironment } from "../../state/shell";
import { useAtomCommand } from "../../state/use-atom-command";
import { vibeBossEnvironment } from "../../state/vibeboss";
import { formatDayAwareTimestamp } from "../../timestampFormat";
import ChatMarkdown from "../ChatMarkdown";
import { SettingsRow, SettingsSection } from "../settings/settingsLayout";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Sheet, SheetHeader, SheetPopup, SheetTitle } from "../ui/sheet";
import { Textarea } from "../ui/textarea";

export const PROJECT_MEMORY_SECTION_ID = "project-memory";
const RECENT_LIMIT = 5;
const INDENT = ["ps-4", "ps-10", "ps-16", "ps-22"] as const;

interface MemoryTarget {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}

function useMemoryState(target: MemoryTarget) {
  return useEnvironmentQuery(
    vibeBossEnvironment.memory({
      environmentId: target.environmentId,
      input: { projectId: target.projectId },
    }),
  );
}

function useTimestamp() {
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  return (iso: string) => formatDayAwareTimestamp(iso, timestampFormat);
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

function countFiles(folder: SpecFolder): number {
  let count = folder.files.length;
  for (const child of folder.folders.values()) count += countFiles(child);
  return count;
}

const FILE_ICON = {
  current: FileTextIcon,
  decisions: ListChecksIcon,
  spec: RulerIcon,
  task: CircleDotIcon,
  archive: ArchiveIcon,
} as const;

function FileRow(props: {
  file: VibeBossMemoryFile;
  depth: number;
  label: string;
  onOpen: (file: VibeBossMemoryFile) => void;
}) {
  const time = useTimestamp();
  const Icon = FILE_ICON[props.file.kind];
  return (
    <button
      type="button"
      onClick={() => props.onOpen(props.file)}
      className={cn(
        INDENT[Math.min(props.depth, INDENT.length - 1)],
        "flex min-h-11 w-full items-center gap-2.5 border-t pe-4 text-left text-sm hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none",
      )}
    >
      <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate font-medium">{props.label}</span>
      <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
        {time(props.file.modifiedAt)}
      </span>
    </button>
  );
}

function SpecFolderRows(props: {
  folder: SpecFolder;
  depth: number;
  prefix: string;
  open: ReadonlySet<string>;
  onToggle: (key: string) => void;
  onOpen: (file: VibeBossMemoryFile) => void;
}) {
  return (
    <>
      {[...props.folder.folders].map(([name, child]) => {
        const key = `${props.prefix}${name}/`;
        const isOpen = props.open.has(key);
        const Icon = isOpen ? FolderOpenIcon : FolderIcon;
        return (
          <div key={key}>
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => props.onToggle(key)}
              className={cn(
                INDENT[Math.min(props.depth, INDENT.length - 1)],
                "flex min-h-11 w-full items-center gap-2.5 border-t pe-4 text-left text-sm hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none",
              )}
            >
              <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
              <span className="text-muted-foreground text-xs tabular-nums">
                {countFiles(child)}
              </span>
              {isOpen ? (
                <ChevronDownIcon aria-hidden className="size-4 text-muted-foreground" />
              ) : (
                <ChevronRightIcon aria-hidden className="size-4 text-muted-foreground" />
              )}
            </button>
            {isOpen ? (
              <SpecFolderRows {...props} folder={child} depth={props.depth + 1} prefix={key} />
            ) : null}
          </div>
        );
      })}
      {props.folder.files.map((file) => (
        <FileRow
          key={file.path}
          file={file}
          depth={props.depth}
          label={file.title}
          onOpen={props.onOpen}
        />
      ))}
    </>
  );
}

function GroupHeader(props: {
  title: string;
  newLabel: string;
  placeholder: string;
  onCreate: (name: string) => void;
}) {
  const gt = useGT();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const submit = () => {
    const trimmed = name.trim().replace(/^\/+|\/+$/g, "");
    if (trimmed === "") return;
    props.onCreate(trimmed);
    setAdding(false);
    setName("");
  };
  return (
    <div className="flex min-h-11 items-center gap-2 border-t px-4 text-muted-foreground text-sm">
      <span className="flex-1">{props.title}</span>
      {adding ? (
        <>
          <Input
            size="sm"
            autoFocus
            className="w-64"
            aria-label={props.placeholder}
            placeholder={props.placeholder}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Enter") submit();
              if (event.key === "Escape") setAdding(false);
            }}
          />
          <Button size="xs" onClick={submit}>
            <T>Create</T>
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setAdding(false)}>
            {gt("Cancel")}
          </Button>
        </>
      ) : (
        <Button size="xs" variant="ghost" onClick={() => setAdding(true)}>
          <PlusIcon aria-hidden />
          {props.newLabel}
        </Button>
      )}
    </div>
  );
}

function LogRow(props: {
  entry: VibeBossMemoryLogEntry;
  busy: boolean;
  onUndo: (entry: VibeBossMemoryLogEntry) => void;
}) {
  const gt = useGT();
  const time = useTimestamp();
  const { entry } = props;
  const author =
    entry.author === "agent"
      ? gt("Lead", { $context: "the lead agent that wrote project memory" })
      : entry.author === "user"
        ? gt("You")
        : gt("VibeBoss");
  return (
    <div className="flex min-h-11 items-center gap-3 border-t px-4 text-sm first:border-t-0">
      <span className="w-28 shrink-0 text-muted-foreground text-xs tabular-nums">
        {time(entry.at)}
      </span>
      <span className="min-w-0 flex-1 truncate">
        <span className={entry.undone ? "text-muted-foreground line-through" : "font-medium"}>
          {entry.summary}
        </span>
        <span className="ms-3 text-muted-foreground text-xs">
          {entry.source === "" ? author : `${author} · ${entry.source}`}
        </span>
      </span>
      {entry.undone ? (
        <span className="shrink-0 text-muted-foreground text-xs">
          <T>Undone</T>
        </span>
      ) : (
        <Button size="xs" variant="ghost" disabled={props.busy} onClick={() => props.onUndo(entry)}>
          <T>Undo</T>
        </Button>
      )}
    </div>
  );
}

function useUndo(target: MemoryTarget, refresh: () => void) {
  const undo = useAtomCommand(vibeBossEnvironment.undoMemory);
  const [busy, setBusy] = useState(false);
  const run = async (entry: VibeBossMemoryLogEntry) => {
    setBusy(true);
    await undo({
      environmentId: target.environmentId,
      input: { projectId: target.projectId, logId: entry.id },
    });
    setBusy(false);
    refresh();
  };
  return { busy, run };
}

/** The file opened from the list, read in a side sheet and edited in place. */
function MemoryFileSheet(props: {
  target: MemoryTarget;
  folder: string;
  file: VibeBossMemoryFile | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const gt = useGT();
  const time = useTimestamp();
  const { file } = props;
  const content = useEnvironmentQuery(
    file === null
      ? null
      : vibeBossEnvironment.readMemory({
          environmentId: props.target.environmentId,
          input: { projectId: props.target.projectId, path: file.path },
        }),
  );
  const write = useAtomCommand(vibeBossEnvironment.writeMemory);
  const archive = useAtomCommand(vibeBossEnvironment.archiveMemory);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const text = content.data?.content ?? "";

  const close = () => {
    setDraft(null);
    props.onClose();
  };
  const save = async () => {
    if (file === null || draft === null) return;
    setSaving(true);
    const result = await write({
      environmentId: props.target.environmentId,
      input: { projectId: props.target.projectId, path: file.path, content: draft },
    });
    setSaving(false);
    if (result._tag !== "Success") return;
    setDraft(null);
    content.refresh();
    props.onChanged();
  };
  const archiveTask = async () => {
    if (file === null) return;
    const result = await archive({
      environmentId: props.target.environmentId,
      input: { projectId: props.target.projectId, path: file.path },
    });
    if (result._tag !== "Success") return;
    props.onChanged();
    close();
  };

  return (
    <Sheet open={file !== null} onOpenChange={(open) => (open ? undefined : close())}>
      <SheetPopup className="sm:max-w-xl">
        <div className="pe-12">
          <SheetHeader>
            <SheetTitle>
              {file?.kind === "current"
                ? gt("Current state")
                : file?.kind === "decisions"
                  ? gt("Decisions")
                  : (file?.title ?? "")}
            </SheetTitle>
          </SheetHeader>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4">
          {draft !== null ? (
            <div className="flex h-full flex-col gap-3">
              {file?.kind === "decisions" ? (
                <p className="text-muted-foreground text-sm">
                  <T>Add new decisions at the end. Earlier decisions stay.</T>
                </p>
              ) : null}
              <Textarea
                autoFocus
                aria-label={file?.title ?? gt("Content")}
                className="min-h-96 flex-1"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
            </div>
          ) : text.trim() === "" ? (
            <p className="text-muted-foreground text-sm">
              <T>Nothing here yet</T>
            </p>
          ) : (
            <ChatMarkdown
              text={text}
              cwd={props.folder}
              environmentId={props.target.environmentId}
            />
          )}
        </div>
        <div className="flex items-center gap-2 border-t px-6 py-3">
          {draft !== null ? (
            <>
              <span className="flex-1" />
              <Button variant="outline" onClick={() => setDraft(null)}>
                {gt("Cancel")}
              </Button>
              <Button disabled={saving} onClick={() => void save()}>
                <T>Save</T>
              </Button>
            </>
          ) : (
            <>
              <span className="flex-1 text-muted-foreground text-xs tabular-nums">
                {file === null ? "" : time(file.modifiedAt)}
              </span>
              {file?.kind === "task" ? (
                <Button variant="outline" onClick={() => void archiveTask()}>
                  <ArchiveIcon aria-hidden />
                  {gt("Archive", { $context: "verb, moves a finished task to the archive" })}
                </Button>
              ) : null}
              <Button
                variant="outline"
                disabled={content.data === undefined}
                onClick={() => setDraft(text)}
              >
                <PencilIcon aria-hidden />
                <T>Edit</T>
              </Button>
            </>
          )}
        </div>
      </SheetPopup>
    </Sheet>
  );
}

/** The project's memory in project settings: its files, newest changes, and undo. */
export function ProjectMemorySettings(props: MemoryTarget & { onOpenLog: () => void }) {
  const gt = useGT();
  const { data: memory, refresh } = useMemoryState(props);
  const create = useAtomCommand(vibeBossEnvironment.createMemory);
  const write = useAtomCommand(vibeBossEnvironment.writeMemory);
  const reveal = useAtomCommand(shellEnvironment.openInEditor, { reportFailure: false });
  const undo = useUndo(props, refresh);
  const [opened, setOpened] = useState<VibeBossMemoryFile | null>(null);
  const [openFolders, setOpenFolders] = useState<ReadonlySet<string>>(new Set());
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  if (memory == null || !memory.available) return null;

  const createMemory = async () => {
    setCreating(true);
    await create({ environmentId: props.environmentId, input: { projectId: props.projectId } });
    setCreating(false);
    refresh();
  };
  const createFile = async (path: string) => {
    const initial = path.startsWith("tasks/") ? "## 目标\n\n## 范围\n\n## 待确认\n" : "";
    const result = await write({
      environmentId: props.environmentId,
      input: { projectId: props.projectId, path, content: initial },
    });
    if (result._tag !== "Success") return;
    refresh();
    const file = result.value.files.find((candidate) => candidate.path === path);
    if (file) setOpened(file);
  };

  if (!memory.exists) {
    return (
      <SettingsSection id={PROJECT_MEMORY_SECTION_ID} title={gt("Project memory")}>
        <SettingsRow
          title={gt("No project memory yet")}
          control={
            <Button size="sm" disabled={creating} onClick={() => void createMemory()}>
              {memory.legacy ? gt("Import Codex memory") : gt("Create project memory")}
            </Button>
          }
        />
      </SettingsSection>
    );
  }

  const byKind = (kind: VibeBossMemoryFile["kind"]) =>
    memory.files.filter((file) => file.kind === kind);
  const top = [...byKind("current"), ...byKind("decisions")];
  const tasks = byKind("task");
  const archived = byKind("archive");
  const toggleFolder = (key: string) =>
    setOpenFolders((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <SettingsSection
      id={PROJECT_MEMORY_SECTION_ID}
      title={gt("Project memory")}
      headerAction={
        <Button
          size="xs"
          variant="ghost"
          onClick={() =>
            void reveal({
              environmentId: props.environmentId,
              input: { cwd: memory.folder, editor: "file-manager", reveal: false },
            })
          }
        >
          <FolderOpenIcon aria-hidden />
          <T>Open folder</T>
        </Button>
      }
    >
      <div className="[&>*:first-child]:border-t-0">
        {top.map((file) => (
          <FileRow
            key={file.path}
            file={file}
            depth={0}
            label={file.kind === "current" ? gt("Current state") : gt("Decisions")}
            onOpen={setOpened}
          />
        ))}
        <GroupHeader
          title={gt("Project specs")}
          newLabel={gt("New spec")}
          placeholder={gt("Name, or folder/name")}
          onCreate={(name) => void createFile(`spec/${name}.md`)}
        />
        <SpecFolderRows
          folder={specTree(byKind("spec"))}
          depth={0}
          prefix=""
          open={openFolders}
          onToggle={toggleFolder}
          onOpen={setOpened}
        />
        <GroupHeader
          title={gt("Tasks")}
          newLabel={gt("New task")}
          placeholder={gt("Task name")}
          onCreate={(name) => void createFile(`tasks/${name.replaceAll("/", " ")}.md`)}
        />
        {tasks.map((file) => (
          <FileRow key={file.path} file={file} depth={0} label={file.title} onOpen={setOpened} />
        ))}
        {archived.length > 0 ? (
          <>
            <button
              type="button"
              aria-expanded={archiveOpen}
              onClick={() => setArchiveOpen((open) => !open)}
              className="flex min-h-11 w-full items-center gap-2.5 border-t px-4 text-left text-muted-foreground text-sm hover:bg-accent/50"
            >
              {archiveOpen ? (
                <ChevronDownIcon aria-hidden className="size-4" />
              ) : (
                <ChevronRightIcon aria-hidden className="size-4" />
              )}
              <span className="flex-1">{gt("Archive", { $context: "noun, finished tasks" })}</span>
              <span className="text-xs tabular-nums">{archived.length}</span>
            </button>
            {archiveOpen
              ? archived.map((file) => (
                  <FileRow
                    key={file.path}
                    file={file}
                    depth={1}
                    label={file.path.replace(/^archive\//, "").replace(/\.md$/, "")}
                    onOpen={setOpened}
                  />
                ))
              : null}
          </>
        ) : null}
      </div>
      {memory.recent.length > 0 ? (
        <div className="border-t">
          <div className="px-4 pt-3 pb-1 font-medium text-sm">
            <T>Recent updates</T>
          </div>
          {memory.recent.slice(0, RECENT_LIMIT).map((entry) => (
            <LogRow key={entry.id} entry={entry} busy={undo.busy} onUndo={undo.run} />
          ))}
          {memory.logCount > RECENT_LIMIT ? (
            <button
              type="button"
              onClick={props.onOpenLog}
              className="flex min-h-11 w-full items-center gap-2 border-t px-4 text-left text-muted-foreground text-sm hover:bg-accent/50"
            >
              <span className="flex-1">
                <T>All updates</T>
              </span>
              <span className="text-xs tabular-nums">{memory.logCount}</span>
              <ChevronRightIcon aria-hidden className="size-4" />
            </button>
          ) : null}
        </div>
      ) : null}
      <MemoryFileSheet
        target={props}
        folder={memory.folder}
        file={opened}
        onClose={() => setOpened(null)}
        onChanged={refresh}
      />
    </SettingsSection>
  );
}

/** Every logged change, grouped by day: the page "All updates" opens in place of the settings. */
export function ProjectMemoryLogPage(props: MemoryTarget & { onBack: () => void }) {
  const gt = useGT();
  const log = useEnvironmentQuery(
    vibeBossEnvironment.memoryLog({
      environmentId: props.environmentId,
      input: { projectId: props.projectId },
    }),
  );
  const state = useMemoryState(props);
  const undo = useUndo(props, () => {
    log.refresh();
    state.refresh();
  });
  const days = new Map<string, Array<VibeBossMemoryLogEntry>>();
  for (const entry of log.data?.entries ?? []) {
    const day = new Date(entry.at).toLocaleDateString();
    days.set(day, [...(days.get(day) ?? []), entry]);
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <Button size="icon-sm" variant="ghost" aria-label={gt("Back")} onClick={props.onBack}>
          <ArrowLeftIcon />
        </Button>
        <h2 className="font-semibold text-base">
          <T>All updates</T>
        </h2>
      </div>
      {[...days].map(([day, entries]) => (
        <SettingsSection key={day} title={day}>
          {entries.map((entry) => (
            <LogRow key={entry.id} entry={entry} busy={undo.busy} onUndo={undo.run} />
          ))}
        </SettingsSection>
      ))}
    </div>
  );
}
