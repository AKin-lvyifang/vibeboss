import { useGT } from "gt-react";
import { useState, type PointerEvent } from "react";

import { cn } from "../../lib/utils";
import {
  clampHudAvatarCrop,
  DEFAULT_HUD_AVATAR_CROP,
  DEFAULT_HUD_IMAGE_URL,
  HUD_AVATAR_CROP_MIN_SIZE,
  type HudAvatarCrop,
  type HudAvatarShape,
  UPLOADED_HUD_AVATAR_CROP,
  useHudAvatarCrop,
  useHudAvatarShape,
  useHudDoNotDisturb,
  useHudEnabled,
  useSplashImage,
} from "../../vibebossAppearance";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";

const PICKER_MAX_WIDTH = 160;
const PICKER_MAX_HEIGHT = 220;

/** The chosen square at `size` pixels, drawn the way the HUD will show it. */
function AvatarPreview({
  image,
  crop,
  aspect,
  shape,
  size,
}: {
  image: string;
  crop: HudAvatarCrop;
  aspect: number;
  shape: HudAvatarShape;
  size: number;
}) {
  return (
    <span
      className={cn(
        "block shrink-0 bg-no-repeat",
        shape === "circle" ? "rounded-full" : "rounded-sm",
      )}
      style={{
        width: size,
        height: size,
        backgroundImage: `url("${image}")`,
        backgroundSize: `${size / crop.size}px auto`,
        backgroundPosition: `${(-(crop.centerX - crop.size / 2) / crop.size) * size}px ${(-(crop.centerY * aspect - crop.size / 2) / crop.size) * size}px`,
      }}
    />
  );
}

function AvatarPicker({
  image,
  crop,
  aspect,
  shape,
  label,
  onAspect,
  onChange,
}: {
  image: string;
  crop: HudAvatarCrop;
  aspect: number;
  shape: HudAvatarShape;
  label: string;
  onAspect: (aspect: number) => void;
  onChange: (crop: HudAvatarCrop) => void;
}) {
  const width = Math.min(PICKER_MAX_WIDTH, PICKER_MAX_HEIGHT / aspect);
  const height = width * aspect;
  const side = crop.size * width;
  const moveTo = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    onChange(
      clampHudAvatarCrop(
        {
          ...crop,
          centerX: (event.clientX - bounds.left) / bounds.width,
          centerY: (event.clientY - bounds.top) / bounds.height,
        },
        aspect,
      ),
    );
  };
  return (
    <div
      aria-label={label}
      className="relative shrink-0 cursor-grab touch-none overflow-hidden rounded-md border bg-muted"
      role="img"
      style={{ width, height }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        moveTo(event);
      }}
      onPointerMove={(event) => {
        if (event.buttons === 1) moveTo(event);
      }}
    >
      <img
        alt=""
        className="pointer-events-none size-full"
        draggable={false}
        src={image}
        onLoad={(event) =>
          onAspect(event.currentTarget.naturalHeight / event.currentTarget.naturalWidth)
        }
      />
      <span
        className={cn(
          "pointer-events-none absolute border-2 border-primary",
          shape === "circle" ? "rounded-full" : "rounded-md",
        )}
        style={{
          width: side,
          height: side,
          left: crop.centerX * width - side / 2,
          top: crop.centerY * height - side / 2,
        }}
      />
    </div>
  );
}

/** macOS only: the strip under the notch that says which threads need the user. */
export function VibeBossHudSection() {
  const gt = useGT();
  const searchableSetting = useSearchableSetting();
  const [enabled, setEnabled] = useHudEnabled();
  const [doNotDisturb, setDoNotDisturb] = useHudDoNotDisturb();
  const [shape, setShape] = useHudAvatarShape();
  const [storedCrop, setStoredCrop] = useHudAvatarCrop();
  const [splashImage] = useSplashImage();
  // Until the image has loaded its size is unknown; the default figure is 2:3.
  const [loaded, setLoaded] = useState<{ image: string; aspect: number } | null>(null);
  const image = splashImage ?? DEFAULT_HUD_IMAGE_URL;
  const aspect = loaded?.image === image ? loaded.aspect : 1.5;
  const crop = clampHudAvatarCrop(
    storedCrop ?? (splashImage === null ? DEFAULT_HUD_AVATAR_CROP : UPLOADED_HUD_AVATAR_CROP),
    aspect,
  );
  const shapeLabels: Record<HudAvatarShape, string> = {
    square: gt("Square"),
    circle: gt("Circle"),
  };

  return (
    <SettingsSection id="appearance-vibeboss-hud" title={gt("Menu bar strip")}>
      <SettingsRow
        {...searchableSetting("vibeboss-hud")}
        description={gt("Shows which threads need you, on top of the menu bar.")}
        control={
          <Switch
            aria-label={gt("Show the menu bar strip")}
            checked={enabled}
            onCheckedChange={setEnabled}
          />
        }
      />
      <SettingsRow
        {...searchableSetting("vibeboss-hud-do-not-disturb")}
        description={gt("Shows only the avatar, for when you share your screen.")}
        control={
          <Switch
            aria-label={gt("Do not disturb")}
            checked={doNotDisturb}
            disabled={!enabled}
            onCheckedChange={setDoNotDisturb}
          />
        }
      />
      <SettingsRow
        {...searchableSetting("vibeboss-hud-avatar")}
        description={gt("Drag on the image to choose the part the strip shows.")}
        resetAction={
          storedCrop !== null || shape !== "square" ? (
            <SettingResetButton
              ariaLabel={gt("Reset strip avatar to default")}
              onClick={() => {
                setStoredCrop(null);
                setShape("square");
              }}
            />
          ) : null
        }
        control={
          <div className="flex items-start gap-4">
            <AvatarPicker
              image={image}
              crop={crop}
              aspect={aspect}
              shape={shape}
              label={gt("Mascot image")}
              onAspect={(next) => setLoaded({ image, aspect: next })}
              onChange={setStoredCrop}
            />
            <div className="flex w-36 flex-col gap-3">
              <div className="flex items-center gap-3 rounded-md bg-black p-2">
                <AvatarPreview image={image} crop={crop} aspect={aspect} shape={shape} size={22} />
                <AvatarPreview image={image} crop={crop} aspect={aspect} shape={shape} size={44} />
              </div>
              <Select
                value={shape}
                onValueChange={(value) => {
                  if (value === "square" || value === "circle") setShape(value);
                }}
              >
                <SelectTrigger size="sm" aria-label={gt("Avatar shape")}>
                  <SelectValue>{(value: HudAvatarShape) => shapeLabels[value]}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="square">{shapeLabels.square}</SelectItem>
                  <SelectItem value="circle">{shapeLabels.circle}</SelectItem>
                </SelectPopup>
              </Select>
              <input
                aria-label={gt("Avatar size")}
                className="settings-slider min-w-0"
                max={Math.round(Math.min(1, aspect) * 100)}
                min={HUD_AVATAR_CROP_MIN_SIZE * 100}
                onChange={(event) =>
                  setStoredCrop(
                    clampHudAvatarCrop(
                      { ...crop, size: Number(event.currentTarget.value) / 100 },
                      aspect,
                    ),
                  )
                }
                type="range"
                value={Math.round(crop.size * 100)}
              />
            </div>
          </div>
        }
      />
    </SettingsSection>
  );
}
