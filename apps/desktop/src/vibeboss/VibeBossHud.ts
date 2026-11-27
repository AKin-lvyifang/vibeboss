import { VibeBossHudAction, VibeBossHudSnapshot } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Electron from "electron";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronApp from "../electron/ElectronApp.ts";
import {
  VIBEBOSS_HUD_ACTION_CHANNEL,
  VIBEBOSS_HUD_SNAPSHOT_CHANNEL,
  VIBEBOSS_HUD_WINDOW_CHANNEL,
} from "../ipc/channels.ts";
import * as DesktopIpc from "../ipc/DesktopIpc.ts";
import { HUD_HTML } from "./hudHtml.ts";

const WINDOW_WIDTH = 560;
const WINDOW_HEIGHT = 640;
// Electron reports no notch geometry. Built-in displays with a notch have a taller menu bar, and
// every notch so far is about this wide in points.
const NOTCH_MENU_BAR_MIN_HEIGHT = 30;
const NOTCH_WIDTH = 184;
const PLAIN_BAR_HEIGHT = 26;

const isHudAction = Schema.is(VibeBossHudAction);

function hudLayout(display: Electron.Display) {
  const menuBarHeight = display.workArea.y - display.bounds.y;
  const notch = display.internal && menuBarHeight >= NOTCH_MENU_BAR_MIN_HEIGHT;
  return {
    notchWidth: notch ? NOTCH_WIDTH : 0,
    barHeight: notch ? menuBarHeight : PLAIN_BAR_HEIGHT,
  };
}

function hudBounds(display: Electron.Display) {
  return {
    x: Math.round(display.bounds.x + (display.bounds.width - WINDOW_WIDTH) / 2),
    y: display.bounds.y,
    width: WINDOW_WIDTH,
    height: Math.min(WINDOW_HEIGHT, display.bounds.height),
  };
}

/** The always-on-top strip under the macOS notch. It draws whatever the main renderer sends. */
class HudWindow {
  private window: Electron.BrowserWindow | undefined;
  private ready = false;
  private snapshot: VibeBossHudSnapshot | undefined;
  private owner: Electron.WebContents | undefined;

  private readonly preload: string;

  constructor(preload: string) {
    this.preload = preload;
  }

  update(snapshot: VibeBossHudSnapshot, owner: Electron.WebContents | undefined) {
    if (owner && owner !== this.owner) {
      this.owner = owner;
      // The snapshot belongs to this renderer; without it the HUD would show stale threads.
      owner.once("destroyed", () => {
        if (this.owner === owner) this.close();
      });
    }
    if (!snapshot.enabled) {
      this.close();
      return;
    }
    this.snapshot = snapshot;
    if (!this.window) this.open();
    else this.push();
  }

  close() {
    this.snapshot = undefined;
    this.ready = false;
    this.window?.destroy();
    this.window = undefined;
  }

  reposition() {
    if (!this.window || this.window.isDestroyed()) return;
    this.window.setBounds(hudBounds(Electron.screen.getPrimaryDisplay()), false);
    this.push();
  }

  onWindowMessage(event: Electron.IpcMainEvent, message: unknown) {
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame)
      return;
    if (typeof message !== "object" || message === null || !("kind" in message)) return;
    if (message.kind === "ready") {
      this.ready = true;
      this.push();
      window.showInactive();
    } else if (message.kind === "mouse" && "inside" in message) {
      window.setIgnoreMouseEvents(message.inside !== true, { forward: true });
    } else if (message.kind === "action" && "action" in message && isHudAction(message.action)) {
      if (this.owner && !this.owner.isDestroyed())
        this.owner.send(VIBEBOSS_HUD_ACTION_CHANNEL, message.action);
    }
  }

  private push() {
    if (!this.ready || !this.snapshot || !this.window || this.window.isDestroyed()) return;
    this.window.webContents.send(VIBEBOSS_HUD_WINDOW_CHANNEL, {
      snapshot: this.snapshot,
      layout: hudLayout(Electron.screen.getPrimaryDisplay()),
    });
  }

  private open() {
    const window = new Electron.BrowserWindow({
      ...hudBounds(Electron.screen.getPrimaryDisplay()),
      show: false,
      frame: false,
      transparent: true,
      roundedCorners: false,
      backgroundColor: "#00000000",
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      // Clicking a row must not pull keyboard focus away from the app the user is working in.
      focusable: false,
      acceptFirstMouse: true,
      skipTaskbar: true,
      webPreferences: {
        preload: this.preload,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
      },
    });
    this.window = window;
    // Only this level draws above the menu bar, which is where the notch is.
    window.setAlwaysOnTop(true, "screen-saver");
    window.setVisibleOnAllWorkspaces(true, { skipTransformProcessType: true });
    window.setIgnoreMouseEvents(true, { forward: true });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.once("closed", () => {
      if (this.window === window) {
        this.window = undefined;
        this.ready = false;
      }
    });
    void window
      .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(HUD_HTML)}`)
      .catch(() => {
        if (!window.isDestroyed()) window.destroy();
      });
  }
}

export const installVibeBossHud = Effect.fn("desktop.vibeboss.installHud")(function* () {
  const ipc = yield* DesktopIpc.DesktopIpc;
  const app = yield* ElectronApp.ElectronApp;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const platform = yield* HostProcess.Platform;
  const path = yield* Path.Path;
  const hud =
    platform === "darwin"
      ? new HudWindow(path.join(environment.dirname, "vibeboss-hud-preload.cjs"))
      : undefined;

  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: VIBEBOSS_HUD_SNAPSHOT_CHANNEL,
      payload: VibeBossHudSnapshot,
      result: Schema.Void,
      handler: (snapshot, event) =>
        Effect.sync(() => {
          const owner = event ? Electron.webContents.fromId(event.sender.id) : undefined;
          hud?.update(snapshot, owner);
        }),
    }),
  );
  if (!hud) return;

  const onWindowMessage = (event: Electron.IpcMainEvent, message: unknown) =>
    hud.onWindowMessage(event, message);
  const reposition = () => hud.reposition();
  Electron.ipcMain.on(VIBEBOSS_HUD_WINDOW_CHANNEL, onWindowMessage);
  Electron.screen.on("display-metrics-changed", reposition);
  Electron.screen.on("display-added", reposition);
  Electron.screen.on("display-removed", reposition);
  yield* app.on("before-quit", () => hud.close());
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      Electron.ipcMain.removeListener(VIBEBOSS_HUD_WINDOW_CHANNEL, onWindowMessage);
      Electron.screen.removeListener("display-metrics-changed", reposition);
      Electron.screen.removeListener("display-added", reposition);
      Electron.screen.removeListener("display-removed", reposition);
      hud.close();
    }),
  );
});
