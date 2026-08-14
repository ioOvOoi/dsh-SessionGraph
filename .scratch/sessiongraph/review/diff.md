# 审查范围:动态插件 sgraph-1,pkg-36 → pkg-59(固定点)

**注意**:该插件的代码不在 git 提交里(仓库 git 历史只有文档提交)。代码以动态 Cordis 插件包形式存在,通过 `cordis_inspect_self(pluginId='sgraph-1', packageId='pkg-N')` 检视。本次审查的"变更"= pkg-36(基线,图谱 tab 尚存)到 pkg-59(当前运行包,run-48)的包演化,不是 git diff。

## 审查对象文件
- `.scratch/sessiongraph/review/pkg-59.client.js` — 当前包客户端源码(39KB)
- `.scratch/sessiongraph/review/pkg-59.host.js` — 当前包宿主源码(11KB)
- 基线 pkg-38(删除 tab 后、details 列迁移前的侧边栏轮询版)仅作演进参照,不逐行审查

## 变更历程(包演化)
| 包 | 变更 |
|---|---|
| pkg-36 | 基线:conversation.view tab 图谱 + 侧边栏迷你图谱 |
| pkg-37/38 | 删除 conversation.view 图谱 tab;完整图谱迁入 shell.overlay 侧边栏(轮询 RPC);RPC 扁平节点在 GraphView 入口 normalizeNode 归一化为 meta 结构 |
| pkg-39/40 | 迁移到真实 `details` 列(左对话右图谱);pkg-39 客户端-only 事故(host 丢失)→ pkg-40 恢复 host 半体 |
| pkg-41 | 修复跳转:投影节点字段在 meta 下,chatKeyOf 读 `n.meta||n` |
| pkg-42 | 跳转锚点扩展为完整映射表(user 消息 / tool-call / assistant-step / turn-tail) |
| pkg-43-45 | 全原子跳转:工具、委派(switch 节点)、回合都跳转到对应聊天位置 |
| pkg-46/47 | Obsidian 式布局:横向重力编织(非直上直下)、边常显;工具原子常显(去掉按钮切换) |
| pkg-48 | 移除 SVG 双击进入全图模式 |
| pkg-49/50 | 修复悬停抖动:原子边缘透明命中圈(可见圆外 r+10 透明圆) |
| pkg-51/52 | 用户轮次折叠分组(roundOf/turnRound/roundSnippet + roundKey);修复折叠后点不开(toggleFold 翻转生效态) |
| pkg-53/54 | 拖拽卡顿修复:React.memo(GraphView, 比较 sessionId/base/cursor) + ResizeObserver 150ms 节流 |
| pkg-55/56 | 收起=layout.closeDetails() 释放列宽 + SlimOverlay 精简时间线(纯圆点、点击跳转) |
| pkg-57 | 窄条贴最右侧(right:0 固定),加时间线、更清晰点色 |
| pkg-58/59 | SlimOverlay 由 `[data-details-collapsed]` 轮询驱动(400ms),不再依赖事件总线;面板壳照抄左侧栏形式 |

## 当前架构(供审查对照)
- **Host**:switchRuns 映射(subagent/start|end 事件 → 父子委派关系);toolDescCache 工具描述缓存;RPC `sessiongraph.switches` / `sessiongraph.toolinfo` / `sessiongraph.get`;投影单元 `sessiongraph.graph`(v5);调试工具 `sessiongraph_debug`。
- **Client**:`GraphView`(details 列全量图,React.memo 化)— SVG 绝对坐标缩放模型、Obsidian 横向编织布局(lateral(n,r) 伪随机横向偏移、工具扇形展开)、用户轮次折叠、滚轮缩放/平移/拖拽;`SlimOverlay`(shell.overlay 精简条)— 轮询 `[data-details-collapsed]` 决定显隐,轮询 `sessiongraph.get` 取数据,点击圆点跳转,点击空白/⟨ 展开面板;`GraphPanel`(details 槽位)— useProjection('sessiongraph.graph')。
- 常量:details 列 300-520px 由宿主 computeColumns 钳制;折叠语义 = layout.closeDetails()(释放对话区宽度)。
