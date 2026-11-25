import type { VibeBossRuleReview, VibeBossRuleSuggestion } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { XIcon } from "lucide-react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

/** Findings of the Rules page's check; each one is accepted into the draft or dismissed. */
export function RuleReviewPanel(props: {
  readonly review: VibeBossRuleReview;
  readonly modelReviewing: boolean;
  readonly handled: ReadonlySet<string>;
  readonly labelOf: (target: string) => string;
  readonly onAccept: (suggestions: ReadonlyArray<VibeBossRuleSuggestion>) => void;
  readonly onDismiss: (id: string) => void;
  readonly onClose: () => void;
}) {
  const gt = useGT();
  const open = props.review.suggestions.filter((item) => !props.handled.has(item.id));
  const kindLabel: Record<VibeBossRuleSuggestion["kind"], string> = {
    cli: gt("Calls an agent from the command line"),
    duplicate: gt("Repeats a shared rule"),
    shared: gt("Several agents repeat it"),
    conflict: gt("Conflicts with another rule"),
    outdated: gt("Out of date"),
    other: gt("Other", { $context: "kind of rules-check finding" }),
  };
  const change = (item: VibeBossRuleSuggestion) =>
    item.kind === "shared"
      ? gt("Move into the shared rules")
      : item.replacement === null
        ? gt("Remove this line")
        : gt("Change to: {line}", { line: item.replacement });

  return (
    <section className="overflow-hidden rounded-xl border">
      <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2">
        <span className="flex-1 text-sm font-medium">
          {gt("{count} findings", { count: open.length })}
        </span>
        {open.length > 0 ? (
          <Button size="sm" variant="ghost" onClick={() => props.onAccept(open)}>
            <T>Accept all</T>
          </Button>
        ) : null}
        <Button size="icon-sm" variant="ghost" aria-label={gt("Close")} onClick={props.onClose}>
          <XIcon />
        </Button>
      </div>
      {props.modelReviewing ? (
        <p className="border-b px-4 py-2 text-muted-foreground text-xs">
          <T>The small model is still checking; its findings will be added here.</T>
        </p>
      ) : null}
      {props.review.modelError ? (
        <p className="border-b px-4 py-2 text-muted-foreground text-xs">
          {props.review.modelError}
        </p>
      ) : null}
      {open.length === 0 && !props.modelReviewing ? (
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
              <span className="text-muted-foreground text-xs">
                {item.kind === "shared"
                  ? item.removals.map((removal) => props.labelOf(removal.target)).join("、")
                  : props.labelOf(item.target)}
              </span>
              {item.source === "model" ? (
                <span className="text-muted-foreground text-xs">
                  <T>Found by the small model</T>
                </span>
              ) : null}
              <span className="flex-1" />
              <Button size="sm" variant="ghost" onClick={() => props.onAccept([item])}>
                <T>Accept</T>
              </Button>
              <Button size="sm" variant="ghost" onClick={() => props.onDismiss(item.id)}>
                <T>Dismiss</T>
              </Button>
            </div>
            <p className="font-mono text-xs leading-5">{item.line}</p>
            <p className="text-muted-foreground text-xs">
              {item.reason} {change(item)}
            </p>
          </div>
        ))
      )}
    </section>
  );
}
