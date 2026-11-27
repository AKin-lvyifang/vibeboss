// VibeBoss: the knowledge base's naming rule. A small model reads each new file and proposes
// "topic-version-date" plus where it belongs; everything it returns is checked here, so a bad
// answer can leave a file unorganized but can never move it outside the knowledge folder.
import type { VibeBossKnowledgeDoc, VibeBossKnowledgeDocType } from "@t3tools/contracts";

export const INDEX_FILE = "索引.md";
export const DEFAULT_CATEGORIES: ReadonlyArray<string> = ["业务知识", "个人知识", "项目资料"];
export const EXCERPT_CHARS = 2400;

const TYPE_BY_EXTENSION: Record<string, VibeBossKnowledgeDocType> = {
  md: "md",
  markdown: "md",
  txt: "md",
  pptx: "pptx",
  ppt: "pptx",
  key: "pptx",
  docx: "docx",
  doc: "docx",
  xlsx: "xlsx",
  xls: "xlsx",
  csv: "xlsx",
  html: "html",
  htm: "html",
  pdf: "pdf",
};

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

export function docType(name: string): VibeBossKnowledgeDocType {
  return TYPE_BY_EXTENSION[extensionOf(name)] ?? "other";
}

/** One path segment: no separators, no characters a file system rejects, bounded length. */
export function sanitizeSegment(text: string, max = 40): string {
  const cleaned = text
    .normalize("NFC")
    .replace(/[\u0000-\u001f\\/:*?"<>|]/g, " ")
    .split(/\s+/)
    .filter((word) => !/^\.*$/.test(word))
    .join(" ");
  return [...cleaned].slice(0, max).join("").trim();
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface OrganizePlan {
  readonly file: string;
  readonly category: string;
  readonly group: string;
  readonly topic: string;
  readonly version: string;
  readonly date: string;
  readonly audience: string;
  readonly summary: string;
}

/** "topic-version-date.ext"; a document with a single version drops the middle part. */
export function organizedName(plan: Pick<OrganizePlan, "topic" | "version" | "date">, ext: string) {
  const parts = [plan.topic, plan.version, plan.date].filter((part) => part !== "");
  return `${parts.join("-")}${ext === "" ? "" : `.${ext}`}`;
}

export function organizedPath(plan: OrganizePlan, ext: string): string {
  return [plan.category, plan.group, organizedName(plan, ext)]
    .filter((part) => part !== "")
    .join("/");
}

/** Appends "-2", "-3"… before the extension until the path is free. */
export function uniquePath(target: string, taken: ReadonlySet<string>): string {
  if (!taken.has(target)) return target;
  const slash = target.lastIndexOf("/");
  const dot = target.lastIndexOf(".");
  const stem = dot > slash ? target.slice(0, dot) : target;
  const ext = dot > slash ? target.slice(dot) : "";
  for (let index = 2; ; index++) {
    const candidate = `${stem}-${index}${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export interface OrganizeInput {
  readonly file: string;
  readonly modifiedDate: string;
  readonly excerpt: string;
}

export interface OrganizeContext {
  readonly categories: ReadonlyArray<string>;
  /** "category/group" pairs already in use. */
  readonly groups: ReadonlyArray<string>;
  readonly topics: ReadonlyArray<string>;
}

export function organizePrompt(
  files: ReadonlyArray<OrganizeInput>,
  context: OrganizeContext,
): string {
  const body = files
    .map(
      (file, index) =>
        `### 文件 ${index + 1}\nfile: ${file.file}\n修改日期: ${file.modifiedDate}\n内容摘录:\n${file.excerpt.trim() || "（读不到正文，只能按文件名判断）"}`,
    )
    .join("\n\n");
  return [
    "你在整理一个个人知识库。给下面每个文件定规范名字并归类，让人和智能体以后一问就能找到。",
    "命名规则：主题-版本-日期。",
    "- topic（主题）：这份资料讲什么，2–12 个字的名词短语，不带版本、日期、“最终版”这类词。同一份资料的不同版本必须用同一个主题；已有主题里有对得上的就原样沿用。",
    "- version（版本）：这一版给谁用或处在什么阶段，如“早会版”“技术评审版”“初稿”。看不出版本之分就写空字符串。",
    "- date（日期）：YYYY-MM-DD。正文里写明了成稿或汇报日期就用它，否则用该文件的修改日期。",
    "- audience（给谁）：这一版的读者或场合，一个短语；看不出就写空字符串。",
    `- category（分类）：只能从这些里选一个：${context.categories.join("、")}。`,
    "- group（分组）：分类下的小组，2–8 个字的名词。已有分组里合适的就沿用，没有合适的才新起。",
    "- summary（摘要）：一句话说清内容和它与其他版本的区别，不超过 60 字。",
    `已有主题：${context.topics.length === 0 ? "（暂无）" : context.topics.join("、")}`,
    `已有分组：${context.groups.length === 0 ? "（暂无）" : context.groups.join("、")}`,
    '把结果写成 JSON 数组放进 transcription 字段，不要别的文字，每个文件一项，file 一字不差地照抄：[{"file":"...","topic":"...","version":"...","date":"YYYY-MM-DD","audience":"...","category":"...","group":"...","summary":"..."}]',
    "",
    body,
  ].join("\n");
}

function field(entry: object, key: string): string {
  const value: unknown = Reflect.get(entry, key);
  return typeof value === "string" ? value : "";
}

/** Keeps only plans for files that were asked about, with every field made safe to use in a path. */
export function parseOrganizeAnswer(
  text: string,
  files: ReadonlyArray<OrganizeInput>,
  categories: ReadonlyArray<string>,
): ReadonlyArray<OrganizePlan> {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end < start) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const byFile = new Map(files.map((file) => [file.file, file]));
  const plans: OrganizePlan[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object") continue;
    const input = byFile.get(field(entry, "file"));
    if (input === undefined) continue;
    const topic = sanitizeSegment(field(entry, "topic"), 24);
    const category = field(entry, "category").trim();
    if (topic === "" || !categories.includes(category)) continue;
    const date = field(entry, "date").trim();
    byFile.delete(input.file);
    plans.push({
      file: input.file,
      category,
      group: sanitizeSegment(field(entry, "group"), 16),
      topic,
      version: sanitizeSegment(field(entry, "version"), 16),
      date: DATE.test(date) ? date : input.modifiedDate,
      audience: sanitizeSegment(field(entry, "audience"), 24),
      summary: field(entry, "summary").replace(/\s+/g, " ").trim().slice(0, 120),
    });
  }
  return plans;
}

/** Strips markup so a model sees what a reader sees. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const TYPE_LABEL: Record<VibeBossKnowledgeDocType, string> = {
  md: "文档",
  pptx: "PPT",
  docx: "Word",
  xlsx: "表格",
  html: "HTML",
  pdf: "PDF",
  other: "文件",
};

function encodeLink(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/**
 * The file agents read first. One line per file keeps it small enough to read whole; versions of
 * one topic sit together, newest first, so "the latest one" and "the one for X" are both answerable.
 */
export function renderIndex(docs: ReadonlyArray<VibeBossKnowledgeDoc>): string {
  const organized = docs.filter((doc) => doc.organized);
  const pending = docs.filter((doc) => !doc.organized);
  const lines = [
    "# 知识库索引",
    "",
    "由 VibeBoss 自动维护，别手改。找资料先看这里，再按路径打开原文件。文件名规则：主题-版本-日期。同一主题下有多个版本时，按日期从新到旧排，第一个是最新版。",
  ];
  const categories = [...new Set(organized.map((doc) => doc.category))];
  for (const category of categories) {
    lines.push("", `## ${category}`);
    const inCategory = organized.filter((doc) => doc.category === category);
    for (const group of new Set(inCategory.map((doc) => doc.group))) {
      if (group !== "") lines.push("", `### ${group}`);
      const inGroup = inCategory.filter((doc) => doc.group === group);
      for (const topic of new Set(inGroup.map((doc) => doc.topic))) {
        const versions = inGroup
          .filter((doc) => doc.topic === topic)
          .toSorted((left, right) => right.date.localeCompare(left.date));
        const many = versions.length > 1;
        if (many) lines.push("", `- **${topic}**（${versions.length} 个版本）`);
        for (const doc of versions) {
          const detail = [
            TYPE_LABEL[doc.type],
            doc.audience === "" ? "" : `给：${doc.audience}`,
            doc.summary,
          ]
            .filter((part) => part !== "")
            .join("｜");
          lines.push(`${many ? "  " : ""}- [${doc.name}](${encodeLink(doc.path)})：${detail}`);
        }
      }
    }
  }
  if (pending.length > 0) {
    lines.push("", "## 待整理");
    for (const doc of pending) lines.push(`- [${doc.name}](${encodeLink(doc.path)})`);
  }
  return `${lines.join("\n")}\n`;
}
