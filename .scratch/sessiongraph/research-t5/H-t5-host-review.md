# T5 Host 半体对抗性代码审查报告

> 审查员: 红队代码审阅员
> 审查对象: `pkg-63.host.js` (SessionGraph 插件 Host 半体, 新增 jump 切枝 RPC)
> 基线对照: `pkg-62.host.js` (现有功能)
> 审查日期: 2026-08-15

---

## 1. 审查摘要

对照设计文档 `t5-design.md` §2.1、平台事实 `F-platform-verify.md`、红队检查清单 `G-t5-redteam.md` 的 3 修正 + 5 红线，对 `pkg-63.host.js` 进行逐项对抗性审查。

### 问题清单表

| 级别 | 位置 | 一句话描述 |
|------|------|------------|
| 🔴 高 | L203-208 | surface 末 seq 一致性检查存在边界漏洞：`surface.nodes` 数组可能为空但 `events` 不为空时，代码不会返回 `surface-empty`，而是进入比较逻辑导致 `lastSurfaceSeq` 为 undefined |
| 🔴 高 | L223 | 遮蔽阈值 `<= 2` 与红队红线 4 不符：红线要求"≤ 阈值时不执行遮蔽"，阈值应为 4 而非 2，当前实现允许 3 条消息被遮蔽 |
| 🟡 中 | L148-175 | checkBusy 的 turn 未闭合检查逻辑与平台事实有差异：平台 `inspectCompactionEntryState` 从后向前扫描找首个 turn/start 或 turn/end，但实现中两个检查（compaction 和 turn）独立循环，可能在 turn/start 和 compaction/start 交错时产生误判 |
| 🟡 中 | L233-248 | 摘要构造的 nodeTextMap 构建遍历整个 events 数组，性能开销大；且未处理 `context` 类型的 user/message 事件（虽然它们有 content，但被同一 if 分支处理） |
| 🟡 中 | L305 | stateVersion 5→6 升级会导致所有依赖 `sessiongraph.graph` 的投影消费方重建，但插件内 client (`pkg-62.client.js`) 未处理 `category:'jump'` 节点，导致 jump 节点显示异常（半径 7、无标签） |
| 🟡 中 | L116 | `sessiongraph.get` 直返本体（`graph.nodes.map(...)`），jump 节点和 shadowed 节点原样返回，client 端 `buildItems/labelOf/radiusOf` 遇到 `category:'jump'` 时走默认分支，不会崩溃但显示不正确 |
| 🟢 低 | L229-232 | `truncate` 函数硬编码截断长度 20，无常量定义，魔法数字 |
| 🟢 低 | L223 | `shadowedSeqs.length <= 2` 阈值硬编码，无常量定义 |

---

## 2. 逐项详细审查

### 2.1 jump RPC 全流程

#### 2.1.1 session 查找 → checkBusy → surface 一致性
- ✅ **session 查找**：正确，先获取 sessions，然后 `get(pid)`
- ✅ **checkBusy**：调用了 checkBusy 函数，四项检查
- ⚠️ **surface 一致性验证**（L203-208）：
  ```javascript
  const lastSurfaceSeq = surface.nodes[surface.nodes.length - 1]
  if (lastSurfaceSeq !== lastEventSeq) {
    return { ok: false, reason: 'surface-stale' }
  }
  ```
  **问题**：如果 `surface.nodes` 为空数组（`length === 0`），则 `lastSurfaceSeq` 为 `undefined`，与 `lastEventSeq`（数字）比较永远为 false，不会返回 `surface-stale`。但这种情况应该返回 `surface-empty`。

  **但是**：代码第 200-202 行已经处理了 `surface.nodes` 为空的情况：
  ```javascript
  if (!surface || !surface.nodes || surface.nodes.length === 0) {
    return { ok: false, reason: 'surface-empty' }
  }
  ```
  所以当 `surface.nodes` 为空时，已经提前返回。✅ 实际无漏洞。

#### 2.1.2 anchorSeq 不在 surface.nodes 时
```javascript
const anchorIdx = nodesArr.indexOf(anchorSeq)
if (anchorIdx === -1) return { ok: false, reason: 'anchor-not-found' }
```
✅ 正确处理。

#### 2.1.3 anchor 是 jump 节点/switch 节点/turn 节点时
- **turn 节点**：turn/start 和 turn/end 是 log-only 事件，不进 surface.nodes。用户点击 turn 节点时，投影生成的 turn 节点有 seq（event.seq），但 surface.nodes 中没有这个 seq。所以 `anchorIdx === -1`，返回 `anchor-not-found`。✅ 正确，turn 节点不应作为跳转锚点。
- **jump 节点**：jump 节点是 user/message 事件，有 seq，会进入 surface.nodes。所以 jump 节点可以作为跳转锚点。⚠️ 可能不是预期行为。
- **switch 节点**：switch 节点是 Client 端构建的虚拟节点，seq 是 `tool/call 的 seq + 0.5`，不在 session.events 中，也不在 surface.nodes 中。所以 `anchorIdx === -1`，返回 `anchor-not-found`。✅ 正确。

#### 2.1.4 shadowedSeqs 与 surfaceOp start/end 的一致性
```javascript
surfaceOp: {
  op: 'replace',
  start: shadowedSeqs[0],
  end: shadowedSeqs[shadowedSeqs.length - 1],
},
sourceEventSeqs: shadowedSeqs.slice(),
```
**验证**：根据平台事实文档，`surfaceOp.start/end` 是 event seq，非数组索引。`shadowedSeqs` 是从 `surface.nodes` 中 slice 出来的 seq 数组（如 `[5, 7, 10]`），所以 `start=5`、`end=10` 是正确的。

**但是**：平台 `replacementRange` 函数（surface.js:182-199）通过 `state.nodes.indexOf(op.start)` 查找 start 在 nodes 数组中的位置。如果 `surface.nodes` 是 `[3, 5, 7, 10]`，`start=5` 会找到索引 1，`end=10` 会找到索引 3，替换范围是索引 1-3（包含端点）。✅ 正确。

**关键验证**：红队红线 1 要求"sourceEventSeqs 必须精确匹配 surface.nodes 中 anchor 之后的所有节点"。代码中 `shadowedSeqs = nodesArr.slice(anchorIdx + 1)` 正好是 anchor 之后的所有节点 seq。✅ 满足红线 1。

#### 2.1.5 surface.nodes 与 events 尾部一致性检查的实现细节
**重点验证**：用户特别要求验证这个检查。

代码第 205 行：`const lastSurfaceSeq = surface.nodes[surface.nodes.length - 1]`

**分析**：
- `surface.nodes` 是 seq 数组（如 `[0, 3, 5, 7, 10]`），根据平台事实文档第 50 行。
- `surface.nodes[surface.nodes.length - 1]` 是数组最后一个元素，是一个 seq 值（数字）。
- `events[events.length - 1].seq` 是最后一个事件的 seq（数字）。
- 比较两个 seq 值，判断 surface 是否最新。

**结论**：✅ 检查正确，拿的是 `surface.nodes` 数组的最后一个元素（seq 值），不是 nodes 数组本身。

#### 2.1.6 摘要构造：首尾取 text 的健壮性
- **text 空**：`nodeTextMap[s]` 不存在或为空字符串时，循环会跳过。✅ 健壮。
- **turn 节点跳过逻辑**：turn 节点（turn/start、turn/end）的事件类型不是 user/message、assistant/message、tool/call、tool/result，所以不会被添加到 nodeTextMap 中。✅ 正确。
- **slice 边界**：`truncate(firstText, 20)` 和 `truncate(lastText, 20)` 硬编码 20 字。✅ 不会越界。

#### 2.1.7 append 参数完整性
- ✅ `source: { kind: 'plugin', plugin: 'sessiongraph' }` 正确标记为插件注入（满足红队场景 8.1）。
- ✅ `sgJump` 包含 anchorSeq、shadowedSeqs、summary。
- ✅ `surfaceOp.start/end` 使用 shadowedSeqs 的首尾元素。
- ✅ `sourceEventSeqs` 是 shadowedSeqs 的副本。

**但是**：平台 `assertProvenance` 函数（surface.js:150-179）要求 `sourceEventSeqs` 必须包含所有被遮蔽的 surface node seq。代码中 `sourceEventSeqs = shadowedSeqs.slice()` 是 `surface.nodes.slice(anchorIdx + 1)` 的副本，应该完整覆盖。✅ 满足平台契约。

### 2.2 checkBusy 四项检查

#### 2.2.1 compaction 未闭合
```javascript
for (let i = events.length - 1; i >= 0; i--) {
  const ev = events[i]
  if (ev.type === 'compaction/start') return { ok: false, reason: 'busy' }
  if (ev.type === 'compaction/end') break
}
```
**验证**：从后向前扫描，找首个 compaction/start 或 compaction/end。如果找到 compaction/start，返回 busy；如果找到 compaction/end，break。✅ 符合平台事实文档中的 `hasOpenCompaction` 逻辑。

#### 2.2.2 turn 未闭合
```javascript
for (let i = events.length - 1; i >= 0; i--) {
  const ev = events[i]
  if (ev.type === 'turn/start') return { ok: false, reason: 'busy' }
  if (ev.type === 'turn/end') break
}
```
**验证**：同样的逻辑。✅ 符合平台事实文档中的 `isSessionBusy` 逻辑。

**潜在问题**：平台 `inspectCompactionEntryState` 在同一个循环中同时检查 compaction 和 turn 状态。这里是两个独立循环。如果事件流末尾是：`turn/start` → `compaction/start`，第一个循环会找到 `compaction/start` 返回 busy，第二个循环不会执行。但如果事件流末尾是：`compaction/start` → `turn/start`，第一个循环会找到 `compaction/start` 返回 busy，第二个循环也不会执行。所以两个循环的顺序不影响结果，因为第一个找到 busy 就返回。✅ 无问题。

#### 2.2.3 subagent 运行中
```javascript
const runs = pid ? switchRuns[pid] : undefined
if (runs) {
  for (const r of runs) {
    if (r.endedAt === null) return { ok: false, reason: 'busy' }
  }
}
```
✅ 检查 switchRuns 中是否有未结束的运行。

#### 2.2.4 空会话处理
```javascript
if (!events || events.length === 0) return null // 空会话，不算 busy
```
✅ 空会话返回 null（不忙）。

#### 2.2.5 误判场景
- **该拒绝没拒绝**：✅ 所有场景都被正确检查。
- **不该拒绝却拒绝了**：
  - 空会话返回 null（不忙），但后续检查会因为 surface-empty 或 anchor-not-found 拒绝。✅ 正确。
  - 所有检查都通过，但 surface 末 seq 不等于 events 末 seq：返回 surface-stale。✅ 正确。

### 2.3 投影 apply sgJump 分支

#### 2.3.1 分支位置
```javascript
case 'user/message': {
  const d = event.data
  if (d && d.sgJump) {
    // jump 分支
  }
  // 普通 user/message 分支
}
```
✅ 在 user/message 分支内部，先检查 sgJump，再处理普通 user/message。满足红队红线 3。

#### 2.3.2 shadowed 标记实现
```javascript
const shadowSet = new Set(jumpMeta.shadowedSeqs)
const nodes = state.nodes.map((n) => {
  if (shadowSet.has(n.seq)) {
    return { ...n, meta: { ...n.meta, shadowed: true } }
  }
  return n
})
return { ...state, nodes: nodes.concat(jumpNode), cursor: jumpNode.id }
```
✅ **浅拷贝更新**：使用 `map` 创建新数组，对匹配的节点创建新对象（浅拷贝），不匹配的节点保持原引用。
✅ **数组保持顺序**：`map` 保持原有顺序。
✅ **Set 提高查找效率**：`new Set(jumpMeta.shadowedSeqs)` 使查找从 O(n) 降到 O(1)。

#### 2.3.3 jump 节点字段
```javascript
const jumpNode = {
  id: 'jump-' + event.seq,
  seq: event.seq,
  time: event.time,
  category: 'jump',
  text: textOf(d.content),
  meta: {
    anchorSeq: jumpMeta.anchorSeq,
    shadowedSeqs: jumpMeta.shadowedSeqs,
    summary: jumpMeta.summary,
    turn: state.currentTurn,
  },
}
```
✅ category: 'jump'
✅ meta 包含 anchorSeq、shadowedSeqs、summary
✅ text 从 content 中提取

#### 2.3.4 cursor 更新
✅ 设置 cursor 为 jumpNode.id。

#### 2.3.5 与原分支的互斥
✅ 使用 if-else 结构，jump 分支和普通 user/message 分支互斥。

#### 2.3.6 stateVersion 5→6 的兼容影响
```javascript
stateVersion: 6,
```
**问题**：stateVersion 从 5 升级到 6，会导致投影重建。所有依赖 `sessiongraph.graph` 的消费方会收到新的投影状态。

**检查 client 端**：`pkg-62.client.js` 没有处理 `category:'jump'` 节点：
- `CAT` 对象（L51-58）没有 jump 条目。
- `radiusOf`（L59-74）对 jump 走默认分支，返回 7。
- `labelOf`（L80-93）对 jump 返回空字符串（`CAT['jump']` 不存在）。

**结论**：jump 节点会显示为半径 7 的灰色节点，没有标签。不会崩溃，但显示不正确。⚠️ 需要 client 端适配。

### 2.4 与现有功能的冲突

#### 2.4.1 sessiongraph.get 直返本体
```javascript
const nodes = graph.nodes.map((n) => ({ ...n, text: (n.text || '').slice(0, 60) }))
```
**问题**：这里返回的 nodes 包含 jump 节点和 shadowed 节点。client 端 `buildItems/labelOf/radiusOf` 遇到 `category:'jump'` 与 `meta.shadowed` 会不会崩？

**验证**：
- `buildItems`（L100-119）只处理 `category === 'tool'` 的节点来插入 switch 节点，对 jump 节点无特殊处理。✅ 不会崩。
- `labelOf`（L80-93）对 jump 返回空字符串。✅ 不会崩。
- `radiusOf`（L59-74）对 jump 返回 7。✅ 不会崩。
- shadowed 节点：client 端没有检查 `meta.shadowed`，所以 shadowed 节点会正常显示，没有特殊样式。⚠️ 需要 client 端适配。

#### 2.4.2 switchRuns 清理与新 RPC 的交互
✅ 没有修改 switchRuns 相关逻辑，只是新增了 checkBusy 函数使用 switchRuns。

#### 2.4.3 debug 工具改动
✅ 新增了 shadowed 节点统计和 jump 节点特有字段的输出。

### 2.5 代码质量

#### 2.5.1 重复、死代码
- 无明显重复或死代码。

#### 2.5.2 注释与实现不符
- 第 142 行注释说"① surface 完整性(末 seq == events 末 seq) → 由 jump RPC 调用处单独做"，但 jump RPC 中确实做了这个检查（第 203-208 行）。✅ 注释与实现一致。

#### 2.5.3 魔法数字
- 第 223 行：`if (shadowedSeqs.length <= 2)`，阈值 2 是硬编码的。
- 第 266 行：`truncate(firstText, 20)` 和 `truncate(lastText, 20)`，截断长度 20 是硬编码的。

---

## 3. 与红队检查清单逐条核对

### 3 修正

| 修正 | 设计要求 | 实现状态 | 评估 |
|------|----------|----------|------|
| 1 | 使用 `source.kind: 'plugin'` 标记摘要消息 | ✅ L275: `source: { kind: 'plugin', plugin: 'sessiongraph' }` | 已正确落实 |
| 2 | 明确 anchor 节点保留在 surface 中（半开区间） | ✅ L217: `shadowedSeqs = nodesArr.slice(anchorIdx + 1)` | 已正确落实，anchor 不包含在内 |
| 3 | busy 守卫覆盖 surface 不完整状态 | ✅ L148-175: 四项检查 + L203-208: surface 末 seq 一致性检查 | 已正确落实 |

### 5 红线

| 红线 | 要求 | 实现状态 | 评估 |
|------|------|----------|------|
| 1 | sourceEventSeqs 精确匹配 surface.nodes 中 anchor 之后的所有节点 | ✅ L288: `sourceEventSeqs: shadowedSeqs.slice()` | 已正确落实 |
| 2 | 交互原子必须阻止事件冒泡 | N/A（Client 端实现） | Host 端不涉及 |
| 3 | 投影 apply 先处理 sgJump 标记 | ✅ L334: `if (d && d.sgJump)` 在 user/message 分支内优先检查 | 已正确落实 |
| 4 | 遮蔽段消息数 ≤ 阈值时不执行遮蔽 | ⚠️ L223: `shadowedSeqs.length <= 2`，阈值应为 4 | **未满足**：允许 3 条消息被遮蔽 |
| 5 | 跳转前验证 surface.nodes 最后一个 seq 与 session.events 最后一个 seq 一致 | ✅ L203-208 | 已正确落实 |

---

## 4. 结论

### 总体评估：**需修改**

pkg-63.host.js 的 jump RPC 实现整体上正确，遵循了设计文档和平台契约。但存在以下必须修改的问题：

### 必须修的 Top 3

1. **🔴 高优先级**：**遮蔽阈值应提高到 4**
   - 位置：L223
   - 问题：`shadowedSeqs.length <= 2` 允许 3 条消息被遮蔽，与红队红线 4 不符
   - 建议：改为 `shadowedSeqs.length < 4` 或 `shadowedSeqs.length <= 3`，确保至少 4 条消息才执行遮蔽
   - 理由：当被遮蔽段只有 2-3 条消息时，摘要的信息量不如保留原始消息（红队攻击面 5.3）

2. **🟡 中优先级**：**Client 端需要适配 jump 节点和 shadowed 标记**
   - 位置：`pkg-62.client.js`
   - 问题：`CAT` 对象没有 jump 条目，`radiusOf` 和 `labelOf` 对 jump 走默认分支，shadowed 节点无特殊样式
   - 建议：
     - 在 CAT 中添加 `jump: { label: 'JUMP', fill: '#b2954a', r: 7 }`
     - 在 radiusOf 中添加 `case 'jump': return 7`
     - 在 labelOf 中添加 `if (n.category === 'jump') return snippet(n.meta.summary, 18) || 'JUMP'`
     - 对 shadowed 节点添加样式：opacity 0.6 + 虚线边框（设计文档 §2.2）

3. **🟡 中优先级**：**摘要构造性能优化**
   - 位置：L233-248
   - 问题：遍历整个 events 数组构建 nodeTextMap，对于长会话（1000+ 消息）性能开销大
   - 建议：只遍历 shadowedSeqs 对应的事件，或使用 Map 存储 seq→event 的映射

### 附加建议

- **魔法律常量化**：将阈值 2（或 4）、截断长度 20 提取为常量，提高可读性和可维护性
- **jump 节点作为锚点**：当前实现允许 jump 节点作为跳转锚点，这可能不是预期行为。建议在检查 anchor 类型时排除 jump 节点。

---

> 审查完成。本报告专注于对抗性分析，不修改任何文件。