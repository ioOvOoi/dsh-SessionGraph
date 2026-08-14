# 地图 — SessionGraph:DSH 实时会话图谱插件

标签:`wayfinder:map`

## Destination

一个**可运行的 DSH 动态插件原型**:把当前会话实时渲染成**横向时间线 + 分支图谱**(叠加面板,作为 `conversation.view` 的新视图 tab),节点 = 每条消息 + 每次 agent 切换;支持 **Pi /tree 式同会话跳转**(游标移到历史节点,新消息从那里长出新分支,旧分支保留);节点详情 = 全文 + 元数据;按 agent 分组可折叠;视觉跟随 DSH 主题。**验收标准 = 完整演示路径**:新会话聊几轮 → 图谱实时长节点 → 跳转到历史点继续 → 分支出现且当前路径高亮 → 再聊几轮。

## Notes

- **领域**:DSH(DeepSeek Harness)动态 Cordis 插件(Host + Client 双半)。Host 负责事件监听、数据模型、跳转的会话写入;Client 负责图谱渲染与交互。
- **技能**:每个会话先加载 `cordis-plugin-development`、`prototype`(布局/交互类)、`grilling` + `domain-modeling`(HITL 决策)。
- **HITL 纪律**:本图大量决策必须由用户本人拍板(演示/分享目标下的视觉与交互取舍)。agent 不得替用户选。
- **平台事实**以 `research-dsh-platform.md` 为准,查证后再写代码,禁止猜测 DSH API。
- **参考实现**:DSH 自带 `ui-trajectory` 插件已占据 `conversation.view` 环(chat/trajectory/waterfall tab),是叠加面板的现成范式,实现前先读它。
- **决策已定型**(grilling 产出):目的地=可运行原型;核心=会话树/图谱可视化;粒度=消息节点+agent切换特殊节点;范围=单会话树;交互=同会话跳转(非 fork);布局=横向时间线+分支;详情=全文+元数据;UI=先叠加面板(究极版图谱即主界面);验收=完整演示路径;用户=演示/分享;折叠=按 agent 分组;视觉=跟随主题。
- 术语与已定决策见仓库 `CONTEXT.md`(与本节保持同步)。

## Decisions so far

<!-- 每解一个 ticket,在此追加一行:gist + 链接 -->

## Not yet specified

- **上下文压缩 → 无限上下文**:跳过的分支如何压成摘要、何时触发、摘要放哪——等数据模型(01)落地后才能提出具体问题。
- **子 agent 全局会话图谱**:主会话与子 agent 会话互相引用的跨会话图(用户愿景"sessiongraph 循环")——依赖事件接入看清子 agent 数据形态。
- **图谱即主界面**:替换 `conversation.session` 整栏的究极版——依赖渲染引擎成熟。
- **多会话切换查看**:查看非当前会话的树——依赖单会话版定型。
- **力导向图布局**:Obsidian 双链式自由布局——依赖横向时间线版定型。

## Out of scope

<!-- 被判定超出目的地的已关闭 ticket 记录于此,永不升级 -->
