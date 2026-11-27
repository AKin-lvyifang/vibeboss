import * as Schema from "effect/Schema";

import { readLocalStorageValue, useLocalStorage } from "./hooks/useLocalStorage";

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

// The macOS menu-bar HUD. Its settings sit beside the mascot because the HUD shows the same image.
const HUD_ENABLED_KEY = "vibeboss:hud-enabled";
const HUD_DO_NOT_DISTURB_KEY = "vibeboss:hud-do-not-disturb";
const HUD_AVATAR_SHAPE_KEY = "vibeboss:hud-avatar-shape";
const HUD_AVATAR_CROP_KEY = "vibeboss:hud-avatar-crop";
export const HUD_STORAGE_KEYS = [
  SPLASH_IMAGE_KEY,
  HUD_ENABLED_KEY,
  HUD_DO_NOT_DISTURB_KEY,
  HUD_AVATAR_SHAPE_KEY,
  HUD_AVATAR_CROP_KEY,
] as const;

export const HudAvatarShape = Schema.Literals(["square", "circle"]);
export type HudAvatarShape = typeof HudAvatarShape.Type;

/** The square of the mascot image the HUD shows. `centerX` and `size` are fractions of the image width, `centerY` of its height. */
export const HudAvatarCrop = Schema.Struct({
  centerX: Schema.Number,
  centerY: Schema.Number,
  size: Schema.Number,
});
export type HudAvatarCrop = typeof HudAvatarCrop.Type;
const StoredHudAvatarCrop = Schema.NullOr(HudAvatarCrop);

// The splash figure without its white sticker outline, which would glow on the black HUD.
export const DEFAULT_HUD_IMAGE_URL = "/vibeboss-hud-figure.webp";
/** The face of the default figure. An uploaded image starts from a centered square instead. */
export const DEFAULT_HUD_AVATAR_CROP: HudAvatarCrop = { centerX: 0.5, centerY: 0.275, size: 0.84 };
export const UPLOADED_HUD_AVATAR_CROP: HudAvatarCrop = { centerX: 0.5, centerY: 0.5, size: 1 };
export const HUD_AVATAR_CROP_MIN_SIZE = 0.2;

/** Keeps the square inside an image whose height is `aspect` times its width. */
export function clampHudAvatarCrop(crop: HudAvatarCrop, aspect: number): HudAvatarCrop {
  const size = Math.max(HUD_AVATAR_CROP_MIN_SIZE, Math.min(crop.size, 1, aspect));
  const halfX = size / 2;
  const halfY = size / (2 * aspect);
  return {
    size,
    centerX: Math.max(halfX, Math.min(1 - halfX, crop.centerX)),
    centerY: Math.max(halfY, Math.min(1 - halfY, crop.centerY)),
  };
}

export function useHudEnabled() {
  return useLocalStorage(HUD_ENABLED_KEY, true, Schema.Boolean);
}

export function useHudDoNotDisturb() {
  return useLocalStorage(HUD_DO_NOT_DISTURB_KEY, false, Schema.Boolean);
}

export function useHudAvatarShape() {
  return useLocalStorage<HudAvatarShape, HudAvatarShape>(
    HUD_AVATAR_SHAPE_KEY,
    "square",
    HudAvatarShape,
  );
}

/** `null` until the user moves the square, so the default follows whichever image is in use. */
export function useHudAvatarCrop() {
  return useLocalStorage(HUD_AVATAR_CROP_KEY, null, StoredHudAvatarCrop);
}

export function readHudAppearance() {
  const splashImage = readLocalStorageValue(SPLASH_IMAGE_KEY, null, SplashImage);
  return {
    enabled: readLocalStorageValue(HUD_ENABLED_KEY, true, Schema.Boolean),
    doNotDisturb: readLocalStorageValue(HUD_DO_NOT_DISTURB_KEY, false, Schema.Boolean),
    shape: readLocalStorageValue<HudAvatarShape, HudAvatarShape>(
      HUD_AVATAR_SHAPE_KEY,
      "square",
      HudAvatarShape,
    ),
    image: splashImage ?? DEFAULT_HUD_IMAGE_URL,
    crop:
      readLocalStorageValue(HUD_AVATAR_CROP_KEY, null, StoredHudAvatarCrop) ??
      (splashImage === null ? DEFAULT_HUD_AVATAR_CROP : UPLOADED_HUD_AVATAR_CROP),
  };
}
