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

/** Labs rows VibeBoss has no use for (all off by default); hidden from the page and search. */
export const VIBEBOSS_HIDDEN_SETTING_ROWS: ReadonlySet<string> = new Set([
  "guest-links",
  "simlock-hosts",
  "agent-feedback",
]);

/** T3's anonymous usage analytics report to T3's servers; VibeBoss turns them off and hides the notices. */
export const VIBEBOSS_T3_TELEMETRY = false;
