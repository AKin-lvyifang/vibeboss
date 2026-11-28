import type { VibeBossRuleReview, VibeBossRuleSuggestion } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { ArrowRightIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

/**
 * Findings of the Rules page's check. The main button names the edit it makes; edits land in the
 * page's draft and reach the agents' files only on sync.
 */
export function RuleReviewPanel(props: {
  readonly review: VibeBossRuleReview;
  readonly modelStartedAt: number | null;
  readonly lastModelMs: number | null;
  readonly handled: ReadonlySet<string>;
  readonly applied: number;
  readonly labelOf: (target: string) => string;
  readonly onAccept: (suggestions: ReadonlyArray<VibeBossRuleSuggestion>) => void;
  readonly onDismiss: (id: string) => void;
  readonly onClose: () => void;
}) {
  const gt = useGT();
  const modelReviewing = props.modelStartedAt !== null;
  const open = props.review.suggestions.filter((item) => !props.handled.has(item.id));
  const kindLabel: Record<VibeBossRuleSuggestion["kind"], string> = {
    cli: gt("Calls an agent from the command line"),
    duplicate: gt("Repeats personal memory"),
    shared: gt("Several agents repeat it"),
    conflict: gt("Conflicts with another rule"),
    outdated: gt("Out of date"),
    other: gt("Other", { $context: "kind of rules-check finding" }),
  };
  const action = (item: VibeBossRuleSuggestion) =>
    item.kind === "shared"
      ? gt("Move into personal memory")
      : item.replacement === null
        ? gt("Remove this line")
        : gt("Change it", { $context: "apply a suggested rewrite of a rule line" });
  const where = (item: VibeBossRuleSuggestion) =>
    item.kind === "shared"
      ? gt("{agents} → Personal memory", {
          agents: item.removals.map((removal) => props.labelOf(removal.target)).join("、"),
        })
      : props.labelOf(item.target);

  return (
    <section className="overflow-hidden rounded-xl border">
      <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2">
        <span className="flex-1 text-sm font-medium">
          {gt("{count} findings", { count: open.length })}
        </span>
        {open.length > 0 ? (
          <Button size="sm" variant="ghost" onClick={() => props.onAccept(open)}>
            <T>Apply all</T>
          </Button>
        ) : null}
        <Button size="icon-sm" variant="ghost" aria-label={gt("Close")} onClick={props.onClose}>
          <XIcon />
        </Button>
      </div>
      {props.applied > 0 ? (
        <p className="border-b px-4 py-2 text-xs">
          <T>Applied to the rules below. They reach each agent's rule file when you sync.</T>
        </p>
      ) : null}
      {props.modelStartedAt !== null ? (
        <ModelProgress startedAt={props.modelStartedAt} expectedMs={props.lastModelMs} />
      ) : null}
      {props.review.modelError ? (
        <p className="border-b px-4 py-2 text-muted-foreground text-xs">
          {props.review.modelError}
        </p>
      ) : null}
      {open.length === 0 && !modelReviewing ? (
        <p className="px-4 py-6 text-center text-muted-foreground text-sm">
          <T>Nothing to fix</T>
        </p>
      ) : (
        open.map((item) => (
          <div key={item.id} className="flex flex-col gap-1.5 border-b px-4 py-3 last:border-b-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant={item.kind === "cli" || item.kind === "conflict" ? "warning" : "outline"}
              >
                {kindLabel[item.kind]}
              </Badge>
              <span className="text-muted-foreground text-xs">{where(item)}</span>
              <span className="flex-1" />
              <Button size="sm" variant="outline" onClick={() => props.onAccept([item])}>
                {action(item)}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => props.onDismiss(item.id)}>
                <T>Keep as is</T>
              </Button>
            </div>
            <p
              className={
                item.kind !== "shared" && item.replacement === null
                  ? "font-mono text-xs leading-5 line-through decoration-muted-foreground"
                  : "font-mono text-xs leading-5"
              }
            >
              {item.line}
            </p>
            {item.kind !== "shared" && item.replacement !== null ? (
              <p className="flex gap-1.5 font-mono text-xs leading-5">
                <ArrowRightIcon className="mt-1 size-3 shrink-0 text-muted-foreground" />
                <span>{item.replacement}</span>
              </p>
            ) : null}
            <p className="text-muted-foreground text-xs">{item.reason}</p>
          </div>
        ))
      )}
    </section>
  );
}

/** The model reports no progress, so the bar fills against how long the last check took. */
function ModelProgress(props: { readonly startedAt: number; readonly expectedMs: number | null }) {
  const gt = useGT();
  const [now, setNow] = useState(() => Date.now());
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a once-a-second clock for the elapsed time
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const elapsed = Math.max(0, now - props.startedAt);
  const seconds = Math.round(elapsed / 1000);
  const share = Math.min(0.95, elapsed / (props.expectedMs ?? 60_000));
  return (
    <div className="flex flex-col gap-1.5 border-b px-4 py-2.5">
      <div className="h-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-1000 ease-linear"
          style={{ width: `${Math.round(share * 100)}%` }}
        />
      </div>
      <p className="text-muted-foreground text-xs">
        {gt("The small model is still checking ({seconds}s); its findings will be added here.", {
          seconds,
        })}
      </p>
    </div>
  );
}
