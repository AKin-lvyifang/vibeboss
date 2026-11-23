// VibeBoss product choices layered on top of T3 Code. Keep fork-specific switches here so
// upstream merges touch as few files as possible.

/** Settings pages aimed at developers; VibeBoss hides them from navigation and search. */
export const VIBEBOSS_HIDDEN_SETTINGS: ReadonlySet<string> = new Set([
  "/settings/keybindings",
  "/settings/snap-shot",
  "/settings/devices",
  "/settings/secrets",
  "/settings/maintenance",
]);
