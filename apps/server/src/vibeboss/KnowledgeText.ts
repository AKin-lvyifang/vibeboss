// @effect-diagnostics nodeBuiltinImport:off -- the isolated parser process is an external runtime boundary.
// VibeBoss: reads the start of a knowledge file so the organizer can name it. Office formats go
// through T3's document text worker in its own process; unlike attachments, nothing is written
// next to the user's file.
import * as NodeChildProcess from "node:child_process";
import * as NodeURL from "node:url";

import { VibeBossError } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import { EXCERPT_CHARS, htmlToText } from "./KnowledgeNaming.ts";

const PLAIN = new Set(["md", "markdown", "txt", "csv", "json", "yaml", "yml"]);
const HTML = new Set(["html", "htm"]);
const OFFICE = new Set(["docx", "xlsx", "pptx", "odt", "ods", "odp", "rtf", "epub"]);
const MAX_PLAIN_BYTES = 4 * 1024 * 1024;
const MAX_OFFICE_BYTES = 16 * 1024 * 1024;

/** The start of a file's text, or "" when it cannot be read; the organizer then goes by the name. */
export const extractExcerpt = Effect.fn("VibeBossKnowledge.extractExcerpt")(
  function* (file: string, extension: string) {
    const fs = yield* FileSystem.FileSystem;
    const size = Number((yield* fs.stat(file)).size);
    if (PLAIN.has(extension) || HTML.has(extension)) {
      if (size > MAX_PLAIN_BYTES) return "";
      const text = yield* fs.readFileString(file);
      return (HTML.has(extension) ? htmlToText(text) : text).slice(0, EXCERPT_CHARS);
    }
    if (!OFFICE.has(extension) || size > MAX_OFFICE_BYTES) return "";
    const executable = yield* HostProcess.ExecutablePath;
    const isExecutable = yield* HostProcess.IsExecutable;
    const environment = yield* HostProcess.Environment;
    // In a bundle import.meta.url is bin.mjs; development and tests use this source module.
    const entry = NodeURL.fileURLToPath(
      new URL(import.meta.url.endsWith(".ts") ? "../bin.ts" : "./bin.mjs", import.meta.url),
    );
    const text = yield* Effect.tryPromise({
      try: (signal) =>
        new Promise<string>((resolve, reject) => {
          NodeChildProcess.execFile(
            executable,
            [...(isExecutable ? [] : [entry]), "__document-text", file, `.${extension}`],
            {
              signal,
              timeout: 15_000,
              maxBuffer: 4 * 1024 * 1024 + 1024,
              encoding: "utf8",
              windowsHide: true,
              env: {
                ...environment,
                ELECTRON_RUN_AS_NODE: "1",
                NODE_OPTIONS: `${environment.NODE_OPTIONS ?? ""} --max-old-space-size=192`,
              },
            },
            (error, stdout) => (error ? reject(error) : resolve(stdout)),
          );
        }),
      catch: (cause) => new VibeBossError({ detail: "读取文档正文失败", cause }),
    });
    return text.slice(0, EXCERPT_CHARS);
  },
  Effect.orElseSucceed(() => ""),
);
