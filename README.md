<p align="center">
  <img src="./assets/prod/t3-black-web-icon-192x192.png" width="80" height="80" alt="VibeBoss" />
</p>

<h1 align="center">VibeBoss</h1>

<p align="center">给产品经理用的 AI 编程桌面应用：在一个窗口里指挥 Claude、Codex、Antigravity 三家智能体一起干活。</p>

VibeBoss 基于开源项目 [T3 Code](https://github.com/pingdotgg/t3code)（MIT）魔改而来，并持续合并 T3 的更新。T3 Code 面向开发者，功能多、设置多；VibeBoss 把它改成不写代码的人也能上手的样子。

## 和 T3 Code 有什么不同

- **只留三家智能体**：Claude、Codex、Antigravity（Agy）。其他智能体和开发者才用得到的设置页都藏起来了。
- **中文优先**：默认中文界面。
- **分工与规则**：设一个主控智能体和若干有名字的成员，统一管理各家的全局规则、技能、MCP 和插件。
- **一键登录**：Claude 显示“未认证”时，直接在设置页里登录，不用自己开终端。
- **用量一眼看**：Claude、Agy 的额度都显示在用量页；Agy 的登录过期后会自动续上。
- **会话按项目整理**：侧边栏按项目分组，可以拆成“项目 / 会话”双栏，会话能自建分区。
- **本地版**：不接 T3 的云服务，遥测默认关闭。
- **桌面端**：提供 Mac（苹果芯片）和 Windows 安装包。

每一项改了哪里、为什么改，都记在 [docs/更新](./docs/更新/2026-11-24-VibeBoss-M1魔改范围.md)。

## 安装

安装包暂时没有正式签名，第一次打开会有安全提示：

- **Mac**：打开一次被拦后，到“系统设置 → 隐私与安全性”点“仍要打开”。如果提示“已损坏”，在终端运行 `xattr -cr /Applications/VibeBoss.app`。
- **Windows**：提示“已保护你的电脑”时，点“更多信息 → 仍要运行”。

## 自己打包

需要 Node 26 和 [Vite+](https://viteplus.dev)（`vp`）。

```bash
vp install
# Mac（苹果芯片）
VIBEBOSS_SKIP_APPLE_SPEECH=true node scripts/build-desktop-artifact.ts --platform mac --target dmg --arch arm64
```

Windows 安装包在 GitHub Actions 的 “VibeBoss Windows” 流程里打。

## 跟进 T3 更新

仓库不会自动同步 T3，需要定期手动合并：

```bash
git remote add upstream https://github.com/pingdotgg/t3code.git
git fetch upstream && git merge upstream/main
vp run vibeboss:rebrand
```

合并时要注意的地方见 [docs/更新](./docs/更新/2026-11-24-VibeBoss-M1魔改范围.md) 里各节的“上游注意”。

## 许可证

[MIT](./LICENSE)。保留 T3 Code 原作者的版权声明。
