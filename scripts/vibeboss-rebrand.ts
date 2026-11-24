// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - a one-shot rename script; sync Node APIs keep it small.
// VibeBoss: rewrites upstream "T3 Code" / "T3 <thing>" wording; idempotent, re-run after upstream merges.
// Web components are skipped because gt keys hash their English source; translations carry that copy.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const { readdirSync, readFileSync, statSync, writeFileSync } = NodeFS;
const { join } = NodePath;

const roots = [
  "apps/server/src",
  "apps/desktop/src",
  "apps/web/src/i18n/translations",
  ...readdirSync("packages").map((name) => join("packages", name, "src")),
];
const extensions = /\.(ts|tsx|mts|mjs|json)$/;
const rules: ReadonlyArray<readonly [RegExp, string]> = [
  [/T3 Code/g, "VibeBoss"],
  [/\bT3(?= (?!Connect\b|Chat\b)[A-Za-z一-鿿])/g, "VibeBoss"],
];

let files = 0;
const walk = (dir: string) => {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    // triage/ must stay byte-identical to upstream's .github/triage/PLAYBOOK.md.
    if (name === "node_modules" || name === "dist" || name === "triage") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (extensions.test(name)) {
      const before = readFileSync(path, "utf8");
      const after = rules.reduce((text, [pattern, value]) => text.replace(pattern, value), before);
      if (after !== before) {
        writeFileSync(path, after);
        files++;
      }
    }
  }
};
roots.forEach(walk);
console.log(`vibeboss-rebrand: updated ${files} files`);
