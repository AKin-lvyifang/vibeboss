import * as Schema from "effect/Schema";

import { useLocalStorage } from "./hooks/useLocalStorage";

// index.html reads this key before the app loads, so keep the name and JSON encoding in sync.
const SPLASH_IMAGE_KEY = "vibeboss:splash-image";
const MASCOT_SIDE_KEY = "vibeboss:mascot-side";
const MASCOT_LIFT_KEY = "vibeboss:mascot-lift";

/** localStorage holds a few MB per site; a data URL is about a third larger than the file. */
export const SPLASH_IMAGE_MAX_BYTES = 2 * 1024 * 1024;

export const MASCOT_LIFT_MIN = 0;
export const MASCOT_LIFT_MAX = 48;
export const DEFAULT_MASCOT_LIFT = 32;

const MascotSide = Schema.Literals(["left", "right"]);
const SplashImage = Schema.NullOr(Schema.String);
export type MascotSide = typeof MascotSide.Type;

export function useSplashImage() {
  return useLocalStorage(SPLASH_IMAGE_KEY, null, SplashImage);
}

export function useMascotSide() {
  return useLocalStorage<MascotSide, MascotSide>(MASCOT_SIDE_KEY, "right", MascotSide);
}

/** How far the sidebar mascot is pulled up, in pixels; higher shows more face, less hair. */
export function useMascotLift() {
  return useLocalStorage(MASCOT_LIFT_KEY, DEFAULT_MASCOT_LIFT, Schema.Number);
}
