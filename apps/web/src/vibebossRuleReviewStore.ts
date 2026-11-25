// VibeBoss: the Rules page's check and unsaved edits live outside the page, so leaving the page,
// reloading, or restarting keeps the findings and the accepted edits. A check still running is not
// kept across a reload; its answer would have nowhere to go.
import type { VibeBossConfig, VibeBossRuleReview } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

interface RulesPageState {
  readonly draft: VibeBossConfig | null;
  readonly review: VibeBossRuleReview | null;
  /** Ids of findings already applied or kept as is. */
  readonly handled: ReadonlyArray<string>;
  readonly applied: number;
  readonly checking: boolean;
  /** When the small model was asked; null once it answers. */
  readonly modelStartedAt: number | null;
  /** How long the small model took last time, to size the progress bar. */
  readonly lastModelMs: number | null;
}

export const useRulesPageStore = create<RulesPageState>()(
  persist(
    (): RulesPageState => ({
      draft: null,
      review: null,
      handled: [],
      applied: 0,
      checking: false,
      modelStartedAt: null,
      lastModelMs: null,
    }),
    {
      name: "vibeboss:rules-page:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: ({ draft, review, handled, applied, lastModelMs }) => ({
        draft,
        review,
        handled,
        applied,
        lastModelMs,
      }),
    },
  ),
);

export const setRulesPage = (next: Partial<RulesPageState>) => useRulesPageStore.setState(next);
