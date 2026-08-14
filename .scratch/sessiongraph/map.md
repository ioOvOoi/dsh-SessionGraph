# 地图 — SessionGraph:DSH 实时会话图谱插件

标签:`wayfinder:map`

> 规范追踪器已迁至 GitHub:[地图 #6](https://github.com/ioOvOoi/dsh-SessionGraph/issues/6),其下为决策票(#7-#11)与实现票(#1-#5)。本文件为仓库内镜像。

## Destination

一个**可运行的 DSH 动态插件原型**:把当前会话实时渲染成**竖排脊柱图谱**(常驻右侧边栏 `shell.overlay`,已删除 `conversation.view` tab),节点 = 每条消息 + 每次 agent 切换;支持 **Pi /tree 式同会话跳转**(点击节点滚动定位到聊天对应消息);只显示用户/助手**自然语音**(工具/上下文默认隐藏,头部开关可开);旧回合自动折叠、可展开;视觉跟随 DSH 主题。**验收标准 = 完整演示路径**:新会话聊几轮 → 侧边栏图谱实时长节点 → 点击历史节点跳转回聊天 → 再聊几轮。

## Notes

- **领域**:DSH(DeepSeek Harness)动态 Cordis 插件(Host + Client 双半)。Host 负责事件监听、数据模型、跳转的会话写入;Client 负责图谱渲染与交互。
- **技能**:每个会话先加载 `cordis-plugin-development`、`prototype`(布局/交互类)、`grilling` + `domain-modeling`(HITL 决策)。
- **HITL 纪律**:本图大量决策必须由用户本人拍板(演示/分享目标下的视觉与交互取舍)。agent 不得替用户选。
- **平台事实**以 `research-dsh-platform.md` 为准,查证后再写代码,禁止猜测 DSH API。
- **参考实现**:DSH 自带 `ui-trajectory` 插件已占据 `conversation.view` 环(chat/trajectory/waterfall tab),是叠加面板的现成范式,实现前先读它。
- **决策已定型**(grilling 产出):目的地=可运行原型;核心=会话树/图谱可视化;粒度=消息节点+agent切换特殊节点;范围=单会话树;交互=同会话跳转(非 fork);布局=力导向图谱;详情=全文+元数据;UI=先叠加面板(究极版图谱即主界面);验收=完整演示路径;用户=演示/分享;折叠=按 agent 分组;视觉=跟随主题;**图谱视觉完全复刻 aihero.dev 交互式力导向知识图谱(灰阶圆节点+选中辐射连线+右侧详情面板+纸张纹理背景,见 04 号 ticket 与 `docs/aihero-graph-visual-spec.md`)**。
- 术语与已定决策见仓库 `CONTEXT.md`(与本节保持同步)。

## Decisions so far

- [03-实时事件接入](https://github.com/ioOvOoi/dsh-SessionGraph/issues/9) — 事件接入方案已定:Host 监听 `session/event`(唯一消息增补流,event.type 判别)+ session/created|disposed + subagent/start|end;反查 traceSession/listEvents;Client 经 sessionProjections/useProjection 消费。研究资产:`docs/dsh-host-event-system-research.md`、`research-dsh-platform.md`。
- [01-会话图谱数据模型](https://github.com/ioOvOoi/dsh-SessionGraph/issues/7) — 节点分类对齐 trajectory:USER/CONTEXT/ASSISTANT/TOOL(独立轻节点)/TURN(轻节点);agent 切换节点 = subagent/start|end 与子会话首节点合并,父→子边;parentId = 日志前驱;宿主 = sessionProjections(按会话分区,dispose 保留);游标 = activeCursor 字段;冷启动 = 增量 readFrom + 全量兜底。**注:Q1 已修订(2026-08)——TOOL/TURN 从折叠元数据升级为独立轻节点**。
- [02-跳转语义与会话写入](https://github.com/ioOvOoi/dsh-SessionGraph/issues/8) — B1:跳转时对被放弃分支段执行 compaction 式 replace 遮蔽,旧分支不进模型上下文、图上显示遮蔽态;确认交互 = 详情面板"跳转到此"。
- [04-图谱渲染引擎](https://github.com/ioOvOoi/dsh-SessionGraph/issues/10) — 纯 SVG 自绘;横向时间线 + 分支上下展开 + 当前路径高亮 + 按 agent 折叠 + 生长动画;长会话性能策略延后(fog)。
- [05-面板与交互设计](https://github.com/ioOvOoi/dsh-SessionGraph/issues/11) — conversation.view 新增 graph tab;右滑详情面板(全文 + 元数据,aihero 风格,主题跟随);跳转确认 = 面板内按钮。**注:Q2 已修订(2026-08)——删除 conversation.view tab;完整图谱(缩放/平移/折叠/定位/全图/工具开关)整体迁移至右侧边栏(shell.overlay,轮询 sessiongraph.get 全量节点);点击节点 = 跳转聊天对应消息(锚点 + 闪烁)**。

## Not yet specified

- **自动压缩 → 无限上下文**:机制已现成(compaction 的 replace 遮蔽,原事件保留可读);远景 fog = 压缩策略(何时自动触发、摘要粒度、被遮蔽分支的展示)。T02 的 B1 方案(跳转时遮蔽)是它的最小形态,先落地 B1,策略问题随之可提出。
- **子 agent 全局会话图谱**:数据已现成(header parentSession + traceSession + listDescendants,每个子 agent 是自己的会话);远景 fog = 跨会话渲染与交互(用户愿景"sessiongraph 循环")。依赖 T04 渲染引擎成熟。
- **图谱即主界面**:替换 `conversation.session` 整栏的究极版——依赖渲染引擎成熟。
- **多会话切换查看**:查看非当前会话的树——依赖单会话版定型。
- **力导向图布局**:Obsidian 双链式自由布局——依赖横向时间线版定型。
- **长会话性能/虚拟化**:节点量级与虚拟化策略——依赖原型(演示规模)实测后提出。

## Out of scope

<!-- 被判定超出目的地的已关闭 ticket 记录于此,永不升级 -->
