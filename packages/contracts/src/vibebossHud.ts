import * as Schema from "effect/Schema";

/**
 * The macOS menu-bar HUD is a tiny window with no app state of its own. The main renderer owns
 * every thread and usage atom, so it sends this ready-to-draw, already translated snapshot and
 * the HUD sends back the few actions a row offers.
 */
const HudText = Schema.String.check(Schema.isMaxLength(400));

export const VibeBossHudRow = Schema.Struct({
  key: HudText,
  environmentId: HudText,
  threadId: HudText,
  title: HudText,
  /** Provider display name, e.g. Claude. */
  agent: HudText,
  detail: Schema.optional(HudText),
  /** The command or file an approval is about, shown verbatim. */
  code: Schema.optional(HudText),
  progress: Schema.optional(Schema.Struct({ done: Schema.Number, total: Schema.Number })),
  children: Schema.optional(Schema.Array(Schema.Struct({ title: HudText, detail: HudText }))),
  approvalRequestId: Schema.optional(HudText),
  question: Schema.optional(
    Schema.Struct({
      requestId: HudText,
      questionId: HudText,
      options: Schema.Array(Schema.Struct({ label: HudText, value: HudText })),
    }),
  ),
});
export type VibeBossHudRow = typeof VibeBossHudRow.Type;

export const VibeBossHudGroupKind = Schema.Literals(["attention", "error", "working", "done"]);
export type VibeBossHudGroupKind = typeof VibeBossHudGroupKind.Type;

export const VibeBossHudSnapshot = Schema.Struct({
  enabled: Schema.Boolean,
  doNotDisturb: Schema.Boolean,
  /** A small square PNG data URL already cropped by the renderer. */
  avatar: Schema.NullOr(Schema.String.check(Schema.isMaxLength(200_000))),
  avatarShape: Schema.Literals(["square", "circle"]),
  /** What the closed bar says; `null` leaves only the notch. */
  collapsed: Schema.NullOr(
    Schema.Struct({
      tone: Schema.Literals(["attention", "error", "warning", "working"]),
      left: HudText,
      right: HudText,
    }),
  ),
  groups: Schema.Array(
    Schema.Struct({
      kind: VibeBossHudGroupKind,
      label: HudText,
      rows: Schema.Array(VibeBossHudRow),
    }),
  ),
  usage: Schema.Array(
    Schema.Struct({
      key: HudText,
      driver: HudText,
      name: HudText,
      plan: HudText,
      windows: Schema.Array(
        Schema.Struct({
          label: HudText,
          remainingPercent: Schema.Number,
          /** Already worded, e.g. "38% left". */
          remaining: HudText,
          resets: HudText,
        }),
      ),
    }),
  ),
  labels: Schema.Struct({
    threads: HudText,
    usage: HudText,
    approve: HudText,
    decline: HudText,
    clear: HudText,
    idle: HudText,
    finished: HudText,
    asks: HudText,
    noUsage: HudText,
  }),
});
export type VibeBossHudSnapshot = typeof VibeBossHudSnapshot.Type;

export const VibeBossHudAction = Schema.Struct({
  type: Schema.Literals(["approve", "decline", "answer", "open", "clear-done", "refresh-usage"]),
  environmentId: Schema.optional(HudText),
  threadId: Schema.optional(HudText),
  requestId: Schema.optional(HudText),
  questionId: Schema.optional(HudText),
  value: Schema.optional(HudText),
});
export type VibeBossHudAction = typeof VibeBossHudAction.Type;
