import { describe, expect, it } from "vite-plus/test";

import {
  acpLocalPresetForCommand,
  acpLocalPresetForIconKey,
  acpLocalPresetIconKey,
  matchesAcpLocalPreset,
  ACP_LOCAL_PRESETS,
} from "./acpLocalPresets";

describe("acpLocalPresets", () => {
  it("recognizes Doubao by executable name, wherever it is installed", () => {
    expect(acpLocalPresetForCommand("/Users/me/.doubao-cli/bin/doubao")?.id).toBe("doubao");
    expect(acpLocalPresetForCommand("doubao")?.id).toBe("doubao");
    expect(acpLocalPresetForCommand("C:\\tools\\doubao.exe")?.id).toBe("doubao");
    expect(acpLocalPresetForCommand("/usr/local/bin/doubao-helper")).toBeUndefined();
    expect(acpLocalPresetForCommand(undefined)).toBeUndefined();
  });

  it("round-trips the icon key", () => {
    const key = acpLocalPresetIconKey("~/bin/doubao");
    expect(acpLocalPresetForIconKey(key)?.id).toBe("doubao");
    expect(acpLocalPresetForIconKey("claude-acp")).toBeUndefined();
  });

  it("matches search by Chinese or English name", () => {
    const [doubao] = ACP_LOCAL_PRESETS;
    expect(matchesAcpLocalPreset(doubao!, "豆包")).toBe(true);
    expect(matchesAcpLocalPreset(doubao!, "Doubao")).toBe(true);
    expect(matchesAcpLocalPreset(doubao!, "qwen")).toBe(false);
  });
});
