import { isReasoningSelect } from "@t3tools/client-runtime/model-traits";
import type { ServerProvider, ServerProviderModel } from "@t3tools/contracts";
import { resolveSelectableModel } from "@t3tools/shared/model";
import { useGT } from "gt-react";
import { PencilIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

// Base UI treats an empty string as a real value; this one means "let the agent pick".
const DEFAULT = "__default";

/** The model a member points at: stored as a slug, but older configs hold display names. */
export function memberModel(
  provider: ServerProvider | undefined,
  value: string,
): ServerProviderModel | undefined {
  if (provider === undefined) return undefined;
  const slug = resolveSelectableModel(provider.driver, value, provider.models);
  return provider.models.find((model) => model.slug === slug);
}

/** The model's own effort levels, the same ones the chat's traits picker shows. */
export function effortLevels(model: ServerProviderModel | undefined) {
  return model?.capabilities?.optionDescriptors?.find(isReasoningSelect)?.options ?? [];
}

function SimpleSelect(props: {
  label: string;
  value: string;
  display: string;
  options: ReadonlyArray<{ id: string; label: string }>;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const gt = useGT();
  return (
    <Select
      value={props.value === "" ? DEFAULT : props.value}
      disabled={props.disabled ?? false}
      onValueChange={(next) => {
        if (typeof next === "string") props.onChange(next === DEFAULT ? "" : next);
      }}
    >
      <SelectTrigger size="sm" aria-label={props.label} className="w-full min-w-0">
        <SelectValue>{() => <span className="truncate">{props.display}</span>}</SelectValue>
      </SelectTrigger>
      <SelectPopup>
        <SelectItem value={DEFAULT}>
          <span className="text-muted-foreground">{gt("Default")}</span>
        </SelectItem>
        {props.options.map((option) => (
          <SelectItem key={option.id} value={option.id}>
            {option.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

export function ModelSelect(props: {
  provider: ServerProvider | undefined;
  value: string;
  onChange: (slug: string) => void;
}) {
  const gt = useGT();
  const model = memberModel(props.provider, props.value);
  const options = (props.provider?.models ?? [])
    .filter((item) => !item.isLegacy || item.slug === model?.slug)
    .map((item) => ({ id: item.slug, label: item.name }));
  return (
    <SimpleSelect
      label={gt("Model")}
      value={model?.slug ?? ""}
      display={model?.name ?? (props.value === "" ? gt("Default") : props.value)}
      options={options}
      onChange={props.onChange}
    />
  );
}

export function EffortSelect(props: {
  model: ServerProviderModel | undefined;
  value: string;
  onChange: (effort: string) => void;
}) {
  const gt = useGT();
  // Our "Default" already means the agent's own default level; don't list it twice.
  const levels = effortLevels(props.model).filter(
    (option) => option.id.toLowerCase() !== "default",
  );
  const typed = props.value.toLowerCase();
  const level = levels.find(
    (option) => option.id.toLowerCase() === typed || option.label.toLowerCase() === typed,
  );
  return (
    <SimpleSelect
      label={gt("Effort", { $context: "reasoning effort level of a model" })}
      value={level?.id ?? ""}
      display={level?.label ?? (props.value === "" ? gt("Default") : props.value)}
      options={levels}
      disabled={levels.length === 0}
      onChange={props.onChange}
    />
  );
}

/** Reads as plain text; the pencil turns it into a field. */
export function NoteField(props: { value: string; onChange: (note: string) => void }) {
  const gt = useGT();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(props.value);

  if (editing) {
    const commit = () => {
      setEditing(false);
      if (text !== props.value) props.onChange(text);
    };
    return (
      <Input
        size="sm"
        autoFocus
        aria-label={gt("Note")}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          if (event.key === "Escape") {
            setText(props.value);
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <div className="group/note flex min-w-0 items-center gap-1">
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{props.value}</span>
      <Button
        size="icon-xs"
        variant="ghost-muted"
        aria-label={gt("Edit note")}
        onClick={() => {
          setText(props.value);
          setEditing(true);
        }}
      >
        <PencilIcon />
      </Button>
    </div>
  );
}
