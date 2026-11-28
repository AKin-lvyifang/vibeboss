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

/** Setting rows VibeBoss has no use for (switches all off by default); hidden from the page and search. */
export const VIBEBOSS_HIDDEN_SETTING_ROWS: ReadonlySet<string> = new Set([
  "guest-links",
  "simlock-hosts",
  "agent-feedback",
  "mobile-app",
  "workflows-beta",
  "workflow-skipped-runs",
]);

/** T3's anonymous usage analytics report to T3's servers; VibeBoss turns them off and hides the notices. */
export const VIBEBOSS_T3_TELEMETRY = false;

/**
 * The sidebar update button only covers VibeBoss itself. Agent CLIs update from their own rows in
 * Settings > Providers, so the sidebar neither checks nor prompts for them.
 */
export const VIBEBOSS_SIDEBAR_APP_UPDATES_ONLY = true;
