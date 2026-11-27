import { assert, it } from "@effect/vitest";

import { openKnowledgeIndex, splitPassages, tokenize } from "./KnowledgeIndex.ts";

it("splits Chinese into two-character tokens and keeps Latin words whole", () => {
  assert.strictEqual(tokenize("Q4产品汇报 v2"), "q4 产品 品汇 汇报 v2");
});

it("remembers the slide, sheet or heading each passage came from", () => {
  const passages = splitPassages(
    "开头\n## Slide 2\n第二页内容\n## Sheet: 月度\n表格\n# 结论\n结论内容",
  );
  assert.deepStrictEqual(
    passages.map((passage) => passage.location),
    ["", "第 2 页", "工作表 月度", "结论"],
  );
});

// A small made-up knowledge base and questions asked the way a person would ask them. The
// expected answer is the file and place a reader would open. Retrieval changes must keep this score.
const CORPUS: ReadonlyArray<readonly [path: string, summary: string, text: string]> = [
  [
    "业务知识/产品汇报/Q4产品季度汇报-技术评审版-2026-11-27.pptx",
    "Q4产品季度汇报 技术评审版 技术评审会 在早会版基础上增加架构改动和风险两页",
    "## Slide 1\nQ4 产品季度汇报（技术评审）\n## Slide 3\n本季度结果：新增付费 138，续费率 84%\n## Slide 7\n架构改动：检索服务拆成独立进程，索引改为增量更新\n## Slide 8\n风险：迁移期间搜索延迟可能上升；回滚预案见附录",
  ],
  [
    "业务知识/产品汇报/Q4产品季度汇报-早会版-2026-11-25.pptx",
    "Q4产品季度汇报 早会版 全员 精简版，重点是本季度结果和下季度目标",
    "## Slide 1\nQ4 产品季度汇报（周一早会）\n## Slide 2\n本季度结果：新增付费 138，续费率 84%\n## Slide 4\n下季度目标：续费率提升到 88%，上线团队版",
  ],
  [
    "业务知识/运营规则/续费失败处理口径-2026-11-20.md",
    "续费失败处理口径 客服与运营 自动续费失败后的重试与降级规则",
    "# 续费失败处理口径\n自动续费失败后 3 天内重试两次，仍失败则降级为免费版。\n# 手动续费\n用户可在 设置 → 订阅 中手动续费。",
  ],
  [
    "业务知识/经营数据/月度经营数据-2026-11-27.xlsx",
    "月度经营数据 10月与11月新增付费、续费率对比",
    "## Sheet: 月度\n指标 10月 11月\n新增付费 120 138\n续费率 81% 84%\n## Sheet: 渠道\n渠道 新增\n小红书 52\n公众号 31",
  ],
  [
    "业务知识/定价/会员定价方案-2026-10-12.docx",
    "会员定价方案 定价评审 三档价格与早鸟买断",
    "# 价格档位\n基础版免费；专业版每月 29.9 元；团队版每人每月 49 元。\n# 早鸟买断\n早鸟买断 299 元，名额 500 个，售完即止。",
  ],
  [
    "项目资料/知识库项目/知识库实现方案-2026-11-27.md",
    "知识库实现方案 研发 文件夹、索引、整理与检索的做法",
    "# 核心决定\n知识库是一个普通文件夹，文件保持原格式。\n# 检索\n每个文件的正文按页和标题存成段落，全文检索后把片段和位置交给智能体。",
  ],
  [
    "项目资料/知识库项目/知识库评审会议纪要-2026-11-26.md",
    "知识库评审会议纪要 参会人 评审结论与待办",
    "# 结论\n第一版不做向量检索，先用全文检索加测试题验证。\n# 待办\n方哥：准备 30 道测试题；研发：周五前给出命中率。",
  ],
  [
    "个人知识/阅读笔记/被讨厌的勇气读书笔记-2026-11-27.md",
    "被讨厌的勇气读书笔记 个人 课题分离等要点",
    "# 课题分离\n别人怎么看我是别人的课题，我只管自己的选择。\n# 目的论\n人不是被过去的原因推着走，而是为了现在的目的在行动。",
  ],
  [
    "个人知识/方法/周报写法-2026-09-02.md",
    "周报写法 个人 先结论后过程的模板",
    "# 模板\n先写结论和影响，再写做了什么，最后写下周计划和需要的支持。",
  ],
];

const QUESTIONS: ReadonlyArray<readonly [question: string, file: string, location?: string]> = [
  ["给技术评审的那版Q4汇报", "Q4产品季度汇报-技术评审版-2026-11-27.pptx"],
  ["早会上讲的季度汇报", "Q4产品季度汇报-早会版-2026-11-25.pptx"],
  ["架构改了什么", "Q4产品季度汇报-技术评审版-2026-11-27.pptx", "第 7 页"],
  ["这次迁移有什么风险", "Q4产品季度汇报-技术评审版-2026-11-27.pptx", "第 8 页"],
  ["下季度目标是什么", "Q4产品季度汇报-早会版-2026-11-25.pptx", "第 4 页"],
  ["自动续费失败了怎么处理", "续费失败处理口径-2026-11-20.md"],
  ["用户怎么手动续费", "续费失败处理口径-2026-11-20.md", "手动续费"],
  ["小红书渠道带来多少新增", "月度经营数据-2026-11-27.xlsx", "工作表 渠道"],
  ["10月的续费率", "月度经营数据-2026-11-27.xlsx", "工作表 月度"],
  ["专业版多少钱一个月", "会员定价方案-2026-10-12.docx", "价格档位"],
  ["早鸟买断的价格和名额", "会员定价方案-2026-10-12.docx", "早鸟买断"],
  ["团队版定价", "会员定价方案-2026-10-12.docx"],
  ["知识库为什么不做向量检索", "知识库评审会议纪要-2026-11-26.md", "结论"],
  ["评审会后我有什么待办", "知识库评审会议纪要-2026-11-26.md", "待办"],
  ["知识库的检索是怎么实现的", "知识库实现方案-2026-11-27.md", "检索"],
  ["课题分离是什么意思", "被讨厌的勇气读书笔记-2026-11-27.md", "课题分离"],
  ["目的论讲的是什么", "被讨厌的勇气读书笔记-2026-11-27.md", "目的论"],
  ["周报应该怎么写", "周报写法-2026-09-02.md"],
  ["回滚预案在哪", "Q4产品季度汇报-技术评审版-2026-11-27.pptx", "第 8 页"],
  ["公众号新增用户数", "月度经营数据-2026-11-27.xlsx", "工作表 渠道"],
];

it("finds the right file, and the right place in it, for questions asked in plain words", () => {
  const index = openKnowledgeIndex(":memory:");
  for (const [path, summary, text] of CORPUS) index.put({ path, stamp: "1" }, summary, text);
  let fileTop3 = 0;
  let placeTop3 = 0;
  let placeAsked = 0;
  const misses: Array<string> = [];
  for (const [question, file, location] of QUESTIONS) {
    const hits = index.search(question, 3, null);
    const inFile = hits.filter((hit) => hit.path.endsWith(`/${file}`));
    if (inFile.length > 0) fileTop3++;
    else misses.push(question);
    if (location !== undefined) {
      placeAsked++;
      if (inFile.some((hit) => hit.location === location)) placeTop3++;
      else misses.push(`${question}（位置）`);
    }
  }
  index.close();
  // Every question finds its file and its place today; a miss here names the question.
  assert.deepStrictEqual(misses, []);
  assert.strictEqual(fileTop3, QUESTIONS.length);
  assert.strictEqual(placeTop3, placeAsked);
});

// Things a person might ask that this knowledge base says nothing about. Each shares a common
// word with some file; returning that file would invite a made-up answer.
const UNANSWERABLE = [
  "海外市场的定价策略",
  "员工报销流程是什么",
  "2025 年的年度预算",
  "竞品分析的结论",
  "安卓客户端的发版计划",
  "服务器宕机的应急预案",
];

it("returns nothing when the knowledge base does not cover the question", () => {
  const index = openKnowledgeIndex(":memory:");
  for (const [path, summary, text] of CORPUS) index.put({ path, stamp: "1" }, summary, text);
  const answered = UNANSWERABLE.filter((question) => index.search(question, 3, null).length > 0);
  index.close();
  assert.deepStrictEqual(answered, []);
});

it("searches only the categories it is given and forgets files that are gone", () => {
  const index = openKnowledgeIndex(":memory:");
  for (const [path, summary, text] of CORPUS) index.put({ path, stamp: "1" }, summary, text);
  assert.isTrue(
    index.search("续费率", 5, ["个人知识"]).every((hit) => hit.path.startsWith("个人知识/")),
  );
  index.keepOnly([CORPUS[0]![0]]);
  assert.deepStrictEqual(index.search("课题分离", 3, null), []);
  assert.strictEqual(index.stale([{ path: CORPUS[0]![0], stamp: "2" }]).length, 1);
  index.put(
    { path: CORPUS[0]![0], stamp: "2" },
    "改过的概要",
    "## Slide 1\n全新内容：灰度发布计划",
  );
  assert.strictEqual(index.search("灰度发布", 3, null)[0]?.location, "第 1 页");
  assert.deepStrictEqual(index.search("回滚预案", 3, null), []);
  index.close();
});
