import { useGT } from "gt-react";
import { UploadIcon } from "lucide-react";
import { useRef, type ChangeEvent } from "react";

import {
  DEFAULT_MASCOT_LIFT,
  MASCOT_LIFT_MAX,
  MASCOT_LIFT_MIN,
  type MascotSide,
  SPLASH_IMAGE_MAX_BYTES,
  useMascotLift,
  useMascotSide,
  useSplashImage,
} from "../../vibebossAppearance";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}

export function VibeBossAppearanceSection() {
  const gt = useGT();
  const searchableSetting = useSearchableSetting();
  const [splashImage, setSplashImage] = useSplashImage();
  const [mascotSide, setMascotSide] = useMascotSide();
  const [mascotLift, setMascotLift] = useMascotLift();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sideLabels: Record<MascotSide, string> = { left: gt("Left"), right: gt("Right") };

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > SPLASH_IMAGE_MAX_BYTES) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: gt("Could not use this file"),
          description: gt("Choose an image or GIF under 2 MB."),
        }),
      );
      return;
    }
    setSplashImage(await readAsDataUrl(file));
  };

  return (
    <SettingsSection id="appearance-vibeboss" title={gt("Mascot")}>
      <SettingsRow
        {...searchableSetting("vibeboss-splash")}
        description={gt(
          "Shown while VibeBoss opens. Upload an image or GIF to replace the waving figure.",
        )}
        resetAction={
          splashImage !== null ? (
            <SettingResetButton
              ariaLabel={gt("Reset splash screen to default")}
              onClick={() => setSplashImage(null)}
            />
          ) : null
        }
        control={
          <div className="flex items-center gap-3">
            <img
              alt=""
              className="size-12 rounded-md border object-contain"
              src={splashImage ?? "/vibeboss-splash-body.webp"}
            />
            <input
              ref={fileInputRef}
              accept="image/*"
              className="sr-only"
              onChange={(event) => void handleFile(event)}
              type="file"
            />
            <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
              <UploadIcon />
              {gt("Upload")}
            </Button>
          </div>
        }
      />
      <SettingsRow
        {...searchableSetting("vibeboss-mascot-position")}
        description={gt("Where the mascot sits in the top-left corner of the sidebar.")}
        resetAction={
          mascotSide !== "right" || mascotLift !== DEFAULT_MASCOT_LIFT ? (
            <SettingResetButton
              ariaLabel={gt("Reset mascot position to default")}
              onClick={() => {
                setMascotSide("right");
                setMascotLift(DEFAULT_MASCOT_LIFT);
              }}
            />
          ) : null
        }
        control={
          <div className="flex w-full items-center gap-3 sm:w-72">
            <Select
              value={mascotSide}
              onValueChange={(value) => {
                if (value === "left" || value === "right") setMascotSide(value);
              }}
            >
              <SelectTrigger size="sm" aria-label={gt("Mascot side")} className="w-24">
                <SelectValue>{(value: MascotSide) => sideLabels[value]}</SelectValue>
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="right">{sideLabels.right}</SelectItem>
                <SelectItem value="left">{sideLabels.left}</SelectItem>
              </SelectPopup>
            </Select>
            <input
              aria-label={gt("Mascot height")}
              className="settings-slider min-w-0 flex-1"
              max={MASCOT_LIFT_MAX}
              min={MASCOT_LIFT_MIN}
              onChange={(event) => setMascotLift(Number(event.currentTarget.value))}
              step={2}
              type="range"
              value={mascotLift}
            />
          </div>
        }
      />
    </SettingsSection>
  );
}
