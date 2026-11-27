import type { VibeBossKnowledgeDoc } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { useState } from "react";

import { cn } from "../../lib/utils";

const WEEKS = 26;
const DAY_MS = 24 * 60 * 60 * 1000;
const LEVEL_CLASS = [
  "bg-accent",
  "bg-primary/30",
  "bg-primary/55",
  "bg-primary/80",
  "bg-primary",
] as const;

function dayKey(time: number): string {
  const date = new Date(time);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function level(count: number): number {
  return count === 0 ? 0 : count === 1 ? 1 : count === 2 ? 2 : count <= 4 ? 3 : 4;
}

function Stat(props: { readonly label: string; readonly value: number }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-muted-foreground text-sm">{props.label}</dt>
      <dd className="font-semibold text-3xl text-foreground tabular-nums">{props.value}</dd>
    </div>
  );
}

/** How much the folder holds and how often it changes, one square per day. */
export function KnowledgeOverview(props: { readonly docs: ReadonlyArray<VibeBossKnowledgeDoc> }) {
  const gt = useGT();
  // The grid ends on the day the page was opened; a page left open overnight keeps that day.
  const [now] = useState(() => Date.now());
  const counts = new Map<string, number>();
  let thisWeek = 0;
  for (const doc of props.docs) {
    const time = Date.parse(doc.modifiedAt);
    if (Number.isNaN(time)) continue;
    counts.set(dayKey(time), (counts.get(dayKey(time)) ?? 0) + 1);
    if (now - time < 7 * DAY_MS) thisWeek++;
  }
  const days = Array.from({ length: WEEKS * 7 }, (_, index) =>
    dayKey(now - (WEEKS * 7 - 1 - index) * DAY_MS),
  );

  return (
    <section className="flex flex-wrap items-end justify-between gap-x-12 gap-y-6">
      <dl className="flex gap-12">
        <Stat label={gt("Files")} value={props.docs.length} />
        <Stat label={gt("Updated this week")} value={thisWeek} />
        <Stat label={gt("Unorganized")} value={props.docs.filter((doc) => !doc.organized).length} />
      </dl>
      <div className="flex flex-col gap-1.5">
        <div
          role="img"
          aria-label={gt("Updates in the last 26 weeks")}
          className="grid grid-flow-col grid-rows-7 gap-0.75"
        >
          {days.map((key) => (
            <span
              key={key}
              className={cn("size-2.75 rounded-xs", LEVEL_CLASS[level(counts.get(key) ?? 0)])}
            />
          ))}
        </div>
        <div className="flex items-center gap-1 text-muted-foreground text-xs">
          <span className="flex-1">
            <T>Updates, last 26 weeks</T>
          </span>
          <T>Less</T>
          {LEVEL_CLASS.map((className) => (
            <span key={className} className={cn("size-2.75 rounded-xs", className)} />
          ))}
          <T>More</T>
        </div>
      </div>
    </section>
  );
}
