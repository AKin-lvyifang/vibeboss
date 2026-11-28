import { msg } from "gt-react";

import { m } from "../../i18n/messages";
import { DoubaoIcon, type Icon } from "../Icons";

/** Local ACP agents VibeBoss lists beside the ACP Registry; they launch an installed CLI. */
export interface AcpLocalPreset {
  readonly id: string;
  readonly name: string;
  readonly description: () => string;
  readonly website: string;
  readonly commandPath: string;
  readonly commandArgs: ReadonlyArray<string>;
  readonly Icon: Icon;
}

export const ACP_LOCAL_PRESETS: ReadonlyArray<AcpLocalPreset> = [
  {
    id: "doubao",
    name: "豆包工作",
    description: () => m(msg("Doubao CLI for your Lark calendar, tasks and docs")),
    website: "https://www.npmjs.com/package/@bytedance/doubao-cli",
    // Where the npm package installs its runtime; works whether or not `doubao` is on PATH.
    commandPath: "~/Library/Application Support/doubao_cli/app/current/doubao",
    commandArgs: ["acp", "serve"],
    Icon: DoubaoIcon,
  },
];

const PRESET_ICON_KEY_PREFIX = "vibeboss-preset:";

/** The preset a local command launches, matched by executable name so hand-made instances count too. */
export function acpLocalPresetForCommand(commandPath: string | null | undefined) {
  const executable = (commandPath ?? "").trim().split(/[\\/]/).pop() ?? "";
  const name = executable.replace(/\.(?:exe|cmd)$/i, "").toLowerCase();
  return ACP_LOCAL_PRESETS.find(
    (preset) => preset.commandPath.split("/").pop()?.toLowerCase() === name,
  );
}

/** Icon key carried in a local instance's acpRegistryAgentId slot. */
export function acpLocalPresetIconKey(commandPath: string | null | undefined): string | undefined {
  const preset = acpLocalPresetForCommand(commandPath);
  return preset ? `${PRESET_ICON_KEY_PREFIX}${preset.id}` : undefined;
}

export function acpLocalPresetForIconKey(key: string | undefined): AcpLocalPreset | undefined {
  if (!key?.startsWith(PRESET_ICON_KEY_PREFIX)) return undefined;
  const id = key.slice(PRESET_ICON_KEY_PREFIX.length);
  return ACP_LOCAL_PRESETS.find((preset) => preset.id === id);
}

export function matchesAcpLocalPreset(preset: AcpLocalPreset, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [preset.id, preset.name, preset.description()].some((text) =>
    text.toLowerCase().includes(needle),
  );
}
