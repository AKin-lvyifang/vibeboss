import * as Schema from "effect/Schema";
import { useSyncExternalStore } from "react";

import { useLocalStorage } from "./hooks/useLocalStorage";

const SPLIT_KEY = "vibeboss:split-by-project";
const SECTIONS_KEY = "vibeboss:project-sections";
const ASSIGNMENTS_KEY = "vibeboss:thread-sections";
const COLLAPSED_KEY = "vibeboss:collapsed-sections";

const CustomSection = Schema.Struct({ id: Schema.String, name: Schema.String });
export type CustomSection = typeof CustomSection.Type;

/** Sections the user made inside a project; shown only in the split view. */
const SectionsByProject = Schema.Record(Schema.String, Schema.Array(CustomSection));
/** Thread key → section id. A thread without one stays in Active. */
const SectionByThread = Schema.Record(Schema.String, Schema.String);
const CollapsedSections = Schema.Record(Schema.String, Schema.Boolean);

const NO_SECTIONS: typeof SectionsByProject.Type = {};
const NO_ASSIGNMENTS: typeof SectionByThread.Type = {};
const NO_COLLAPSED: typeof CollapsedSections.Type = {};

export function useSplitByProject() {
  return useLocalStorage(SPLIT_KEY, false, Schema.Boolean);
}

export function useProjectSections() {
  return useLocalStorage(SECTIONS_KEY, NO_SECTIONS, SectionsByProject);
}

export function useThreadSections() {
  return useLocalStorage(ASSIGNMENTS_KEY, NO_ASSIGNMENTS, SectionByThread);
}

export function useCollapsedSections() {
  return useLocalStorage(COLLAPSED_KEY, NO_COLLAPSED, CollapsedSections);
}

// The layout owns the second column; the sidebar renders the project's threads into it.
let splitColumnElement: HTMLElement | null = null;
const splitColumnListeners = new Set<() => void>();

export function setSplitColumnElement(element: HTMLElement | null) {
  if (splitColumnElement === element) return;
  splitColumnElement = element;
  for (const listener of splitColumnListeners) listener();
}

function subscribeSplitColumn(listener: () => void) {
  splitColumnListeners.add(listener);
  return () => {
    splitColumnListeners.delete(listener);
  };
}

export function useSplitColumnElement() {
  return useSyncExternalStore(
    subscribeSplitColumn,
    () => splitColumnElement,
    () => null,
  );
}
