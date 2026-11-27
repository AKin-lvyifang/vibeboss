// VibeBoss: an organizer run takes up to minutes, so its progress lives outside the Knowledge page
// and is still there when the user comes back to it.
import { create } from "zustand";

interface KnowledgePageState {
  readonly organizing: boolean;
  /** Why the last run left files unorganized; null when it left none. */
  readonly notice: string | null;
  /** The unorganized files the automatic run last tried, so a failed run is not repeated. */
  readonly attempted: string;
}

export const useKnowledgePageStore = create<KnowledgePageState>()(() => ({
  organizing: false,
  notice: null,
  attempted: "",
}));

export const setKnowledgePage = (next: Partial<KnowledgePageState>) =>
  useKnowledgePageStore.setState(next);
