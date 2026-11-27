// VibeBoss: the knowledge base as a graph that grows outward one node at a time: the folder, its
// categories, their groups, and the files, with versions of one topic hanging off that topic.
import type { VibeBossKnowledgeDoc } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { ArrowLeftIcon } from "lucide-react";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { useEffect, useRef } from "react";

import { isElectron } from "../../env";

import { observeResize } from "../../lib/observeResize";
import { Button } from "../ui/button";
import { WorkspacePageHeader } from "../WorkspacePageHeader";

const MAX_NODES = 600;
const GROW_EVERY_MS = 45;
const GOLDEN_ANGLE = 2.399963;
const LABEL_FONT = "12px system-ui, sans-serif";
/** Root, category, group, topic, file. */
const RADIUS = [7, 5.5, 4.5, 3.5, 2.5] as const;
const REST = [0, 110, 70, 46, 34] as const;

interface GraphNode {
  readonly label: string;
  readonly level: 0 | 1 | 2 | 3 | 4;
  readonly parent: number;
  readonly doc: VibeBossKnowledgeDoc | null;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** When the node appeared, for its fade-in; 0 while it is still hidden. */
  born: number;
}

/** Parents always come before their children, so the graph can appear in array order. */
function buildNodes(
  docs: ReadonlyArray<VibeBossKnowledgeDoc>,
  rootLabel: string,
  unorganizedLabel: string,
): Array<GraphNode> {
  const nodes: Array<GraphNode> = [];
  const add = (
    label: string,
    level: GraphNode["level"],
    parent: number,
    doc: VibeBossKnowledgeDoc | null = null,
  ) => nodes.push({ label, level, parent, doc, x: 0, y: 0, vx: 0, vy: 0, born: 0 }) - 1;
  const root = add(rootLabel, 0, -1);
  const categories = new Map<string, number>();
  const groups = new Map<string, number>();
  const topics = new Map<string, number>();
  const versionCount = new Map<string, number>();
  for (const doc of docs) {
    const key = `${doc.category}\0${doc.group}\0${doc.topic}`;
    if (doc.organized) versionCount.set(key, (versionCount.get(key) ?? 0) + 1);
  }
  // Too many files to draw: stop at topics and let the list show the files.
  const withFiles = docs.length + 40 <= MAX_NODES;
  const leaves: Array<() => void> = [];
  for (const doc of docs) {
    const categoryLabel = doc.organized ? doc.category : unorganizedLabel;
    let category = categories.get(categoryLabel);
    if (category === undefined) {
      category = add(categoryLabel, 1, root);
      categories.set(categoryLabel, category);
    }
    let parent = category;
    if (doc.organized && doc.group !== "") {
      const groupKey = `${doc.category}\0${doc.group}`;
      let group = groups.get(groupKey);
      if (group === undefined) {
        group = add(doc.group, 2, category);
        groups.set(groupKey, group);
      }
      parent = group;
    }
    const topicKey = `${doc.category}\0${doc.group}\0${doc.topic}`;
    if (doc.organized && (versionCount.get(topicKey) ?? 0) > 1) {
      let topic = topics.get(topicKey);
      if (topic === undefined) {
        topic = add(doc.topic, 3, parent);
        topics.set(topicKey, topic);
      }
      parent = topic;
    }
    if (withFiles) {
      const owner = parent;
      leaves.push(() =>
        add(doc.organized && doc.version !== "" ? doc.version : doc.name, 4, owner, doc),
      );
    }
  }
  for (const leaf of leaves) leaf();
  return reorderByLevel(nodes);
}

/** Sorts by depth while keeping every `parent` index pointing at the same node. */
function reorderByLevel(nodes: ReadonlyArray<GraphNode>): Array<GraphNode> {
  const order = nodes
    .map((_, index) => index)
    .toSorted((a, b) => nodes[a]!.level - nodes[b]!.level);
  const position = new Map(order.map((from, to) => [from, to]));
  return order.map((from) => ({
    ...nodes[from]!,
    parent: nodes[from]!.parent === -1 ? -1 : position.get(nodes[from]!.parent)!,
  }));
}

function step(nodes: ReadonlyArray<GraphNode>, visible: number, alpha: number) {
  for (let i = 0; i < visible; i++) {
    const a = nodes[i]!;
    for (let j = 0; j < i; j++) {
      const b = nodes[j]!;
      const dx = a.x - b.x || 0.01;
      const dy = a.y - b.y || 0.01;
      const distance2 = dx * dx + dy * dy;
      if (distance2 > 90_000) continue;
      const force = (900 * alpha) / (distance2 + 60);
      a.vx += dx * force * 0.05;
      a.vy += dy * force * 0.05;
      b.vx -= dx * force * 0.05;
      b.vy -= dy * force * 0.05;
    }
  }
  for (let i = 1; i < visible; i++) {
    const node = nodes[i]!;
    const parent = nodes[node.parent]!;
    const dx = node.x - parent.x;
    const dy = node.y - parent.y;
    const distance = Math.hypot(dx, dy) || 0.01;
    const pull = ((distance - REST[node.level]) / distance) * 0.08 * alpha;
    node.vx -= dx * pull;
    node.vy -= dy * pull;
    parent.vx += dx * pull * 0.4;
    parent.vy += dy * pull * 0.4;
  }
  for (let i = 0; i < visible; i++) {
    const node = nodes[i]!;
    if (i === 0) {
      node.x = 0;
      node.y = 0;
      continue;
    }
    node.vx = (node.vx - node.x * 0.002 * alpha) * 0.82;
    node.vy = (node.vy - node.y * 0.002 * alpha) * 0.82;
    node.x += node.vx;
    node.y += node.vy;
  }
}

function KnowledgeGraph(props: {
  readonly docs: ReadonlyArray<VibeBossKnowledgeDoc>;
  readonly onOpen: (doc: VibeBossKnowledgeDoc) => void;
}) {
  const gt = useGT();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onOpenRef = useRef(props.onOpen);
  const rootLabel = gt("Knowledge");
  const unorganizedLabel = gt("Unorganized");
  const { docs } = props;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the click handler current for the canvas listeners below
  useEffect(() => {
    onOpenRef.current = props.onOpen;
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drives a canvas: the layout simulation, its frames and pointer listeners
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const nodes = buildNodes(docs, rootLabel, unorganizedLabel);
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const style = getComputedStyle(canvas);
    const colors = {
      line: style.getPropertyValue("--border").trim() || "#8884",
      text: style.getPropertyValue("--foreground").trim() || "#222",
      muted: style.getPropertyValue("--muted-foreground").trim() || "#888",
      primary: style.getPropertyValue("--primary").trim() || "#36f",
    };
    const labelAll = nodes.length <= 40;
    context.font = LABEL_FONT;
    const labels = nodes.map((node) => {
      const text =
        [...node.label].length > 18 ? `${[...node.label].slice(0, 17).join("")}…` : node.label;
      return { text, width: context.measureText(text).width };
    });
    let visible = 0;
    let alpha = 1;
    let hovered = -1;
    let frame = 0;
    let lastGrow = 0;
    let view = { scale: 1, x: 0, y: 0 };

    const reveal = (now: number) => {
      const node = nodes[visible]!;
      const parent = node.parent === -1 ? null : nodes[node.parent]!;
      const angle = visible * GOLDEN_ANGLE;
      node.x = (parent?.x ?? 0) + Math.cos(angle) * 12;
      node.y = (parent?.y ?? 0) + Math.sin(angle) * 12;
      node.born = now;
      visible++;
      alpha = Math.max(alpha, 0.7);
    };

    const fit = (instant: boolean) => {
      let minX = -60;
      let maxX = 60;
      let minY = -60;
      let maxY = 60;
      for (let i = 0; i < visible; i++) {
        minX = Math.min(minX, nodes[i]!.x);
        maxX = Math.max(maxX, nodes[i]!.x);
        minY = Math.min(minY, nodes[i]!.y);
        maxY = Math.max(maxY, nodes[i]!.y);
      }
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      // Labels sit to the right of their nodes, so that side keeps room for the longest one shown.
      let widest = 0;
      for (let i = 0; i < visible; i++) {
        if (nodes[i]!.level <= 2 || labelAll) widest = Math.max(widest, labels[i]!.width);
      }
      const left = 24;
      const usable = Math.max(120, width - left - Math.min(width * 0.45, widest + 28));
      const scale = Math.min(1.3, usable / (maxX - minX), (height - 64) / (maxY - minY));
      const target = {
        scale,
        x: left + usable / 2 - ((minX + maxX) / 2) * scale,
        y: height / 2 - ((minY + maxY) / 2) * scale,
      };
      const ease = instant ? 1 : 0.08;
      view = {
        scale: view.scale + (target.scale - view.scale) * ease,
        x: view.x + (target.x - view.x) * ease,
        y: view.y + (target.y - view.y) * ease,
      };
    };

    const draw = (now: number) => {
      const ratio = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
        canvas.width = width * ratio;
        canvas.height = height * ratio;
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      const sx = (node: GraphNode) => node.x * view.scale + view.x;
      const sy = (node: GraphNode) => node.y * view.scale + view.y;
      const near = (index: number) =>
        hovered === -1 ||
        index === hovered ||
        nodes[index]!.parent === hovered ||
        nodes[hovered]!.parent === index;

      context.lineWidth = 1;
      context.strokeStyle = colors.line;
      for (let i = 1; i < visible; i++) {
        const node = nodes[i]!;
        context.globalAlpha = near(i) && near(node.parent) ? 1 : 0.25;
        context.beginPath();
        context.moveTo(sx(nodes[node.parent]!), sy(nodes[node.parent]!));
        context.lineTo(sx(node), sy(node));
        context.stroke();
      }
      context.font = LABEL_FONT;
      context.textBaseline = "middle";
      for (let i = 0; i < visible; i++) {
        const node = nodes[i]!;
        const grown = still ? 1 : Math.min(1, (now - node.born) / 260);
        const radius = RADIUS[node.level] * (0.3 + 0.7 * grown);
        context.globalAlpha = (near(i) ? 1 : 0.2) * grown;
        context.fillStyle =
          node.level === 0 || i === hovered
            ? colors.primary
            : node.level <= 2
              ? colors.text
              : colors.muted;
        context.beginPath();
        context.arc(sx(node), sy(node), radius, 0, Math.PI * 2);
        context.fill();
        if (node.level <= 2 || labelAll || i === hovered || nodes[i]!.parent === hovered) {
          context.fillStyle = node.level <= 1 ? colors.text : colors.muted;
          context.fillText(labels[i]!.text, sx(node) + radius + 5, sy(node));
        }
      }
      context.globalAlpha = 1;
    };

    const tick = (now: number) => {
      if (visible < nodes.length && now - lastGrow >= GROW_EVERY_MS) {
        reveal(now);
        lastGrow = now;
      }
      step(nodes, visible, alpha);
      alpha *= 0.985;
      fit(false);
      draw(now);
      const growing = visible < nodes.length || now - (nodes[visible - 1]?.born ?? 0) < 300;
      // Stops once the layout has settled, so an open graph costs nothing while idle.
      frame = growing || alpha > 0.03 ? requestAnimationFrame(tick) : 0;
    };

    if (still) {
      while (visible < nodes.length) reveal(0);
      for (let i = 0; i < 400; i++) {
        step(nodes, visible, alpha);
        alpha *= 0.985;
      }
      fit(true);
      draw(1000);
    } else {
      fit(true);
      frame = requestAnimationFrame(tick);
    }

    const redraw = () => {
      if (frame !== 0) return;
      fit(true);
      draw(performance.now() + 1000);
    };
    const nodeAt = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      const x = (event.clientX - bounds.left - view.x) / view.scale;
      const y = (event.clientY - bounds.top - view.y) / view.scale;
      let best = -1;
      let bestDistance = (12 / view.scale) ** 2;
      for (let i = 0; i < visible; i++) {
        const distance = (nodes[i]!.x - x) ** 2 + (nodes[i]!.y - y) ** 2;
        if (distance < bestDistance) {
          best = i;
          bestDistance = distance;
        }
      }
      return best;
    };
    const onMove = (event: PointerEvent) => {
      const next = nodeAt(event);
      if (next === hovered) return;
      hovered = next;
      canvas.style.cursor = next !== -1 && nodes[next]!.doc !== null ? "pointer" : "default";
      redraw();
    };
    const onLeave = () => {
      if (hovered === -1) return;
      hovered = -1;
      redraw();
    };
    const onClick = (event: PointerEvent) => {
      const doc = nodes[nodeAt(event)]?.doc;
      if (doc) onOpenRef.current(doc);
    };
    const stopObserving = observeResize(canvas, redraw);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("click", onClick as (event: MouseEvent) => void);
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      stopObserving();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("click", onClick as (event: MouseEvent) => void);
    };
  }, [docs, rootLabel, unorganizedLabel]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={gt("Knowledge graph")}
      className="block min-h-0 w-full flex-1"
    />
  );
}

/** The graph as a second-level page that slides in over the knowledge page. */
export function KnowledgeGraphPage(props: {
  readonly open: boolean;
  readonly docs: ReadonlyArray<VibeBossKnowledgeDoc>;
  readonly onOpen: (doc: VibeBossKnowledgeDoc) => void;
  readonly onClose: () => void;
}) {
  const gt = useGT();
  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence>
        {props.open ? (
          <motion.div
            className="absolute inset-0 z-10 flex flex-col bg-background"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.26, ease: [0.32, 0.72, 0, 1] }}
          >
            <WorkspacePageHeader electron={isElectron} className="border-b">
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={gt("Back to knowledge")}
                onClick={props.onClose}
              >
                <ArrowLeftIcon />
              </Button>
              <h1 className="flex-1 truncate font-medium text-sm">
                <T>Knowledge graph</T>
              </h1>
            </WorkspacePageHeader>
            <KnowledgeGraph docs={props.docs} onOpen={props.onOpen} />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </MotionConfig>
  );
}
