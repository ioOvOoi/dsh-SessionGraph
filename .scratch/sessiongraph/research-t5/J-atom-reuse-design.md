# T5 交互原子复用设计报告

> 目标: 让弹出的交互原子（切枝确认 / 折叠展开 / 关闭）**完全复用**现有工具原子（tool）和委派原子（switch）的视觉、布局、渲染代码,不引入新样式。

---

## 1. 现状分析（pkg-66.client.js）

### 1.1 原子视觉定义（L68-77）

| 类别 | fill | stroke | radius | 特征 |
|------|------|--------|--------|------|
| `tool` | `#c9c9c9` | 无 | 5 | 小灰圆,运行中无标记,完成后有 ✗/✓ |
| `switch` | `#e5ddd0` | `#a89f8f` dashed | 7 | 中灰暖色圆,虚线描边 |
| `jump` | `#d8d0c0` | `#a89f8f` | 8 | 暖灰摘要节点 |
| **当前交互原子** | `#f5edda` / `#e8e4de` | `#b2954a` / `#b0a89a` | 11/9 | **自造的 `.sg-act` 样式,用户否定** |

### 1.2 fanOut 扇形布局（L217-246）

`fanOut` 通过 `childMap` 将工具/委派节点挂到所属 assistant 节点下,按 `FAN_X0 + k*FAN_DX` 左移、`FAN_DY` 纵向展开。关键参数:

- `FAN_X0: 26` — 工具簇起始距助手距离
- `FAN_DX: 22` — 逐节点左移增量
- `FAN_DY: 18` — 纵向展开间距
- `SWITCH_DX: 6` / `SWITCH_DY: 8` — 委派节点额外偏移

### 1.3 折叠模型（L429-446）

- `roundOf[nodeId]` — 每个节点所属的用户轮次（以该轮用户消息 id 为 key）
- `turnRound[turnId]` — turn 节点所属轮次
- `effFoldKey(k)` — 返回该轮次当前是否折叠
- `toggleFold(key)` — 切换折叠状态

### 1.4 当前交互原子渲染（L843-880）

```js
// 问题: 自造的圆 + 自造颜色 + 自造 .sg-act 样式
React.createElement('circle', {
  cx: a0.x, cy: a0.y, r: 11,
  fill: '#f5edda', stroke: '#b2954a', strokeWidth: 1.5,  // ← 用户否定
  ...
})
```

---

## 2. 设计方案

### 2.1 外观复用: 交互原子 = tool 原子视觉

**原则**: 交互原子在视觉上就是「一个小工具原子」,复用 `CAT.tool` 的 fill/stroke/radius,通过 label 文字区分身份。

| 交互原子 | 视觉来源 | fill | stroke | radius | 图标文本 |
|----------|----------|------|--------|--------|----------|
| ⇄ 切到这里继续 | `CAT.tool` | `#c9c9c9` | 无 | 5 | ⇄ (label 显示在下方) |
| ± 折叠/展开该轮 | `CAT.tool` | `#c9c9c9` | 无 | 5 | ± / ∓ |
| ✕ 关闭 | `CAT.switch` | `#e5ddd0` | `#a89f8f` dashed | 7 | ✕ (label: 关闭) |

**禁用态**: `fill` 降为 `#d9d9d9`, `opacity: 0.45`, `pointer-events: none`（与 tool 的 dim 一致）。

**选中/高亮态**: 复用 tool 的 `neighborSet.has(n.id) ? '#a9a49c' : cat.fill` 逻辑。

### 2.2 排列复用: 虚拟节点挂入 fanOut

**方案: 把操作原子作为「虚拟小原子」插入 `buildItems` 之后的虚拟节点列表**

#### 2.2.1 数据结构

在 `buildLayout` 之前,根据 `pendingJump` 构建虚拟子节点:

```js
// 构建虚拟操作节点(不参与 items,仅参与 fanOut 布局)
const virtualOps = pendingJump ? [
  {
    id: 'vop-jump-' + pendingJump.id,   // 虚拟 id,不与真实节点冲突
    category: 'tool',                     // 复用 tool 渲染分支
    seq: -1,
    text: '',
    meta: { name: 'act-jump', result: true, virtual: true },
    _opType: 'jump',                      // 操作类型标记
  },
  {
    id: 'vop-fold-' + pendingJump.id,
    category: 'tool',
    seq: -1,
    text: '',
    meta: { name: 'act-fold', result: true, virtual: true },
    _opType: 'fold',
  },
  {
    id: 'vop-close-' + pendingJump.id,
    category: 'tool',
    seq: -1,
    text: '',
    meta: { name: 'act-close', result: true, virtual: true },
    _opType: 'close',
  },
] : []
```

#### 2.2.2 fanOut 侵入点

`fanOut` 函数（L217-246）当前仅收集 `tool`/`switch` 类型节点:

```js
else if ((n.category === 'tool' || n.category === 'switch') && lastAsst) {
  const s = childMap[lastAsst] || (childMap[lastAsst] = [])
  s.push(n.id)
}
```

**改造方案**: 在 `buildLayout` 中,将虚拟操作节点也加入 `restPos`,然后调用 `fanOut` 时将虚拟节点也收集进去。

具体侵入点:

1. **`buildLayout` 函数**（L248-332）: 在 `chain` 构建完成后,将虚拟节点挂到当前 cursor 所属的 assistant 节点下。但虚拟节点不参与 `chain`（主轴）,仅参与 `restPos` 和 `childMap`。

2. **`fanOut` 函数**（L217-246）: 需要让虚拟节点也被收集到 `childMap`。有两种方案:
   - **方案 A（推荐）**: 虚拟节点的 `category` 保持 `tool`,fanOut 自然收集;但在 `buildLayout` 中将虚拟节点插入 `items` 末尾,fanOut 会自动将它们挂到最后一个 assistant 下
   - **方案 B**: 修改 `fanOut` 签名,额外接受 `virtualNodes` 参数

**方案 A 更简洁**: 虚拟节点直接加入 `items` 传入 `buildLayout`,fanOut 自动处理。但需注意:
- 虚拟节点不能参与 `chain`（主轴布局）——在 `buildLayout` 的 chain 过滤中跳过 `meta.virtual` 节点
- 虚拟节点的 `restPos` 计算: 由 fanOut 自动计算,但需要确保它们被挂到正确的 assistant 下

**侵入点清单**:

| 位置 | 改动 | 侵入度 |
|------|------|--------|
| `buildLayout` chain 过滤 (L261) | 跳过 `meta.virtual` 节点,不进 chain | 低: 加一个 `if` |
| `buildLayout` 返回值 | 追加 `virtualIds` 列表供渲染使用 | 低 |
| `fanOut` (L224) | 虚拟节点已含 `category:'tool'`,无需改 fanOut | **零侵入** |
| `sig` 计算 (L451) | 追加 `pendingJump ? pendingJump.id : ''` | 低 |
| `visible` 过滤 (L458-465) | 追加虚拟节点到 visible | 低 |

#### 2.2.3 虚拟节点的 memo sig

当前 `sig`:
```js
const sig = base.length + ':' + cursor + ':' + runs.length + ':' + lastRunId + ':' + foldKey
```

追加:
```js
const sig = ... + ':' + (pendingJump ? pendingJump.id + ':' + pendingJump.anchorSeq : 'no-act')
```

#### 2.2.4 点击事件路由

虚拟节点点击 → 调用对应的 `confirmJump` / `toggleFold` / `cancelJump`:

```js
// 在渲染循环中,对 virtual 节点做事件路由
if (n.meta && n.meta.virtual) {
  const onClick = n._opType === 'jump' ? confirmJump
    : n._opType === 'fold' ? () => toggleFold(currentRoundKey)
    : cancelJump
  // 渲复用 renderToolAtom(...)
}
```

### 2.3 折叠/展开并入

**交互原子组 = [切到这里继续, 折叠/展开该轮, 关闭]**

折叠/展开操作的语义:
- 获取 `pendingJump.id` 所属的轮次 `roundKey = roundOf[pendingJump.id]`
- 如果 `roundKey` 存在, `toggleFold(roundKey)`
- title 文案: 当前折叠态 → `effFoldKey(roundKey) ? '展开该轮' : '折叠该轮'`
- 图标: 折叠态用 `+` 展开, 展开态用 `-` 折叠

**turn 节点点击行为建议**:

| 场景 | 当前行为 | 建议 |
|------|----------|------|
| turn 节点(未折叠) | `toggleFold(rk)` | **改为弹出操作原子组**（与 tool/switch 一致） |
| turn 节点(已折叠) | `toggleFold(rk)` + 跳转 | **保持现状**: 折叠态的 turn-summary 点击直接展开+跳转,不弹操作原子（已折叠时操作原子无意义） |

理由: 用户要求「点击任何原子弹出操作原子组」,但 turn 节点已折叠时本身就是一个摘要状态,展开是唯一合理操作,弹出操作原子反而多余。

### 2.4 行为改造: tool/switch 从直接跳转改为弹出操作原子

#### 2.4.1 改造映射表

| 节点类别 | 当前 onClick | 改造后 onClick |
|----------|-------------|----------------|
| `tool` (L774) | `setSelectedId + jumpNode` | `setPendingJump({id, seq, x, y, r})` |
| `switch` (L760) | `setSelectedId + jumpNode` | `setPendingJump({id, seq, x, y, r})` |
| `user/context/assistant/jump` (L800-822) | 已是 `setPendingJump` | 不变 |
| `turn` (未折叠, L746) | `toggleFold + jumpNode` | **改为 `setPendingJump`** |
| `turn` (已折叠, L733) | `toggleFold + jumpNode` | **不变**（直接展开） |

#### 2.4.2 操作原子组内容

弹出的操作原子组包含 3 个小原子:

1. **「⇄ 切到这里继续」** — 复用 tool 视觉: `fill:#c9c9c9`, r=5, label "⇄"
   - 点击 → `confirmJump` (现有逻辑)
   - 运行中时: `opacity:0.45, pointer-events:none`

2. **「± 折叠/展开该轮」** — 复用 tool 视觉: `fill:#c9c9c9`, r=5, label "+"/"-"
   - 点击 → `toggleFold(roundKey)`
   - 如果节点不属于任何轮次(roundKey 为 null): 灰显禁用
   - title: 当前态的中文描述

3. **「✕ 关闭」** — 复用 switch 视觉: `fill:#e5ddd0`, stroke dashed, r=7, label "✕"
   - 点击 → `setPendingJump(null)` (取消)

#### 2.4.3 虚拟节点的 fanOut 位置

虚拟操作节点通过 fanOut 自动排列在目标节点的工具簇中。由于虚拟节点是 `category:'tool'`,fanOut 会将它们挂在最近一个 assistant 节点下,排在真实工具节点之后。

**问题**: 虚拟节点可能被挂到错误的 assistant 下(最后一个 assistant,而非目标节点所属的 assistant)。

**解决**: 在 `buildLayout` 中,不将虚拟节点加入 `items`,而是直接根据 `pendingJump` 的坐标,用 fanOut 相同的公式计算位置:

```js
// 交互原子位置 = 目标节点坐标 + fanOut 同款偏移
const actPos = (k) => {
  const n = virtualOps.length
  const fanY = n === 1 ? 0 : (k - (n - 1) / 2) * LAYOUT.FAN_DY
  return {
    x: pendingJump.x - (LAYOUT.FAN_X0 + k * LAYOUT.FAN_DX),
    y: pendingJump.y + fanY,
  }
}
```

这样位置与真实工具簇完全一致,且不侵入 fanOut 逻辑。

---

## 3. 公共渲染函数提取

### 3.1 要提取的函数

| 函数名 | 当前位置 | 改动说明 | 被谁复用 |
|--------|----------|----------|----------|
| `renderAtomCircle(x, y, r, fill, stroke, strokeDasharray, strokeWidth, extraStyle)` | 从 L780-784 提取 | 返回 tool 原子的核心 circle 元素 | tool 原子、交互原子、future T6 委派展开 |
| `renderAtomLabel(x, y, r, text, anchor, textClass, extraStyle)` | 从 L785-786 提取 | 返回原子下方/侧方的 label 文字 | 所有原子类型 |
| `renderAtom(x, y, n, cat, sel, hover, onClick, title, showLabels, toolInfo, extra)` | 组合上述两函数 | 完整的单个原子渲染(tool 风格) | tool 原子、交互原子、virtual ops |
| `renderInteractiveAtoms(targetX, targetY, targetR, ops, running, roundKey, ...)` | 从 L843-880 重构 | 渲染弹出的操作原子组,复用 renderAtom | 所有节点的点击弹出 |

### 3.2 函数签名设计

```js
/**
 * 渲染单个工具风格原子
 * @param {number} x - 圆心 x
 * @param {number} y - 圆心 y
 * @param {number} r - 圆半径
 * @param {string} fill - 填充色
 * @param {string} [stroke] - 描边色(无则 undefined)
 * @param {string} [strokeDasharray] - 虚线模式
 * @param {number} [strokeWidth=1] - 描边宽度
 * @param {string} iconText - 图标/文字(显示在圆内或旁边)
 * @param {string} [labelText] - 下方标签(可选)
 * @param {function} onClick - 点击回调
 * @param {string} [title] - 悬停提示
 * @param {boolean} [disabled=false] - 禁用态
 * @param {object} [extra={}] - 额外样式(如 animationDelay)
 * @returns {React.Element[]} [hitCircle, mainCircle, label?]
 */
const renderToolAtom = (x, y, r, fill, stroke, strokeDasharray, strokeWidth, iconText, labelText, onClick, title, disabled, extra) => { ... }
```

### 3.3 改造清单

| 步骤 | 改动文件/位置 | 说明 |
|------|--------------|------|
| 1 | pkg-66.client.js L68-77 | 新增 `CAT.actJump = CAT.tool`（复用 tool 视觉）, `CAT.actClose = CAT.switch`（复用 switch 视觉）|
| 2 | pkg-66.client.js 新位置 | 新增 `renderToolAtom()` 函数 |
| 3 | pkg-66.client.js L770-787 | tool 原子渲染改为调用 `renderToolAtom(p.x, p.y, r, ...)` |
| 4 | pkg-66.client.js L757-769 | switch 原子渲染改为调用 `renderToolAtom(p.x, p.y, r, ...)` 带 dashed stroke |
| 5 | pkg-66.client.js L843-880 | 交互原子渲染改为调用 `renderToolAtom(actPos(k).x, actPos(k).y, ...)` × 3 个 |
| 6 | pkg-66.client.js L43-47 | 删除 `.sg-act` / `.sg-act-disabled` / `.sg-act-msg` 样式 |
| 7 | pkg-66.client.js L888-898 | jumpMsg 渲染改为复用 `renderToolAtom` 或提取为公共函数 |

---

## 4. 实现风险评估

### 🔴 风险 1: 虚拟节点与真实节点的 memo sig 冲突

**问题**: 虚拟节点 id 以 `vop-` 前缀生成,但 `buildLayout` 内部用 `childMap` 和 `restPos` 以 id 为 key。如果虚拟节点 id 与真实节点 id 碰撞(极端情况),布局会错乱。

**缓解**: `vop-{targetId}-{type}` 格式保证唯一;但 `buildLayout` 的 chain 过滤需要跳过虚拟节点,否则它们会出现在主轴上。

**评估**: 低风险, id 前缀足够区分。

### 🔴 风险 2: 虚拟节点参与 fanOut 导致真实工具簇位置偏移

**问题**: fanOut 按 `arr.forEach((tid, k) => { stackIdx[tid] = k; ... })` 计算位置,k 是数组索引。如果虚拟节点被 fanOut 收集到 `childMap` 中,它们会占据 k 值,导致真实工具节点的 `stackIdx` 和位置偏移。

**缓解**: **不将虚拟节点加入 items**。交互原子的位置由 `renderInteractiveAtoms` 直接用 fanOut 公式计算,不经过 `buildLayout` / `fanOut`。这样虚拟节点完全不侵入布局流水线。

**评估**: 中风险。这是最关键的架构决策——虚拟节点**不参与 fanOut**,而是**在渲染阶段用相同公式计算位置**。这保证了零侵入。

### 🟡 风险 3: tool/switch 点击行为改变影响用户习惯

**问题**: 当前 tool/switch 点击 = 直接跳转对话,改为弹出操作原子后,用户需要多一步操作。

**缓解**: 操作原子组包含「切到这里继续」,功能不变;但用户可能觉得多此一举。

**建议**: 保留双击直接跳转的快捷路径(双击 = 直接执行默认操作「切到这里继续」),单击 = 弹出操作原子组。这样老用户不受影响。

**评估**: 中风险。需要在 UX 层面验证。

---

## 5. 方案摘要

### 外观复用

交互原子**不引入新样式**,复用 `CAT.tool` (fill:#c9c9c9) 和 `CAT.switch` (fill:#e5ddd0 + dashed stroke) 的视觉。通过 iconText 文字(⇄/±/✕)区分功能。禁用态复用 tool 的 dim opacity。

### 排列复用

交互原子**不插入 fanOut 布局流水线**,而是在渲染阶段用 fanOut 相同的公式(`FAN_X0 + k*FAN_DX`, `FAN_DY`)直接计算位置。这样:
- 视觉上与真实工具簇完全一致的扇形排列
- 不侵入 `buildLayout` / `fanOut` 逻辑
- 不影响真实工具节点的 `stackIdx` 和位置

### 折叠/展开并入

操作原子组包含 3 个原子: [切到这里继续, 折叠/展开该轮, 关闭]。折叠/展开通过 `toggleFold(roundKey)` 实现,title 文案动态显示当前态。turn 节点(已折叠态)点击仍直接展开,不弹操作原子组。

### 行为改造

tool/switch/jump/user/context/assistant 节点单击 → 弹出操作原子组(跳转降为操作原子之一)。turn 节点(未折叠)也弹出操作原子组。保留双击直接跳转的快捷路径。

### 公共函数提取

提取 `renderToolAtom()` 函数,封装 tool 风格原子的完整渲染(circle + hitCircle + label + disabled态)。所有原子类型(tool/switch/交互原子)都通过此函数渲染。

### 关键风险

1. **虚拟节点不参与 fanOut** — 这是最核心的架构决策,保证零侵入;风险在于位置计算需要精确复用 fanOut 公式
2. **tool/switch 点击行为改变** — 多一步操作,需要双击快捷路径补偿
3. **sig 变化触发重渲染** — 虚拟节点的出现/消失需要纳入 sig,否则 memo 缓存失效
