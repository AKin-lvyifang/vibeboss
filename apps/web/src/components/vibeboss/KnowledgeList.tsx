import type { VibeBossKnowledgeDoc, VibeBossKnowledgeDocType } from "@t3tools/contracts";
import { T, useGT, Var } from "gt-react";
import {
  ChevronRightIcon,
  FileCodeIcon,
  FileIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  FileTypeIcon,
  PresentationIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "../../lib/utils";
import { MiddleTruncate } from "../ui/middle-truncate";

const PREVIEW_ROWS = 6;

const TYPE_ICON: Record<VibeBossKnowledgeDocType, ReactNode> = {
  md: <FileTextIcon />,
  pptx: <PresentationIcon />,
  docx: <FileTypeIcon />,
  xlsx: <FileSpreadsheetIcon />,
  html: <FileCodeIcon />,
  pdf: <FileIcon />,
  other: <FileIcon />,
};

const ROW =
  "flex w-full items-center gap-2.5 px-4 py-1.5 text-left text-sm outline-none hover:bg-accent/50 focus-visible:bg-accent/50";
const ROW_ICON =
  "flex size-4 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-4";

function DocRow(props: { readonly doc: VibeBossKnowledgeDoc; readonly onOpen: () => void }) {
  return (
    <button type="button" onClick={props.onOpen} className={ROW}>
      <span className={ROW_ICON}>{TYPE_ICON[props.doc.type]}</span>
      <MiddleTruncate value={props.doc.name} showTitle={false} className="min-w-0 flex-1" />
    </button>
  );
}

/** One document kept in several versions: a row that opens to its files, newest first. */
function TopicRow(props: {
  readonly topic: string;
  readonly versions: ReadonlyArray<VibeBossKnowledgeDoc>;
  readonly onOpen: (doc: VibeBossKnowledgeDoc) => void;
}) {
  const gt = useGT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className={ROW}>
        <span className={ROW_ICON}>
          <ChevronRightIcon className={cn("transition-transform", open && "rotate-90")} />
        </span>
        <span className="min-w-0 flex-1 truncate">{props.topic}</span>
        <span className="shrink-0 text-muted-foreground text-xs">
          {gt("{count, plural, one {{count} version} other {{count} versions}}", {
            count: props.versions.length,
          })}
        </span>
      </button>
      {open ? (
        <div className="bg-muted/50">
          {props.versions.map((doc) => (
            <DocRow key={doc.path} doc={doc} onOpen={() => props.onOpen(doc)} />
          ))}
        </div>
      ) : null}
    </>
  );
}

interface Entry {
  readonly key: string;
  readonly docs: ReadonlyArray<VibeBossKnowledgeDoc>;
}

function GroupCard(props: {
  readonly title: string;
  readonly entries: ReadonlyArray<Entry>;
  readonly count: number;
  readonly onOpen: (doc: VibeBossKnowledgeDoc) => void;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? props.entries : props.entries.slice(0, PREVIEW_ROWS);
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border pb-2">
      <h3 className="flex items-baseline gap-2 px-4 pt-3 pb-1.5 font-medium text-sm">
        <span className="min-w-0 truncate">{props.title}</span>
        <span className="font-normal text-muted-foreground text-xs tabular-nums">
          {props.count}
        </span>
      </h3>
      {shown.map((entry) =>
        entry.docs.length === 1 ? (
          <DocRow
            key={entry.key}
            doc={entry.docs[0]!}
            onOpen={() => props.onOpen(entry.docs[0]!)}
          />
        ) : (
          <TopicRow key={entry.key} topic={entry.key} versions={entry.docs} onOpen={props.onOpen} />
        ),
      )}
      {props.entries.length > PREVIEW_ROWS && !all ? (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="px-4 py-1.5 text-left text-primary text-sm outline-none hover:underline focus-visible:underline"
        >
          <T>
            View all <Var>{props.entries.length}</Var>
          </T>
        </button>
      ) : null}
    </div>
  );
}

/** Categories as sections, each group a card; versions of one topic share a row. */
export function KnowledgeList(props: {
  readonly docs: ReadonlyArray<VibeBossKnowledgeDoc>;
  readonly onOpen: (doc: VibeBossKnowledgeDoc) => void;
}) {
  const gt = useGT();
  const categories = new Map<string, Map<string, Map<string, Array<VibeBossKnowledgeDoc>>>>();
  for (const doc of props.docs) {
    const category = doc.organized ? doc.category : "";
    const groups = categories.get(category) ?? new Map();
    const group = doc.organized ? doc.group : "";
    const topics: Map<string, Array<VibeBossKnowledgeDoc>> = groups.get(group) ?? new Map();
    const topic = doc.organized ? doc.topic : doc.path;
    topics.set(topic, [...(topics.get(topic) ?? []), doc]);
    groups.set(group, topics);
    categories.set(category, groups);
  }
  return (
    <>
      {[...categories.entries()].map(([category, groups]) => (
        <section key={category} className="flex flex-col gap-3">
          <h2 className="flex items-baseline gap-2 px-1 font-medium text-sm">
            {category === "" ? gt("Unorganized") : category}
            <span className="font-normal text-muted-foreground text-xs tabular-nums">
              {[...groups.values()].reduce(
                (sum, topics) =>
                  sum + [...topics.values()].reduce((count, docs) => count + docs.length, 0),
                0,
              )}
            </span>
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            {[...groups.entries()].map(([group, topics]) => {
              const entries = [...topics.entries()].map(([key, docs]) => ({
                key,
                docs: docs.toSorted((left, right) => right.date.localeCompare(left.date)),
              }));
              return (
                <GroupCard
                  key={group}
                  title={group === "" ? (category === "" ? gt("New files") : category) : group}
                  entries={entries}
                  count={entries.reduce((count, entry) => count + entry.docs.length, 0)}
                  onOpen={props.onOpen}
                />
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}
