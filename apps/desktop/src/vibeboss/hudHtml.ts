// The HUD is always black so it reads as part of the notch in both light and dark mode.
const HUD_CSS = `
* { box-sizing: border-box; }
html, body { margin: 0; background: transparent; overflow: hidden; -webkit-user-select: none; user-select: none; cursor: default; }
body { font: 13px/1.5 -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; color: #fff; -webkit-font-smoothing: antialiased; }
button { font: inherit; color: inherit; border: 0; background: none; padding: 0; }
#hud { --muted: rgb(255 255 255 / 58%); --line: rgb(255 255 255 / 11%); --hover: rgb(255 255 255 / 8%); --warn: #fe9a00; --ok: #2fd69b; --err: #ff6467; --pri: #7aa2ff; position: absolute; top: 0; left: 50%; width: 0; }
.warn { color: var(--warn); } .ok { color: var(--ok); } .err { color: var(--err); } .dim, .agent { color: var(--muted); }

.blob { position: absolute; top: 0; background: #000; overflow: hidden; }
.stage { position: absolute; top: 0; left: 0; width: 0; }
.ear { position: absolute; top: 0; height: var(--bar); display: flex; align-items: center; gap: 6px; padding: 0 12px; font-size: 12px; white-space: nowrap; }
.ear:empty { display: none; }
/* The face sits low in the avatar, so the text drops a little to meet it. */
.ear > :not(.avatar) { position: relative; top: 2px; }
.ear b { font-weight: 500; }
.avatar { position: relative; top: -1px; width: 22px; height: 22px; border-radius: 22%; }
.avatar.circle { border-radius: 50%; }
.avatar.nod { animation: nod 1.8s ease-in-out 3; transform-origin: 50% 90%; }
@keyframes nod { 0%, 60%, 100% { transform: rotate(0); } 70% { transform: rotate(-12deg); } 85% { transform: rotate(10deg); } }

.panel { position: absolute; top: var(--bar); left: calc(var(--panel) / -2); width: var(--panel); padding: 2px 8px 8px; max-height: 560px; overflow-y: auto; transform-origin: 50% 0; }
/* The growing shape reveals the content; the fade only softens the swap between views. */
.enter { animation: arrive 0.22s ease-out both; }
.leave { animation: depart 0.18s ease-in both; pointer-events: none; }
@keyframes arrive { from { opacity: 0; } }
@keyframes depart { to { opacity: 0; } }
.tabs { padding: 6px 8px 0; }
.seg { display: inline-flex; background: var(--line); border-radius: 14px; padding: 2px; }
.seg button { padding: 2px 14px; border-radius: 12px; color: var(--muted); }
.seg button.on { background: rgb(255 255 255 / 18%); color: #fff; }
.group { display: flex; align-items: center; justify-content: space-between; padding: 8px 8px 2px; color: var(--muted); }
.account { display: inline-flex; align-items: center; gap: 8px; color: #fff; font-weight: 500; }
.row { display: flex; align-items: center; gap: 10px; padding: 7px 8px; border-radius: 10px; }
.row:not(.static):hover { background: var(--hover); }
.row.wrap { flex-wrap: wrap; }
.row.child { padding: 3px 8px 3px 34px; }
.grow { flex: 1; min-width: 0; }
.line, .sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.title { font-weight: 500; }
.sub, .agent { font-size: 12px; }
.sub { color: var(--muted); }
.spread { display: flex; justify-content: space-between; gap: 12px; }
code { font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; padding: 1px 5px; border-radius: 4px; background: rgb(255 255 255 / 14%); color: #fff; }
.options { display: flex; gap: 6px; margin-left: 26px; }
.pill { display: inline-flex; align-items: center; height: 26px; padding: 0 10px; border-radius: 13px; background: var(--line); font-size: 12px; font-weight: 500; white-space: nowrap; flex: none; }
.pill:hover { background: rgb(255 255 255 / 20%); }
.pill.primary { background: #fff; color: #000; }
.pill.primary:hover { background: #e4e4e7; }
.bar { height: 3px; border-radius: 2px; background: var(--line); overflow: hidden; margin-top: 5px; }
.bar i { display: block; height: 100%; background: var(--pri); }
.bar i.low { background: var(--warn); }
.icon { display: inline-flex; flex: none; width: 16px; height: 16px; }
.icon svg, .icon img { width: 16px; height: 16px; }
@media (prefers-reduced-motion: reduce) { .avatar.nod, .enter, .leave { animation: none; } }
`;

export const HUD_HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<title>VibeBoss</title><style>${HUD_CSS}</style></head><body><div id="hud"></div></body></html>`;
