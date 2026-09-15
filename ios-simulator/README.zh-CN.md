# iOS Simulator Manual 迁移

插件 `1.1.4` 使用 Manifest v3，以 `iosSimulator: true` 声明能力，并将完整工作流说明
从用户级 Skill 贡献迁移为随包 Manual。不声明插件 tools、network、Node worker 或
额外权限。原来省略的 `kind` 仍归一化为 `chip`；身份、入口、图标、启动模式和四语言
目录文案保持原样。

## 最低 Cindy 版本

`minCindyVersion: 0.1.83` 是本 Draft PR 按目标填写的**暂定版本**，用于阻止旧客户端
收到这个仅含 Manual 的 release。PR 转为 Ready 前，必须确认 v0.1.83 已作为 Cindy
正式稳定版发布、包含下述 Host 改动，并完成本文所列生产验证。如果首个满足条件的
稳定版不是 0.1.83，应把 `minCindyVersion` 改为实际版本，不能直接发布 Draft 暂定值。

- [Cindy v0.1.64](https://github.com/makecindy/cindy/releases/tag/v0.1.64) 是首个支持
  Manifest v3 的稳定版；其 manifest 契约支持 `iosSimulator` 与 `manual`，但这本身
  不能让无 tools 的 Manual 插件被发现。
- 2026-09-15 核实时，最新稳定版仍为
  [v0.1.79](https://github.com/makecindy/cindy/releases/tag/v0.1.79)。其
  [Ghost 集成](https://github.com/makecindy/cindy/blob/abcf92c2b34e99209e505662a3fe4e11868e8aa1/apps/desktop/src/main/mcp-integrations/ghost.ts)
  仍通过 `ghostHasTools` 限制 `visibleChipGhosts` 和 `readGhostManual`。
- Cindy [PR #4440](https://github.com/makecindy/cindy/pull/4440) 已修复无 tools Manual
  的发现和读取，并于 2026-09-15 以
  `b201f1f663a1199c1e296ee0b6ddca7d465d4e9d` 合入 `main`。它允许花名册、
  `ghost_info` 和 `ghost_manual` 访问，同时仍拒绝对无 tools 插件执行 `ghost_call`。
  代码合入本身不等于正式稳定版已经发布。

低于声明最低版本的客户端会继续从市场获得最新兼容的历史 release；该历史 release
仍包含 Skill，因此新包不需要保留过渡副本。本包删除 `skill` 声明和 `skills/` 目录，
在兼容 Host 上只通过 Manual 提供说明。

## Manual 结构

`manual.items` 是轻量一级索引。通过
`ghost_manual({ ghost_id: "ios-simulator", path: "ios-simulator" })` 读取主流程。
`manual/ios-simulator/MANUAL.md` 以完整逻辑路径直达 `build-and-run.md` 和
`external-fallback.md`。各页均为无 Skill frontmatter 的普通 Markdown。实时工具契约
仍由 `cindy_ios_simulator` 目录提供；不得为插件伪造 `ghost_call` 工具。目录本地化
契约没有 Manual 翻译字段；zh-CN/en/ja/ko 原有目录文案保持不变，操作 Manual 使用英文。

## 验证门槛

Draft 转为 Ready 前，必须在运行稳定版 Cindy v0.1.83 或更高版本的实际设备上安装
精确打包的 `.cindy`，并验证：

- 已安装并启用的插件出现在花名册和 `ghost_info`。
- `ghost_manual` 可以读取入口和两个子页面。
- 插件没有 tools，`ghost_call` 仍会拒绝调用。
- 没有用户级 Skill 贡献时，Host 托管的模拟器核心工作流仍可使用。

在仓库根目录运行四个仓库门禁、`.tests/ios-simulator.test.mjs`，以及
`node scripts/validate-plugin-manifest.mjs ./ios-simulator`。仓库打包器从已提交的
`HEAD` 生成产物；安装前应检查归档内容。静态检查和 Draft 打包不能证明生产运行情况。
在正式稳定版和实机验证可用前，PR 的 Production Cindy verification 必须保持未勾选。
