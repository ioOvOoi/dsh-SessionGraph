# T5 现状代码对照 — pkg-62 精确位置清单

> 基于 `review/pkg-62.host.js`(290 行) + `review/pkg-62.client.js`(906 行)
> 目标:列出「同会话跳转切枝 + B1 上下文隔离」需要接入/修改的精确位置

---

## 1. 跳转链路现状

### 1.1 keyOfNode 锚点表 — 6 类原子到聊天锚点的映射

**文件**: `pkg-62.client.js` **函数**: `keyOfNode(n, items)` **行**: L158–169

| 节点 category | 返回锚点 key 格式 | 说明 |
|---|---|---|
| `user` / `context` | `'12:input-message' + n.id` | 匹配 DSH 聊天 DOM 的 `data-chat-anchor-key` |
| `assistant`（有 step） | `'14:assistant-step' + meta.turn + ':' + meta.step` | 精确到助手消息的 step 粒度 |
| `assistant`（无 step） | 回退到 `turnKey(meta.turn, items)` | 取该 turn 内第一个 user/context 节点的锚点 |
| `tool` | `'9:tool-call' + meta.callId` | 工具调用节点 |
| `switch` | `'9:tool-call' + meta.callId` | 委派节点（映射到触发工具调用的锚点） |
| `turn` | `turnKey(meta.turn, items)` | 回合边界（映射到回合首条消息的锚点） |

**辅助函数**:
- `turnKey(t, items)` — L143–157：先尝试 `'9:turn-tail' + turn` 是否存在于 DOM，否则在 items 中查找该 turn 的第一个 user/context/assistant 节点
- `mOf(n)` — L142：快速取 `n.meta`

### 1.2 scrollToKey / jumpNode — 跳转执行

| 函数 | 行号 | 行为 |
|---|---|---|
| `scrollToKey(key)` | L170–180 | querySelector 找 `[data-chat-anchor-key="..."]` → `scrollIntoView({behavior:'smooth',block:'center'})` → 移除/重加 `sg-jump-flash` class 触发 CSS 动画 → 1700ms 后清除 |
| `jumpNode(n, items)` | L181 | `scrollToKey(keyOfNode(n, items))` — 纯 DOM 滚动，**不修改任何会话/投影状态** |

### 1.3 各原子 onClick 行为

**文件**: `pkg-62.client.js` **组件**: `GraphView` (L304–793)

| 原子 category | onClick 行号 | 操作 |
|---|---|---|
| `turn`（折叠态） | L624 | `toggleFold(rk); jumpNode(n, items)` |
| `turn`（展开态） | L637 | `toggleFold(rk); jumpNode(n, items)` |
| `switch` | L651 | `setSelectedId(n.id); jumpNode(n, items)` |
| `tool` | L665 | `setSelectedId(n.id); jumpNode(n, items)` |
| `user` / `context` / `assistant` | L687 | `setSelectedId(n.id); setPulseKey(k+1); jumpNode(n, items)` |

**关键观察**：
- 所有原子点击 = **先设 selectedId + 跳动画 + DOM 滚动**，零确认、零状态修改
- `pulseKey`（L315）仅控制脉冲动画重触发（自增计数器），不影响投影
- `selectedId`（L307）控制选中高亮（CSS `sg-pulse` ring），不影响投影

### 1.4 SlimOverlay 点击跳转

**文件**: `pkg-62.client.js` **组件**: `SlimOverlay` (L809–871)

- L864: dot `onClick` → `e.stopPropagation(); jumpNode(n, items)` — 与完整图谱共享同一跳转逻辑
- 数据来源：独立 RPC `sessiongraph.get` (L831) + 轮询 `POLL.DATA_MS = 1000ms`

---

## 2. 投影数据模型

### 2.1 节点种类与 meta 字段全集

**文件**: `pkg-62.host.js` **注册**: L137–232 `sp.register({key: 'sessiongraph.graph', ...})`

| category | 事件源 | id 格式 | meta 字段 |
|---|---|---|---|
| `turn` | `turn/start` | `'turn-' + turn` | `{turn, turnEnd: null → {reason}}` |
| `user` | `user/message` (source.kind='user') | `event.data.id` (UUID) | `{turn, sourceKind, plugin}` |
| `context` | `user/message` (source.kind≠'user') | `event.data.id` (UUID) | `{turn, sourceKind, plugin}` |
| `assistant` | `assistant/message` | `event.data.id` (UUID) | `{turn, step, usage, think}` |
| `tool` | `tool/call` | `'tool-' + callId` | `{turn, step, callId, name, result, error}` |
| `switch` | 无直接事件源 | `'sw-' + runId` (Client 构造) | `{childId, provider, stopReason, runId, callId}` |

**每个节点共有字段**: `{id, seq, time, category, text, meta}`

### 2.2 cursor 语义

**文件**: `pkg-62.host.js` **apply 函数**:

| 事件 | cursor 更新逻辑 | 行号 |
|---|---|---|
| `turn/start` | `cursor = node.id`（新 turn 节点的 id） | L153 |
| `user/message` | `cursor = node.id`（新 user/context 节点的 id） | L181 |
| `assistant/message` | `cursor = node.id`（新 assistant 节点的 id） | L195 |
| `tool/call` | `cursor = node.id`（新 tool 节点的 id） | L206 |
| `turn/end` | **不更新 cursor** | L163 |
| `tool/result` | **不更新 cursor**（只更新已有 tool 节点的 meta） | L224 |

**规律**: cursor 始终指向**最后一个新创建的节点**，即会话时间线的最新叶子。`turn/end` 和 `tool/result` 是就地修改已有节点，不产生新节点，因此不动 cursor。

### 2.3 turn 模型

**状态字段**:
- `currentTurn` — 当前回合号（`turn/start` 时设为 `event.data.turn`，L153）
- 每个节点的 `meta.turn` — 该节点所属回合号

**Client 侧回合推导**（`pkg-62.client.js`）:
- `turnRound` (L373–382): turn 节点 → 该回合首条 user 消息的 id
- `roundOf` (L360–371): 每个非 turn 节点 → 所属的 user 消息 id（折叠的 key）
- `roundsInOrder` (L359): 用户消息 id 数组，按出现顺序
- `defaultFoldForKey` (L384–392): 除最后 `FOLD_KEEP=2` 轮外，其余默认折叠

### 2.4 view 输出形状

**文件**: `pkg-62.host.js` L231:
```js
view: (state) => ({ nodes: state.nodes, cursor: state.cursor })
```

**Client 消费** (`pkg-62.client.js` L875–877):
```js
const graph = useProjection('sessiongraph.graph')
const base = graph && Array.isArray(graph.nodes) ? graph.nodes : []
const cursor = graph ? graph.cursor : null
```

**传入 GraphView**: `{sessionId, base, cursor, onCollapse}` (L885–893)

### 2.5 纯展示确认

**已确认**:投影 apply 从不修改会话状态（messages/session/compaction），只维护 `{nodes, cursor, currentTurn}`。跳转（jumpNode）是纯 DOM 滚动。**整个 pkg-62 是零副作用的只读投影 + 只读跳转**。

---

## 3. T5 接入缝 — 切 active + 遮蔽

### 3.1 Host 端

#### 3.1.1 新增 RPC: `sessiongraph.jump`

**文件**: `pkg-62.host.js` **插入位置**: L95 之后（现有 RPC 末尾）

**需实现**:
```
harness.handle('sessiongraph.jump', async (args) => {
  // args: { sessionId, targetNodeId }
  // 1. 查找 targetNode 在投影 state.nodes 中的位置
  // 2. 收集 cursor → targetNode 之间「被放弃分支」的节点段
  // 3. 对该段执行 compaction 式 replace 遮蔽
  // 4. 更新 state.cursor = targetNodeId
  // 5. 返回 { ok, shadowedCount, newCursor }
})
```

**依赖**:
- `ctx.get('sessionProjections')` — 已有（L3）
- `ctx.get('sessions')` — 已有（隐含通过 sp.snapshot）
- **需要新的 compaction API 调用**：DSH 平台的 `compaction/start|summary|end` 事件写入（需确认 API 签名）

#### 3.1.2 新增事件监听: `compaction/*`

**文件**: `pkg-62.host.js` **插入位置**: L63 之后（现有事件监听区）

**需要监听**:
- `compaction/start` — 记录遮蔽操作开始
- `compaction/summary` — 遮蔽摘要写入
- `compaction/end` — 遮蔽完成

用于在投影状态中标记节点被遮蔽（见 3.1.3）。

#### 3.1.3 投影 apply 需要新增的事件类型或字段

**文件**: `pkg-62.host.js` **apply 函数** (L142–229)

**需要新增的字段**:
- `node.meta.shadowed: boolean` — 节点是否已被 compaction 式 replace 遮蔽
- `node.meta.shadowSummary: string | null` — 遮蔽摘要文本
- `node.meta.branchOwner: string | null` — 节点所属分支的标识（当前游标 id 或父游标 id）

**需要新增的事件处理**:
- `compaction/start` 或新的 `sessiongraph/shadow` 事件 → 批量标记 `shadowed = true` + 附加摘要
- 可选: `compaction/end` → 更新摘要

**view 输出需扩展**:
```js
// 现状
view: (state) => ({ nodes: state.nodes, cursor: state.cursor })
// T5 后
view: (state) => ({
  nodes: state.nodes,
  cursor: state.cursor,
  shadowedIds: state.shadowedIds || [],  // 新增：被遮蔽节点 id 列表
})
```

#### 3.1.4 遮蔽标记的数据流

```
用户点击 → RPC sessiongraph.jump
  → Host 查找目标节点位置
  → 计算「游标到目标」的路径段
  → 对路径段外的分支节点 → 执行 compaction（调用 DSH 平台 API）
  → 更新 state: 被遮蔽节点 meta.shadowed=true + meta.shadowSummary=摘要
  → 投影 onChanged → Client 重渲染
```

### 3.2 Client 端

#### 3.2.1 交互挂在哪个组件/原子类型

**当前点击入口汇总**（全部在 `GraphView` 组件内，L304–793）:

| 原子类型 | onClick 行号 | 当前行为 | T5 需改为 |
|---|---|---|---|
| `user` / `context` / `assistant` | L687 | `setSelectedId + setPulseKey + jumpNode` | **新增确认弹窗** → 确认后 RPC `sessiongraph.jump` |
| `tool` | L665 | `setSelectedId + jumpNode` | **新增确认弹窗**（或仅选中 + 显示详情面板中的"跳转到此"按钮） |
| `switch` | L651 | `setSelectedId + jumpNode` | **新增确认弹窗** |
| `turn` | L624/L637 | `toggleFold + jumpNode` | 保持折叠切换 + **新增"跳转到此"按钮**（非直接点击跳转） |
| SlimOverlay dot | L864 | `jumpNode` | **新增确认弹窗** 或 **移除跳转**（仅展开图谱后操作） |

**决策依据**（02 号票 grilling 结论）:
> "详情面板'跳转到此'按钮 → 确认 → 切 activeCursor"

**实现方案**:
- 点击节点 → 选中 + 在右侧详情面板（需新增或复用）显示"跳转到此"按钮
- 按钮 click → 确认弹窗（`confirm()` 或自定义 modal） → RPC `sessiongraph.jump`
- **不再是"点击即跳转"**，而是"点击即选中 + 面板操作"

#### 3.2.2 切枝后视图刷新依赖

**文件**: `pkg-62.client.js` L796:
```js
const GraphViewMemo = React.memo(GraphView, (a, b) =>
  a.sessionId === b.sessionId && a.base === b.base && a.cursor === b.cursor
)
```

**分析**:
- `base` 来自 `useProjection('sessiongraph.graph').nodes` — **引用比较**（L876）
- 切枝后，Host 投影 state.nodes 产生新数组（因为 apply 返回新对象），`useProjection` 推新引用
- `base` 引用变化 → `React.memo` 比较不等 → `GraphView` 重算
- **结论:现有 React.memo 比较器在切枝后足以触发重算**，因为 nodes 数组引用会变

**但需注意**:
- 如果切枝只修改了 `meta.shadowed` 字段（就地修改），需要确保 apply 返回新 nodes 数组
- 现有 apply 已是纯函数风格（`state.nodes.slice()`），T5 实现需保持这一模式

#### 3.2.3 遮蔽态的视觉渲染

**文件**: `pkg-62.client.js` **插入位置**: L603–704（节点渲染循环内）

**需要新增**:
```js
// 在 visible 过滤中（L413–418），shadowed 节点仍需显示但灰显
const visible = items.filter((n) => {
  if (n.category === 'turn') return true
  if (n.category === 'switch') return folded['sw-' + n.meta.runId] !== true
  const rk = roundOf[n.id]
  if (rk != null && effFoldKey(rk) === true) return false
  // T5: 不过滤 shadowed 节点，而是标记为灰显
  return true
})

// 在节点渲染中（L603+），shadowed 节点加 .sg-dim class
const isShadowed = n.meta && n.meta.shadowed
const dim = isShadowed || (focusId != null && n.id !== focusId && !neighborSet.has(n.id))
```

**CSS 需新增**:
```css
.sg-shadowed { opacity: 0.15; filter: grayscale(1); }
.sg-shadowed .sg-label { text-decoration: line-through; }
```

### 3.3 冲突点分析

#### 3.3.1 现有「点击即跳转」与「切枝需确认」的行为冲突

**冲突描述**:
- 现状: 所有原子点击 = `jumpNode(n, items)` = 即时 DOM 滚动（零确认）
- T5 需求: 跳转 = 切枝 + 遮蔽，需确认（02 号票: "详情面板'跳转到此'按钮 → 确认 → 切 activeCursor"）
- **冲突点**: 现有 `jumpNode` 调用分散在 6 处 onClick handler 中（L624, L637, L651, L665, L687, L864）

**解决方案**:
1. **保留** `jumpNode` 作为纯滚动（用于「定位」按钮，L765）
2. **重构** 所有 onClick: 点击 = `setSelectedId` + 显示详情面板
3. **新增** 详情面板中的"跳转到此"按钮 → 调用新的 `jumpToNode(n)` 函数
4. `jumpToNode` = 确认弹窗 + RPC `sessiongraph.jump`（替代现有 `jumpNode`）

**需修改的 onClick handler 数量**: 6 处

#### 3.3.2 折叠模型(roundOf)与新分支的关系

**冲突描述**:
- 现有 `roundOf` 映射: 每个节点 → 它所属的 user 消息 id（折叠的 key）
- 切枝后，新消息从目标节点长出，它们的 `roundOf` 映射取决于**新消息到达时的 apply 逻辑**
- **问题**: 切枝后新消息的 `meta.turn` 值如何设置？现有 `currentTurn` 是在 `turn/start` 时更新的

**分析**:
- DSH 的 turn 机制是会话级的（`turn/start` 事件携带 `turn` 号）
- 切枝不改变 DSH 的 turn 编号（新 turn 从 `currentTurn + 1` 继续）
- **Client 侧 roundOf** 是纯展示推导（L360–371），不依赖 Host 状态
- **结论:折叠模型与切枝无直接冲突**，但 `roundOf` 的 user 消息分组在切枝后可能不直观（新分支的节点可能属于同一个 round）

**潜在改进**:
- 切枝后，新消息的 roundOf 应以切枝点为新 round 的起点
- 需要 Host 侧在 apply 中记录 `branchPoint`（切枝发生的 node id）
- Client 侧 roundOf 推导需考虑 branchPoint

---

## 4. 数据流图

### 4.1 现状: 用户点击历史节点 → 聊天滚动

```
用户点击节点（GraphView onClick）
  → setSelectedId(nodeId)          // 选中态高亮
  → setPulseKey(k+1)               // 触发脉冲动画
  → jumpNode(n, items)             // 跳转执行
    → keyOfNode(n, items)          // 查找锚点 key
    → scrollToKey(key)             // DOM 滚动
      → document.querySelector('[data-chat-anchor-key="..."]')
      → el.scrollIntoView({behavior:'smooth', block:'center'})
      → el.classList.add('sg-jump-flash')  // 闪烁动画
      → 1700ms 后移除动画

数据流: Client 内部闭环，不涉及 Host/投影/会话状态
结果: 聊天视图滚动到对应消息，图谱节点高亮，零副作用
```

### 4.2 T5 后: 用户点击历史节点 → 切枝 + 遮蔽

```
用户点击节点（GraphView onClick）
  → setSelectedId(nodeId)          // 选中态高亮（保留）
  → 【不执行 jumpNode】            // 移除即时跳转
  → 右侧详情面板显示节点信息
    → 用户点击"跳转到此"按钮
    → 确认弹窗（"确定跳转？当前分支将被遮蔽"）
    → 用户确认
    → host.call('sessiongraph.jump', {sessionId, targetNodeId})
      ── Host 端 ──
      → 查找 targetNode 在 state.nodes 中的位置
      → 收集 cursor 到 targetNode 之间「被放弃分支」的节点
      → 调用 DSH compaction API: 对被放弃段执行 replace 遮蔽
        → 写入 compaction/start 事件
        → 写入 compaction/summary 事件（摘要）
        → 写入 compaction/end 事件
      → 更新 state.cursor = targetNodeId
      → 更新被遮蔽节点: meta.shadowed=true, meta.shadowSummary=摘要
      → 投影 onChanged → 触发 Client 重渲染
      ── Client 端 ──
      → useProjection 推新引用（base 变化）
      → React.memo 比较不等 → GraphView 重算
      → visible 过滤保留 shadowed 节点（灰显/折叠态）
      → 被遮蔽节点渲染为低透明度 + 灰度
      → 新消息到达时，从新 cursor 位置长出新分支
```

### 4.3 对比: 现状 vs T5 后

| 维度 | 现状 | T5 后 |
|---|---|---|
| 点击行为 | 即时 DOM 滚动 | 选中 + 面板操作 + 确认 |
| Host 交互 | 无 RPC 调用 | `sessiongraph.jump` RPC |
| 会话状态 | 零修改 | compaction 式 replace 遮蔽 |
| 投影 state | `{nodes, cursor}` 只增不改 | 新增 `shadowed` 标记 |
| cursor 含义 | 最新叶子节点 | 当前活跃分支末端（可回退） |
| 视觉反馈 | 滚动 + 闪烁 | 灰显 + 折叠 + 选中态 |
| 副作用 | 零 | 有（compaction 写入事件日志） |

---

## 5. 接入点清单表格

| # | 位置 | 现状 | T5 需改什么 |
|---|---|---|---|
| 1 | `host.js` L63 之后 | 仅监听 subagent/start\|end | **新增** compaction 事件监听（shadow 标记） |
| 2 | `host.js` L95 之后 | 仅 sessiongraph.switches/toolinfo/get | **新增** RPC `sessiongraph.jump`（切枝 + 遮蔽） |
| 3 | `host.js` L142–229 apply | 仅 append + cursor 跟随 | **扩展**: 新增 `compaction/*` 事件处理；node 新增 `meta.shadowed/meta.shadowSummary` |
| 4 | `host.js` L231 view | `{nodes, cursor}` | **扩展**: 输出新增 `shadowedIds` 或让 Client 从 meta 推导 |
| 5 | `client.js` L687 onClick (user/ctx/asst) | `setSelectedId + setPulseKey + jumpNode` | **移除** jumpNode 调用；**改为** 选中 + 面板显示（详情面板需新增） |
| 6 | `client.js` L665 onClick (tool) | `setSelectedId + jumpNode` | **移除** jumpNode 调用；**改为** 选中 + 面板显示 |
| 7 | `client.js` L651 onClick (switch) | `setSelectedId + jumpNode` | **移除** jumpNode 调用；**改为** 选中 + 面板显示 |
| 8 | `client.js` L624/L637 onClick (turn) | `toggleFold + jumpNode` | **保留** toggleFold；jumpNode 改为可选（或面板内按钮） |
| 9 | `client.js` L864 onClick (SlimOverlay) | `jumpNode` | **移除**直接跳转；改为展开图谱后操作 |
| 10 | `client.js` L413–418 visible 过滤 | 仅按 fold 过滤 | **扩展**: shadowed 节点不过滤，加灰显标记 |
| 11 | `client.js` L603–704 节点渲染 | 标准圆 + 高亮 | **新增**: shadowed 节点渲染低透明度 + 灰度 + 摘要标签 |
| 12 | `client.js` L796 React.memo 比较器 | `sessionId + base + cursor` | **确认**: base 引用变化足够触发重算（无需改） |
| 13 | `client.js` L304 GraphView | 无详情面板 | **新增**: 详情面板组件（节点信息 + "跳转到此"按钮） |
| 14 | `client.js` L170–181 scrollToKey/jumpNode | 纯 DOM 滚动 | **保留**作为"定位"功能；**新增** `confirmJumpToNode` 函数调用 RPC |
| 15 | `client.js` L360–371 roundOf 推导 | 按 user 消息分组 | **考虑**: 切枝后新 round 的起点（需 Host 提供 branchPoint） |
