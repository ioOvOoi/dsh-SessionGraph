# T5 Client 半体对抗性代码审查报告

> 审查员: 红队代码审阅员
> 审查对象: `pkg-64.client.js` (SessionGraph 插件 Client 半体, 新增 T5 交互原子 + 遮蔽折叠)
> 基线对照: `pkg-63.client.js` (现有功能)
> 审查日期: 2026-08-15

---

## 1. 审查摘要

对照设计文档 `t5-design.md` §2.2 Client 设计 + §3 HITL 决策、红队检查清单 `G-t5-redteam.md` 红线 2（交互原子必须阻止事件冒泡）、`H-t5-host-review.md` 的 Host 侧审查上下文，对 `pkg-64.client.js` 进行逐项对抗性审查。

### 问题清单表

| 级别 | 位置 | 一句话描述 |
|------|------|------------|
| 🔴 blocker | L590 | 全局 `setTimeout` 替代 `timer.timeout`——平台明确禁止动态 Client 使用全局定时器 |
| 🔴 blocker | L650, L655 | 全局 `setTimeout` 用于 jump 失败提示 2.5s 超时，无 `ctx.get('timer')` 守卫 |
| 🔴 high | L594, L639, L644, L662 等 | 全局 `clearTimeout` 清理定时器，应使用 `timer.timeout` 返回的 dispose 函数 |
| 🔴 high | L786-808 vs L897-902 | 拖拽 >4px 后 `onClick` 仍触发，弹出交互原子——drag 与 atomic 未隔离 |
| 🟡 medium | L588-591 | `ctx.get('timer')` 已调用但未用于 `timer.timeout`，守卫逻辑形同虚设 |
| 🟡 medium | L391 | `running` 判定纯 Client 侧投影状态，可能因投影延迟导致工具已完成但原子仍禁用 |
| 🟡 medium | L243-246 | shadowed 节点仍被 `segCount` 计数，折叠摘要显示的"N 条"包含不可见的遮蔽节点 |
| 🟡 medium | L931-938 | `onClickBg` 未清理 `jumpMsg` 和 `jumpMsgTimerRef`（功能正确但定时器泄漏） |
| 🟢 low | L590, L650, L655 | 魔法数字 3000、2500 未提常量 |
| 🟢 low | L57-63 | `jumpFailText` 未覆盖 host 可能返回的 `'surface-empty'` reason |
| 🟢 low | L1046 | SlimOverlay 圆点点击未阻止父层 `expand` 的冒泡（设计允许，但语义冗余） |

---

## 2. 逐项详细审查

### 2.1 定时器违规（Blocker）

#### 2.1.1 L590: 交互原子 3s 超时使用全局 `setTimeout`

```javascript
// L587-591
if (pendingJump) {
  const timer = ctx.get('timer')   // ← 拿到了 timer 服务
  if (timer) {
    pendingJumpTimerRef.current = setTimeout(() => { ... }, 3000)  // ← 但用了全局 setTimeout!
  }
}
```

**问题**: 代码调用了 `ctx.get('timer')` 并检查 `if (timer)`，但下一行直接调用全局 `setTimeout` 而非 `timer.timeout(callback, 3000)`。守卫逻辑形同虚设。

**违反红线**: 平台约束明确"动态 Client 禁止 setTimeout/setInterval 全局，必须用 `ctx.get('timer')` 的 timer.timeout/timer.interval"。

**严重级**: 🔴 Blocker

**建议**: 改为 `pendingJumpTimerRef.current = timer.timeout(() => { setPendingJump(null); pendingJumpTimerRef.current = null }, 3000)`，且 cleanup 使用 timer 返回的 dispose 而非 `clearTimeout`。

#### 2.1.2 L650, L655: jump 失败提示超时无 timer 守卫

```javascript
// L650
jumpMsgTimerRef.current = setTimeout(() => { setJumpMsg(null); jumpMsgTimerRef.current = null }, 2500)
// L655
jumpMsgTimerRef.current = setTimeout(() => { setJumpMsg(null); jumpMsgTimerRef.current = null }, 2500)
```

**问题**: 这两处连 `ctx.get('timer')` 都没调用，直接使用全局 `setTimeout`。且 `confirmJump` 是在运行时调用的函数，此时 `timer` 服务可用但未获取。

**严重级**: 🔴 Blocker

**建议**: 在 `confirmJump` 函数开头获取 `const timer = ctx.get('timer')`，使用 `timer.timeout()` 替代。

#### 2.1.3 全局 `clearTimeout` 清理（L369, L370, L584, L585, L594, L595, L639, L644, L662, L797, L799, L936）

**问题**: 所有清理逻辑都使用全局 `clearTimeout`。如果改用 `timer.timeout()`，清理应调用 `timer.timeout` 返回的 dispose 函数（与 `timer.interval` 类似）。当前代码如果改用 `timer.timeout` 但保留 `clearTimeout` 清理，两者不匹配——`timer.timeout` 可能不使用原生 `setTimeout`，`clearTimeout` 无法取消它。

**严重级**: 🔴 High（与 2.1.1/2.1.2 联动，修复定时器创建时必须同步修复清理）

#### 2.1.4 正确用法对照（pkg-64 自身的正面示例）

同文件中已有正确用法：
- L200: `timer.timeout(() => el.classList.remove('sg-jump-flash'), 1700)` — ✅ 正确使用 timer.timeout
- L514: `timer.timeout(fire, POLL.RESIZE_MS)` — ✅ 正确
- L1004: `timer.interval(check, POLL.COLLAPSED_MS)` — ✅ 正确
- L1019: `timer.interval(fetchData, POLL.DATA_MS)` — ✅ 正确

说明开发者了解 timer 服务的用法，但在新增 T5 代码中遗漏。

---

### 2.2 交互原子行为

#### 2.2.1 屏幕坐标→SVG 坐标转换（L802-804）

```javascript
const rect = svgRef.current ? svgRef.current.getBoundingClientRect() : null
const sx = rect ? (e.clientX - rect.left - (view ? view.tx : 0)) / (view ? view.z : 1) : p.x + r + 10
const sy = rect ? (e.clientY - rect.top - (view ? view.ty : 0)) / (view ? view.z : 1) : p.y + r + 10
```

与拖拽坐标的转换（L905-907）对比：
```javascript
const rect = svgRef.current.getBoundingClientRect()
const lx = (e.clientX - rect.left - view.tx) / view.z
const ly = (e.clientY - rect.top - view.ty) / view.z
```

✅ **公式一致**: 两者都是 `(clientXY - rect.left - view.tx) / view.z`。原子坐标在 rect 为 null 时有 fallback（`p.x + r + 10`），拖拽无 fallback（假设 rect 一定存在）。两者均可接受。

#### 2.2.2 stopPropagation 覆盖度

| 调用路径 | stopPropagation? | 位置 |
|----------|-----------------|------|
| confirmJump 确认原子 onClick | ✅ | L634 |
| cancelJump 取消原子 onClick | ✅ | L660 |
| 节点（user/assistant/context/jump）onClick | ✅ | L787 |
| 节点 onMouseDown | ✅ | L783 |
| turn 节点 onClick | ❌ 无（但不弹原子，直接 toggleFold + jumpNode） | L719, L732 |
| switch 节点 onClick | ❌ 无（但不弹原子，直接 setSelectedId + jumpNode） | L746 |
| tool 节点 onClick | ❌ 无（但不弹原子，直接 setSelectedId + jumpNode） | L760 |
| SlimOverlay 圆点 onClick | ✅（stopPropagation 阻止 expand） | L1046 |
| onClickBg SVG 背景 | N/A（是冒泡终点） | L933 |

✅ **交互原子的确认/取消按钮均有 stopPropagation**，不会触发 onClickBg 清除 pendingJump。红线 2 满足。

#### 2.2.3 同节点重复点击 vs 不同节点先清再设

```javascript
onClick: (e) => {
  e.stopPropagation()
  if (pendingJump && pendingJump.id === n.id) {
    // 同一节点重复点击: 不重置,只刷新 pulse + jumpNode
    setSelectedId(n.id)
    setPulseKey((k) => k + 1)
    jumpNode(n, items)
    return
  }
  // 不同节点: 清除旧原子,设置新原子
  setPendingJump(null)
  // ... 清理旧定时器 ...
  setPendingJump({ id: n.id, anchorSeq: n.seq, x: sx, y: sy })
  // ...
}
```

✅ **行为正确**: 同节点重复点击不重置原子；不同节点先清除旧原子再设新原子。与设计 §3 决策点 #1 一致。

#### 2.2.4 3s 超时清理时机

L583-597 的 useEffect 监听 `pendingJump` 变化：
- `pendingJump` 从 null → 有值：启动 3s 定时器
- `pendingJump` 从有值 → null：清除定时器
- `pendingJump` 从有值 → 新有值（不同节点）：先清除旧定时器，再启动新定时器（因为 setPendingJump(null) 紧跟 setPendingJump({...})，React batching 会使 useEffect 只触发一次，而 effect 内部先清除再检查 pendingJump）
- 组件卸载：cleanup 函数清除定时器

✅ **清理时机正确**，无定时器泄漏（除了用全局 setTimeout 的问题）。

#### 2.2.5 运行中判定 `items.some`

```javascript
const running = items.some((it) => it.category === 'tool' && !(it.meta && it.meta.result))
```

**分析**:
- `meta.result === false` → `!false` = true → running ✅
- `meta.result === undefined` → `!undefined` = true → running ✅
- `meta.result === null` → `!null` = true → running ✅
- `meta.result === true` → `!true` = false → not running ✅
- `meta.result === 0` → `!0` = true → running ⚠️（理论上 result 不应为 0，但如果投影有异常值，会被误判为运行中）

⚠️ **潜在误判**: 已完成的历史 tool 节点 result 为 true 不会误判。但如果投影中某个 tool 节点的 meta 被异常清空（result 变为 undefined），会导致整个图谱被判定为"运行中"，所有原子被禁用。这是防御性不足的问题。

**严重级**: 🟡 Medium

**建议**: 显式检查 `it.meta && it.meta.result !== false && it.meta.result !== undefined` 或使用 `it.meta && typeof it.meta.result === 'boolean' && it.meta.result === false` 来精确判定。

---

### 2.3 jump 调用链路

#### 2.3.1 confirmJump 参数

```javascript
const confirmJump = (e) => {
  // ...
  const anc = pendingJump.anchorSeq
  host.call('sessiongraph.jump', { sessionId: String(sessionId), anchorSeq: anc })
}
```

`pendingJump.anchorSeq` 来自 L805: `setPendingJump({ id: n.id, anchorSeq: n.seq, x: sx, y: sy })`。`n.seq` 是节点在投影中的 seq。

✅ **anchorSeq 就是节点 seq**，与 Host 端 `sessiongraph.jump` 期望的 `anchorSeq` 参数一致。

#### 2.3.2 ok:false reason 文案映射完整性

Host 可能返回的 reason（来自 H-t5-host-review.md）:
- `'busy'` → `'当前回合进行中，稍后重试'` ✅
- `'nothing-to-shadow'` → `'被放弃内容太少，无需切换'` ✅
- `'surface-stale'` → `'会话状态同步中，稍后重试'` ✅
- `'anchor-not-found'` → `'目标节点不可用'` ✅
- `'surface-empty'` → ❌ 未映射，走 `reasonText(reason)` 显示原始字符串 `'surface-empty'`

⚠️ **`surface-empty` 缺失映射**，用户会看到英文原始字符串。低优先级，因为 surface-empty 在正常使用中不太可能出现（空会话没有可跳转的节点）。

#### 2.3.3 跳转后 pendingJump 清理

成功时（L642-644）:
```javascript
if (res && res.ok) {
  setPendingJump(null)
  if (pendingJumpTimerRef.current) { clearTimeout(pendingJumpTimerRef.current); pendingJumpTimerRef.current = null }
}
```
✅ 清理了 pendingJump 和定时器。

失败时（L645-651）:
```javascript
const msg = jumpFailText(reason)
setJumpMsg(msg)
jumpMsgTimerRef.current = setTimeout(() => { setJumpMsg(null); jumpMsgTimerRef.current = null }, 2500)
```
⚠️ 失败时 **pendingJump 保留**（原子仍显示），只显示失败提示。2.5s 后提示消失，但原子仍在。用户可重试或手动取消。这是合理的设计选择——失败后不应自动关闭原子。

#### 2.3.4 投影刷新后交互原子是否残留

投影刷新时 `base` prop 变化 → `GraphView` 重新渲染（`GraphViewMemo` 比较 base 引用）。新的 `items` 重建后，`pendingJump` 仍然保留（它是内部 state，不因 base 变化而清空）。原子会继续显示在新投影上。

**问题**: 如果投影刷新后 `pendingJump.id` 对应的节点不在新 items 中（理论上不应发生，因为投影是增量更新），原子仍会显示但跳转时 Host 会返回 `'anchor-not-found'`。

⚠️ **边界情况**: 投影大幅变化（如投影重建）后原子可能指向过期节点。低概率，但原子不会自动消失。

**严重级**: 🟢 Low

---

### 2.4 遮蔽折叠完整性

#### 2.4.1 visible 过滤与 buildLayout chain 跳过

**visible 过滤**（L450-457）:
```javascript
const visible = items.filter((n) => {
  if (n.meta && n.meta.shadowed) return false  // ✅ 遮蔽节点不渲染
  if (n.category === 'turn') return true
  if (n.category === 'switch') return folded['sw-' + n.meta.runId] !== true
  const rk = roundOf[n.id]
  return rk == null || effFoldKey(rk) !== true
})
```

**buildLayout chain**（L249-269）:
```javascript
for (const it of items) {
  if (it.meta && it.meta.shadowed) continue  // ✅ 遮蔽节点跳过 chain
  if (it.category === 'tool' || it.category === 'switch') continue
  // ...
}
```

✅ **两处都正确过滤了 shadowed 节点**。设计 §2.2 "roundOf 折叠共存:遮蔽段不参与用户轮次折叠,独立显示"已落实。

#### 2.4.2 shadowed 节点被过滤后 segCount 异常

```javascript
const segCount = {}
for (const id of Object.keys(roundOf)) {
  const k = roundOf[id]
  if (k) segCount[k] = (segCount[k] || 0) + 1
}
```

**问题**: `roundOf` 包含所有节点（包括 shadowed），所以 shadowed 节点也被计入 `segCount`。折叠摘要显示 `segCount[rk] + ' 条'`，其中包含了不可见的 shadowed 节点。

**实际影响**: 跳转后，被遮蔽的旧轮次如果有 shadowed 节点，其 `segCount` 会被夸大。但被遮蔽的旧轮次节点大多已被替换为 jump 节点，shadowed 节点在 items 中但被过滤出 visible。如果旧轮次恰好被折叠，用户看到的摘要"N 条"包含 shadowed 节点，展开后看不到那么多节点。

**严重级**: 🟡 Medium（显示不一致，不影响功能）

**建议**: `segCount` 计数时排除 shadowed 节点：`if (n.meta && n.meta.shadowed) continue`（在遍历 items 时跳过）。

#### 2.4.3 jump 节点在 chain/roundOf 中的位置

jump 节点 `category: 'jump'`，不是 tool/switch/turn，所以在 `buildLayout` 的 chain 中会被保留（除非其 round 被折叠）。`roundOf` 中 jump 节点会被分配到最后一个 user 消息对应的 round。

✅ jump 节点正常参与布局链。多次 jump 时，每个 jump 节点都在 chain 中占据一个位置，布局正常。

#### 2.4.4 多 jump 节点叠加时 layout

多个 jump 节点各自在 chain 中占位，纵向按时间顺序排列。横向由 `lateralOf` hash 漂移决定。由于 jump 节点 id 不同（`'jump-' + event.seq`），hash 值不同，漂移方向不同。

✅ **多 jump 节点叠加时 layout 正常**，不会重叠（除非 hash 恰好相近，但概率极低）。

---

### 2.5 与现有功能冲突

#### 2.5.1 拖拽 vs onClick 的 4px 阈值

**事件序列**: `onMouseDown`(pendRef 设 {moved:false}) → `onMouseMove`(距离>4, pend.moved=true, setDragId) → `onMouseUp`(pendRef=null, dragId=null) → `onClick`(仍然触发!)

**问题**: `onClick` 处理函数（L786）不检查 `pendRef.current.moved` 标志。拖拽后 mouseup 仍然触发 click 事件，导致交互原子弹出。

**影响**: 用户想拖拽一个节点，松手后不仅完成拖拽，还意外弹出了交互原子。

**严重级**: 🔴 High（交互冲突，用户体验差）

**建议**: 在 `onClick` 开头检查拖拽状态：
```javascript
onClick: (e) => {
  e.stopPropagation()
  // 如果刚完成拖拽,不触发 click
  if (pendRef.current && pendRef.current.moved) return
  // ... 原有逻辑
}
```

**注意**: pkg-63 也有同样的问题（onClick 直接 setSelectedId），但 pkg-63 的副作用只是选中+滚动，影响较小。pkg-64 的副作用是弹出交互原子，影响更明显。

#### 2.5.2 turn 折叠点击与 pendingJump 清理

```javascript
onClick: () => { toggleFold(rk); jumpNode(n, items); setPendingJump(null) }
```

✅ turn 节点点击时清除了 `pendingJump`。折叠操作会关闭交互原子，与设计一致。

#### 2.5.3 SlimOverlay 未受影响

SlimOverlay（L991-1053）的实现与 pkg-63 完全一致，未添加交互原子逻辑。设计 §3 决策点 #4 "窄条不支持切枝"已正确落实。

✅ 无影响。

#### 2.5.4 React.memo 比较器

```javascript
const GraphViewMemo = React.memo(GraphView, (a, b) => 
  a.sessionId === b.sessionId && a.base === b.base && a.cursor === b.cursor
)
```

新状态（`pendingJump`, `jumpMsg`, `selectedId`, `hoverId` 等）都在 GraphView 组件内部的 state 中，不通过 props 传入。memo 比较器只检查外部 props，内部 state 变化不受 memo 影响。

✅ **无影响**。内部 state 变化会正常触发重渲染。

#### 2.5.5 focusCursor/fitAll 与原子组共存

`focusCursor`（L616-625）和 `fitAll`（L626-630）只改变 `view` state，不修改 `pendingJump`。原子的位置基于 SVG 坐标（`pendingJump.x/y`），在 view 变化后仍然有效（因为 SVG 有 transform）。

⚠️ **轻微问题**: 用户点击"定位"或"全图"后，视图缩放/平移，但交互原子的位置不会跟随调整——因为原子的坐标是固定的 SVG 坐标，由 `<g>` 的 transform 一起移动。实际上原子会随图一起移动，所以位置是正确的。✅ 无问题。

---

### 2.6 代码质量

#### 2.6.1 死代码

无明显死代码。所有新增函数（`jumpFailText`、`confirmJump`、`cancelJump`）均被使用。

#### 2.6.2 注释与实现不符

L582 注释: `// T5: 交互原子 3 秒超时自动消失(组件卸载或 pendingJump 变化时清理旧定时器)`
- 实现确实使用了 3s 超时，且在 pendingJump 变化和组件卸载时清理 ✅
- 但注释未说明使用了全局 `setTimeout` 而非 `timer.timeout` ⚠️

L56 注释: `// T5: jump 失败 reason → 中文提示文案`
- 实现正确 ✅

#### 2.6.3 魔法数字

| 值 | 位置 | 含义 |
|----|------|------|
| `3000` | L590 | 交互原子 3s 超时 |
| `2500` | L650, L655 | 失败提示 2.5s 超时 |
| `1700` | L200 | 跳转高亮动画持续时间 |
| `4` | L900 | 拖拽检测阈值(px) |
| `0.4` | L918 | 拖拽跟随弹性系数 |
| `14` | L832 | 原子偏移 x |
| `11` | L840 | 确认原子半径 |
| `9` | L856 | 取消原子半径 |

**严重级**: 🟢 Low

**建议**: 将 3000、2500、4 提取为命名常量（如 `ATOMIC_TIMEOUT_MS`、`MSG_TIMEOUT_MS`、`DRAG_THRESHOLD_PX`）。

#### 2.6.4 重复块

多处重复的定时器清理模式:
```javascript
if (pendingJumpTimerRef.current) { clearTimeout(pendingJumpTimerRef.current); pendingJumpTimerRef.current = null }
if (jumpMsgTimerRef.current) { clearTimeout(jumpMsgTimerRef.current); jumpMsgTimerRef.current = null }
```

出现 5 次（L584-585, L594-595, L639+L644, L662, L797+L799, L936）。

**严重级**: 🟢 Low

**建议**: 提取为 `clearAtomicTimers()` 内联函数。

---

## 3. 与红队检查清单逐条核对

### 红线 2: 交互原子必须阻止事件冒泡

| 路径 | stopPropagation? | 评估 |
|------|-----------------|------|
| 确认原子 onClick | ✅ L634 | 满足 |
| 取消原子 onClick | ✅ L660 | 满足 |
| 节点 onClick（弹原子处） | ✅ L787 | 满足 |

✅ **红线 2 满足**。交互原子的点击事件不会冒泡到 SVG 背景。

### 设计 §3 决策点 #1: 交互原子行为

| 要求 | 实现状态 | 评估 |
|------|----------|------|
| 单击节点 → 定位+闪烁+原子组 | ✅ L786-808 | 满足 |
| 点确认原子 → host.call jump | ✅ L640 | 满足 |
| 点取消 → 原子消失 | ✅ L660 | 满足 |
| 点空白/其他节点 → 原子消失 | ✅ L935, L796 | 满足 |
| 3s 超时 → 原子消失 | ✅ L590 | 满足（但 timer 违规） |
| 运行中 → 确认原子禁用 | ✅ L834, L839 | 满足 |

### 设计 §3 决策点 #4: 窄条不支持切枝

✅ SlimOverlay 仅调用 `jumpNode`（定位跳转），无交互原子逻辑。满足。

### 设计 §2.2: 遮蔽态渲染

| 要求 | 实现状态 | 评估 |
|------|----------|------|
| shadowed 节点 opacity 0.55 + 虚线 | ✅ L707-710 | 满足 |
| 遮蔽段折叠为摘要节点 | N/A（Host 侧实现） | — |
| roundOf 折叠共存 | ✅ L252 chain 跳过, L452 visible 过滤 | 满足 |

---

## 4. diff 与 pkg-63 对照

pkg-64 相对 pkg-63 的所有新增/修改：

| 区域 | 变更 | 评估 |
|------|------|------|
| CSS: `.sg-act` / `.sg-act-disabled` / `.sg-act-msg` | 新增 T5 交互原子样式 | ✅ 无冲突 |
| `jumpFailText` 函数 | 新增 | ✅ 正确 |
| CAT: jump 条目 | 已有（pkg-63 引入） | ✅ 保留 |
| `labelOf`: jump 分支 | 已有 | ✅ 保留 |
| `radiusOf`: jump 分支 | 已有 | ✅ 保留 |
| `visible` 过滤: shadowed | 新增 L452 | ✅ 正确 |
| `buildLayout`: shadowed 跳过 | 新增 L252 | ✅ 正确 |
| GraphView: `pendingJump`/`jumpMsg` state | 新增 | ✅ 正确 |
| GraphView: `pendingJumpTimerRef`/`jumpMsgTimerRef` refs | 新增 | ✅ 正确 |
| sessionId 切换 effect: 清除 pendingJump/jumpMsg | 新增 L367-370 | ✅ 正确 |
| 3s 超时 effect | 新增 L583-597 | ⚠️ 使用全局 setTimeout |
| `confirmJump` / `cancelJump` | 新增 | ✅ 逻辑正确，timer 违规 |
| 节点 onClick: 交互原子逻辑 | 修改 L786-808 | ⚠️ drag 冲突 |
| 交互原子 SVG 渲染 | 新增 L831-868 | ✅ 正确 |
| jump 失败提示渲染 | 新增 L871-880 | ✅ 正确 |
| `onClickBg`: 清除 pendingJump | 修改 L932-937 | ✅ 正确（缺 jumpMsg 清理） |
| `running` 判定 | 新增 L391 | ⚠️ 纯 Client 侧 |

**所有 pkg-63 现有功能均保留，未删除或修改。** ✅

---

## 5. 结论

### 总体评估：**需修改**

pkg-64.client.js 的 T5 交互原子和遮蔽折叠实现整体逻辑正确，stopPropagation 覆盖完整（红线 2 满足），与现有功能无严重冲突。但存在 **2 个必须修复的 Blocker** 和 **1 个 High** 级别问题。

### 必须修的 Top 3

1. **🔴 Blocker: 全局 setTimeout 替代 timer.timeout**
   - 位置: L590, L650, L655
   - 问题: 动态 Client 禁止使用全局 `setTimeout`/`setInterval`，必须使用 `ctx.get('timer')` 的 `timer.timeout`/`timer.interval`
   - L588 已获取 `ctx.get('timer')` 但下一行仍用 `setTimeout`，守卫形同虚设
   - L650/L655 连 `ctx.get('timer')` 都没调用
   - 修复: 全部改用 `timer.timeout()`，cleanup 改用 timer 返回的 dispose 函数

2. **🔴 High: 拖拽后误触交互原子**
   - 位置: L786 onClick 处理函数
   - 问题: 节点拖拽 >4px 后 `onClick` 仍然触发，意外弹出交互原子
   - 原因: `onMouseMove` 中通过 `pendRef.current.moved` 检测拖拽，但 `onClick` 不检查此标志
   - 修复: onClick 开头添加 `if (pendRef.current && pendRef.current.moved) return`

3. **🔴 High: clearAtomicTimers 与 timer.timeout 不匹配**
   - 位置: L369, L370, L584, L585, L594, L595, L639, L644, L662, L797, L799, L936
   - 问题: 所有清理逻辑使用全局 `clearTimeout`。如果修复 #1 改用 `timer.timeout()`，这些 `clearTimeout` 调用将无法正确取消 timer 服务调度的回调
   - 修复: 保存 `timer.timeout()` 返回的 dispose 函数，在 cleanup 中调用 dispose 而非 `clearTimeout`

---

> 审查完成。本报告专注于对抗性分析，不修改任何文件。
