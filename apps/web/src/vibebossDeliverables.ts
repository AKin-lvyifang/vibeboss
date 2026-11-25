// VibeBoss: which files count as a thread's deliverables, and which team member a delegated child
// thread belongs to. Pure, so the details panel and its tests share one definition.

export type DeliverableKind = "page" | "document" | "image" | "media" | "package";

const KIND_BY_EXTENSION: Readonly<Record<string, DeliverableKind>> = {
  html: "page",
  htm: "page",
  md: "document",
  pdf: "document",
  docx: "document",
  pptx: "document",
  xlsx: "document",
  csv: "document",
  png: "image",
  jpg: "image",
  jpeg: "image",
  webp: "image",
  gif: "image",
  svg: "image",
  mp4: "media",
  mov: "media",
  mp3: "media",
  wav: "media",
  dmg: "package",
  exe: "package",
  pkg: "package",
  zip: "package",
  apk: "package",
};

// Code and build folders hold assets and generated files, not things handed to a person.
const SOURCE_SEGMENTS = new Set([
  "src",
  "public",
  "app",
  "apps",
  "packages",
  "lib",
  "node_modules",
  "dist",
  "build",
  "test",
  "tests",
  "__tests__",
]);

// Rule, memory and project boilerplate files are written for agents or tooling.
const AGENT_FILES = new Set([
  "agents.md",
  "claude.md",
  "gemini.md",
  "soul.md",
  "memory.md",
  "readme.md",
  "changelog.md",
  "license.md",
  "contributing.md",
  "security.md",
]);

function segmentsOf(path: string): ReadonlyArray<string> {
  return path.split(/[\\/]+/).filter((segment) => segment !== "");
}

export function deliverableKind(path: string): DeliverableKind | null {
  const name = segmentsOf(path).at(-1) ?? "";
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  return KIND_BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? null;
}

/**
 * A file the agent named in its reply counts when its type is one a person opens; a file it only
 * created must also live outside code folders.
 */
export function isDeliverable(path: string, source: "mentioned" | "created"): boolean {
  if (deliverableKind(path) === null) return false;
  const segments = segmentsOf(path);
  const name = (segments.at(-1) ?? "").toLowerCase();
  if (AGENT_FILES.has(name)) return false;
  if (segments.some((segment) => segment.startsWith(".") && segment !== "." && segment !== ".."))
    return false;
  if (source === "created" && segments.slice(0, -1).some((segment) => SOURCE_SEGMENTS.has(segment)))
    return false;
  return true;
}

export interface TeamMember {
  readonly id: string;
  readonly name: string;
  readonly providerInstanceId: string;
  readonly model: string;
}

const TITLE_PREFIX = /^\s*@([\p{L}\p{N}_-]+)\s*[：:]\s*/u;

/**
 * The lead titles each delegation "@name：task". Without that prefix, a member whose agent and
 * model match is the next best guess, then the only member on that agent.
 */
export function memberForDelegation(
  delegation: {
    readonly title: string | null;
    readonly providerInstanceId: string | null;
    readonly model: string | null;
  },
  members: ReadonlyArray<TeamMember>,
): { readonly member: TeamMember | null; readonly title: string } {
  const title = delegation.title ?? "";
  const prefix = TITLE_PREFIX.exec(title);
  if (prefix) {
    const named = members.find((member) => member.name === prefix[1]);
    if (named) return { member: named, title: title.slice(prefix[0].length) };
  }
  const sameAgent = members.filter(
    (member) => member.providerInstanceId === delegation.providerInstanceId,
  );
  const sameModel =
    delegation.model === null
      ? []
      : sameAgent.filter((member) => member.model.trim() === delegation.model);
  const member =
    sameModel.length === 1 ? sameModel[0]! : sameAgent.length === 1 ? sameAgent[0]! : null;
  return { member, title };
}
