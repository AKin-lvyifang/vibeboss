// @effect-diagnostics globalTimers:off -- A sandboxed preload has no Effect runtime.
// The HUD page has no script of its own (its CSP forbids any), so this sandboxed preload draws it.
import type { VibeBossHudAction, VibeBossHudRow, VibeBossHudSnapshot } from "@t3tools/contracts";
import { ipcRenderer } from "electron";

import { VIBEBOSS_HUD_WINDOW_CHANNEL } from "./ipc/channels.ts";
import { HUD_ICONS, HUD_PROVIDER_ICONS } from "./vibeboss/hudIcons.ts";

interface HudLayout {
  readonly notchWidth: number;
  readonly barHeight: number;
}
interface HudState {
  readonly snapshot: VibeBossHudSnapshot;
  readonly layout: HudLayout;
}

const PEEK_MS = 6_000;
// Just long enough to cross the gap between the bar and a row without the panel blinking.
const CLOSE_DELAY_MS = 40;
const MAX_INLINE_OPTIONS = 3;

let state: HudState | null = null;
let open = false;
let tab: "threads" | "usage" = "threads";
let peekKey: string | null = null;
let peekTimer: ReturnType<typeof setTimeout> | undefined;
let closeTimer: ReturnType<typeof setTimeout> | undefined;
let knownDone: ReadonlySet<string> | null = null;
let mouseInside = false;

const send = (message: unknown) => ipcRenderer.send(VIBEBOSS_HUD_WINDOW_CHANNEL, message);
const act = (action: VibeBossHudAction) => send({ kind: "action", action });

type Child = Node | string | null | undefined | false;
function h(tag: string, className: string, ...children: ReadonlyArray<Child>) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  for (const child of children) if (child) element.append(child);
  return element;
}
// Only ever called with the constant markup from hudIcons.ts.
function icon(markup: string, className: string) {
  const element = h("span", `icon ${className}`);
  element.innerHTML = markup;
  return element;
}
function button(label: string, className: string, onClick: () => void) {
  const element = h("button", className, label);
  element.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return element;
}

function avatar(snapshot: VibeBossHudSnapshot, nod: boolean) {
  if (!snapshot.avatar) return null;
  const image = h("img", `avatar ${snapshot.avatarShape}${nod ? " nod" : ""}`) as HTMLImageElement;
  image.src = snapshot.avatar;
  image.alt = "";
  return image;
}

function openThread(row: VibeBossHudRow) {
  act({ type: "open", environmentId: row.environmentId, threadId: row.threadId });
  open = false;
  if (peekKey === row.key) peekKey = null;
  render();
}

function rowElement(row: VibeBossHudRow, kind: string, snapshot: VibeBossHudSnapshot) {
  const { labels } = snapshot;
  const ref = { environmentId: row.environmentId, threadId: row.threadId };
  const lead =
    kind === "attention"
      ? icon(row.question ? HUD_ICONS.question : HUD_ICONS.hand, "warn")
      : kind === "error"
        ? icon(HUD_ICONS.alert, "err")
        : kind === "working"
          ? icon(HUD_ICONS.working, "dim")
          : icon(HUD_ICONS.done, "ok");
  const sub = h("div", "sub", row.question && row.detail ? labels.asks : null, row.detail);
  if (row.code) sub.append(" ", h("code", "", row.code));
  const body = h(
    "div",
    "grow",
    h("div", "line", h("span", "title", row.title), " ", h("span", "agent", row.agent)),
    row.detail || row.code ? sub : null,
  );
  if (row.progress && row.progress.total > 0) {
    const fill = h("i", "");
    fill.style.width = `${Math.min(100, (row.progress.done / row.progress.total) * 100)}%`;
    body.append(h("div", "bar", fill));
  }
  const element = h("div", "row", lead, body);
  element.addEventListener("click", () => openThread(row));
  const { approvalRequestId, question } = row;
  if (approvalRequestId) {
    element.append(
      button(labels.decline, "pill", () =>
        act({ type: "decline", ...ref, requestId: approvalRequestId }),
      ),
      button(labels.approve, "pill primary", () =>
        act({ type: "approve", ...ref, requestId: approvalRequestId }),
      ),
    );
  } else if (
    question &&
    question.options.length > 0 &&
    question.options.length <= MAX_INLINE_OPTIONS
  ) {
    element.classList.add("wrap");
    element.append(
      h(
        "span",
        "options",
        ...question.options.map((option, index) =>
          button(option.label, index === 0 ? "pill primary" : "pill", () =>
            act({
              type: "answer",
              ...ref,
              requestId: question.requestId,
              questionId: question.questionId,
              value: option.value,
            }),
          ),
        ),
      ),
    );
  }
  const fragment = document.createDocumentFragment();
  fragment.append(element);
  for (const child of row.children ?? []) {
    const childRow = h(
      "div",
      "row child",
      icon(HUD_ICONS.child, "dim"),
      h("div", "grow line", h("span", "", child.title), " ", h("span", "agent", child.detail)),
    );
    childRow.addEventListener("click", () => openThread(row));
    fragment.append(childRow);
  }
  return fragment;
}

function threadsPanel(snapshot: VibeBossHudSnapshot) {
  const fragment = document.createDocumentFragment();
  for (const group of snapshot.groups) {
    if (group.rows.length === 0) continue;
    fragment.append(
      h(
        "div",
        "group",
        group.label,
        group.kind === "done"
          ? button(snapshot.labels.clear, "pill", () => act({ type: "clear-done" }))
          : null,
      ),
      ...group.rows.map((row) => rowElement(row, group.kind, snapshot)),
    );
  }
  if (!fragment.hasChildNodes()) fragment.append(h("div", "group", snapshot.labels.idle));
  return fragment;
}

function usagePanel(snapshot: VibeBossHudSnapshot) {
  const fragment = document.createDocumentFragment();
  for (const account of snapshot.usage) {
    const mark = HUD_PROVIDER_ICONS[account.driver];
    fragment.append(
      h(
        "div",
        "group",
        h("span", "account", mark ? icon(mark, "") : null, account.name),
        h("span", "agent", account.plan),
      ),
    );
    for (const window of account.windows) {
      const low = window.remainingPercent <= 10;
      const fill = h("i", low ? "low" : "");
      fill.style.width = `${Math.max(0, Math.min(100, window.remainingPercent))}%`;
      fragment.append(
        h(
          "div",
          "row static",
          h(
            "div",
            "grow",
            h(
              "div",
              "spread",
              h("span", "", window.label),
              h(
                "span",
                low ? "warn" : "",
                window.remaining,
                window.resets ? h("span", "agent", ` · ${window.resets}`) : null,
              ),
            ),
            h("div", "bar", fill),
          ),
        ),
      );
    }
  }
  if (!fragment.hasChildNodes()) fragment.append(h("div", "group", snapshot.labels.noUsage));
  return fragment;
}

function tabs(snapshot: VibeBossHudSnapshot) {
  const tabButton = (id: typeof tab, label: string) =>
    button(label, tab === id ? "on" : "", () => {
      tab = id;
      if (id === "usage") act({ type: "refresh-usage" });
      render();
    });
  return h(
    "div",
    "tabs",
    h(
      "span",
      "seg",
      tabButton("threads", snapshot.labels.threads),
      tabButton("usage", snapshot.labels.usage),
    ),
  );
}

// One spring drives the whole shape, so a change of mind mid-motion carries its speed over
// instead of restarting. CSS transitions cannot do that, which is what made it look staged.
const stiffnessFor = (response: number) => ((2 * Math.PI) / response) ** 2;
// Opening is quick with a small bounce; closing is quicker still and does not bounce.
const GROW_STIFFNESS = stiffnessFor(0.34);
const SHRINK_STIFFNESS = stiffnessFor(0.26);
const BOUNCY_DAMPING = 0.72;
const SETTLED = 0.05;
const BAR_RADIUS = 13;
const PANEL_RADIUS = 20;
const PANEL_WIDTH = 480;
const LEAVE_MS = 200;

interface Shape {
  left: number;
  width: number;
  height: number;
  radius: number;
}
const SHAPE_KEYS = ["left", "width", "height", "radius"] as const;
const current: Shape = { left: 0, width: 0, height: 0, radius: BAR_RADIUS };
const velocity: Shape = { left: 0, width: 0, height: 0, radius: 0 };
let rest: Shape = { ...current };
let target: Shape = { ...current };
let bouncy = true;
let expanded = false;
let animationFrame = 0;
let lastTick = 0;
let lastMode = "";

function paint() {
  const blob = document.querySelector<HTMLElement>(".blob");
  const stage = document.querySelector<HTMLElement>(".stage");
  if (!blob || !stage) return;
  blob.style.left = `${current.left}px`;
  blob.style.width = `${Math.max(0, current.width)}px`;
  blob.style.height = `${Math.max(0, current.height)}px`;
  blob.style.borderRadius = `0 0 ${current.radius}px ${current.radius}px`;
  // The content stays put on screen while the shape around it moves and clips it.
  stage.style.left = `${-current.left}px`;
}

function tick(now: number) {
  // A late frame catches up in small steps, so a hiccup never turns into slow motion.
  const elapsed = Math.min(0.1, (now - lastTick) / 1000);
  const steps = Math.max(1, Math.ceil(elapsed / 0.008));
  lastTick = now;
  const stiffness = bouncy ? GROW_STIFFNESS : SHRINK_STIFFNESS;
  const damping = 2 * (bouncy ? BOUNCY_DAMPING : 1) * Math.sqrt(stiffness);
  let moving = false;
  for (const key of SHAPE_KEYS) {
    for (let step = 0; step < steps; step++) {
      const force = -stiffness * (current[key] - target[key]) - damping * velocity[key];
      velocity[key] += force * (elapsed / steps);
      current[key] += velocity[key] * (elapsed / steps);
    }
    if (Math.abs(velocity[key]) > SETTLED || Math.abs(current[key] - target[key]) > SETTLED) {
      moving = true;
    } else {
      current[key] = target[key];
      velocity[key] = 0;
    }
  }
  paint();
  // Stops at rest so an idle HUD repaints nothing.
  animationFrame = moving ? requestAnimationFrame(tick) : 0;
}

function aim() {
  bouncy = rest.width * rest.height >= target.width * target.height;
  target = { ...rest };
  if (animationFrame === 0) {
    lastTick = performance.now();
    animationFrame = requestAnimationFrame(tick);
  }
}

function render() {
  const root = document.getElementById("hud");
  if (!root || !state) return;
  const { snapshot, layout } = state;
  const notch = layout.notchWidth > 0;
  const peekRow =
    peekKey === null || !snapshot.enabled
      ? undefined
      : snapshot.groups
          .find((group) => group.kind === "done")
          ?.rows.find((row) => row.key === peekKey);
  let stage = root.querySelector<HTMLElement>(".stage");
  if (!stage) {
    stage = h("div", "stage");
    root.replaceChildren(h("div", "blob", stage));
  }
  root.style.setProperty("--bar", `${layout.barHeight}px`);
  root.style.setProperty("--panel", `${PANEL_WIDTH}px`);

  const showOpen = open && snapshot.enabled;
  const collapsed = showOpen || !snapshot.enabled ? null : snapshot.collapsed;
  const left = h("div", "ear");
  const right = h("div", "ear");
  if (peekRow && !showOpen) {
    left.append(avatar(snapshot, false) ?? "", h("b", "", peekRow.title));
    right.append(h("span", "ok", snapshot.labels.finished));
  } else if (collapsed) {
    const urgent = collapsed.tone === "attention" || collapsed.tone === "error";
    left.append(avatar(snapshot, urgent) ?? "");
    if (!snapshot.doNotDisturb) {
      const tone = collapsed.tone === "error" ? "err" : collapsed.tone === "working" ? "" : "warn";
      left.append(h("b", tone, collapsed.left));
      if (collapsed.right) right.append(h("span", "agent", collapsed.right));
    }
  }
  let panel: HTMLElement | null = null;
  if (showOpen) {
    panel = h("div", "panel", tabs(snapshot));
    panel.append(tab === "usage" ? usagePanel(snapshot) : threadsPanel(snapshot));
  } else if (peekRow) {
    panel = h("div", "panel", rowElement(peekRow, "done", snapshot));
  }
  // Snapshots arrive while the panel is open; only a change of view fades its content.
  const mode = showOpen ? tab : peekRow ? "peek" : "closed";
  const changed = mode !== lastMode;
  lastMode = mode;
  const leaving = changed
    ? [...stage.querySelectorAll<HTMLElement>(".panel:not(.leave)")].map((old) => {
        // The old panel fades while the shape closes over it, rather than vanishing first.
        old.classList.add("leave");
        setTimeout(() => old.remove(), LEAVE_MS);
        return old;
      })
    : [...stage.querySelectorAll<HTMLElement>(".panel.leave")];
  if (changed) for (const part of [left, right, panel]) part?.classList.add("enter");
  stage.replaceChildren(...leaving, left, right, ...(panel ? [panel] : []));

  const leftWidth = left.offsetWidth;
  const rightWidth = right.offsetWidth;
  // With a notch each side grows from the notch by its own content; without one they meet.
  const seam = notch ? layout.notchWidth / 2 : 0;
  const center = notch ? 0 : (leftWidth - rightWidth) / 2;
  left.style.right = `${seam - center}px`;
  right.style.left = `${seam + center}px`;
  const barWidth = leftWidth + rightWidth + layout.notchWidth;
  expanded = panel !== null;
  rest = panel
    ? {
        left: -PANEL_WIDTH / 2,
        width: PANEL_WIDTH,
        height: layout.barHeight + panel.offsetHeight,
        radius: PANEL_RADIUS,
      }
    : {
        left: center - seam - leftWidth,
        width: barWidth,
        height: barWidth > 0 && snapshot.enabled ? layout.barHeight : 0,
        radius: BAR_RADIUS,
      };
  paint();
  aim();
}

function receive(next: HudState) {
  const done = new Set(
    next.snapshot.groups
      .filter((group) => group.kind === "done")
      .flatMap((group) => group.rows)
      .map((row) => row.key),
  );
  // The first snapshot only records what was already finished; later arrivals peek.
  if (knownDone && !next.snapshot.doNotDisturb && !open) {
    const fresh = [...done].find((key) => !knownDone?.has(key));
    if (fresh) {
      peekKey = fresh;
      clearTimeout(peekTimer);
      peekTimer = setTimeout(() => {
        peekKey = null;
        render();
      }, PEEK_MS);
    }
  }
  knownDone = done;
  state = next;
  render();
}

function setMouseInside(inside: boolean) {
  if (inside === mouseInside) return;
  mouseInside = inside;
  // The window is click-through except while the pointer is over something we drew.
  send({ kind: "mouse", inside });
  clearTimeout(closeTimer);
  if (inside) {
    if (!open) {
      open = true;
      render();
    }
  } else {
    closeTimer = setTimeout(() => {
      open = false;
      render();
    }, CLOSE_DELAY_MS);
  }
}

window.addEventListener("DOMContentLoaded", () => {
  document.addEventListener("mousemove", (event) => {
    const x = event.clientX - window.innerWidth / 2;
    // Judged against the resting shape, so a bounce never flickers the hover.
    const margin = expanded ? 10 : 0;
    setMouseInside(
      rest.height > 0 &&
        x >= rest.left - margin &&
        x <= rest.left + rest.width + margin &&
        event.clientY <= rest.height + margin,
    );
  });
  document.addEventListener("mouseleave", () => setMouseInside(false));
  ipcRenderer.on(VIBEBOSS_HUD_WINDOW_CHANNEL, (_event, next: HudState) => receive(next));
  send({ kind: "ready" });
});
