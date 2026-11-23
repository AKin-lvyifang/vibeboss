import "@excalidraw/excalidraw/index.css";

import type { EnvironmentId } from "@t3tools/contracts";
import { Excalidraw, serializeAsJSON } from "@excalidraw/excalidraw";
import { useLocale } from "gt-react";
import { useRef, useState } from "react";

import { useTheme } from "../../hooks/useTheme";
import { projectEnvironment } from "../../state/projects";
import { useAtomCommand } from "../../state/use-atom-command";

type ExcalidrawProps = Parameters<typeof Excalidraw>[0];
type InitialData = NonNullable<ExcalidrawProps["initialData"]>;

const SAVE_DELAY_MS = 800;

function parseScene(text: string): InitialData {
  try {
    const scene = JSON.parse(text) as Record<string, unknown>;
    return {
      elements: Array.isArray(scene.elements) ? scene.elements : [],
      appState:
        scene.appState !== null && typeof scene.appState === "object"
          ? { ...(scene.appState as object), collaborators: new Map() }
          : {},
      files:
        scene.files !== null && typeof scene.files === "object"
          ? (scene.files as Record<string, unknown>)
          : {},
      scrollToContent: true,
    } as unknown as InitialData;
  } catch {
    return { elements: [], scrollToContent: true };
  }
}

/** Editable canvas for `.excalidraw` files; edits are written back to the same file. */
export default function ExcalidrawViewer(props: {
  readonly text: string;
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly relativePath: string;
}) {
  const { resolvedTheme } = useTheme();
  const locale = useLocale();
  const writeFile = useAtomCommand(projectEnvironment.writeFile, { reportFailure: true });
  const [initialData] = useState(() => parseScene(props.text));
  const lastSaved = useRef(props.text);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange: NonNullable<ExcalidrawProps["onChange"]> = (elements, appState, files) => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const contents = serializeAsJSON(elements, appState, files, "local");
      if (contents === lastSaved.current) return;
      lastSaved.current = contents;
      void writeFile({
        environmentId: props.environmentId,
        input: { cwd: props.cwd, relativePath: props.relativePath, contents },
      });
    }, SAVE_DELAY_MS);
  };

  return (
    <div className="min-h-0 flex-1" data-vibeboss-canvas>
      <Excalidraw
        initialData={initialData}
        theme={resolvedTheme === "dark" ? "dark" : "light"}
        onChange={handleChange}
        langCode={locale.startsWith("zh") ? "zh-CN" : "en"}
      />
    </div>
  );
}
