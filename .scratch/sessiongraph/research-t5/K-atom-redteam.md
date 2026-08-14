# K-原子组弹出方案 — 红队攻击报告

> 审查员: 红队(对抗性设计审查员)
> 审查对象: "点击任意原子(含 tool/switch)弹出操作原子组"方向
> 攻击基准: 用户新要求(操作原子含「切枝 ⇄」「折叠/展开 ±」「关闭 ✕」;复用现有小原子视觉/fanOut 几何)
> 审查日期: 2026-08

---

## 0. 审查前提

本报告基于 `pkg-66.client.js` 现状代码(含 T5 交互原子实现)、`t5-design.md` §3 用户拍板结果、`t6-child-graph.md` T6 委派节点设计进行对抗性审查。目标: 专门找设计漏洞、交互冲突、实现不可能。

---

## 1. 攻击面逐项分析

### 攻击面 1: tool 节点点击语义破坏

**现状**(pkg-66.client.js line 774):
```js
onClick: () => { setSelectedId(n.id); jumpNode(n, items) }
```
tool 节点单击 = 直接跳转 tool-call 锚点。**这是图谱最常用的交互**——用户查看工具结果、定位特定工具调用。

**新要求**: 单击任意原子(含 tool)弹出操作原子组。

**场景 1.1: 跳转成本升高**

工具节点单击频率最高(用户频繁查看工具结果流)。改为"单击弹操作原子"后:
- **原来**: 单击 = 即时跳转(0 步额外操作)
- **新方案**: 单击 → 弹操作原子 → 点「切枝 ⇄」→ 执行跳转(**2 步**)
- 但用户点击 tool 节点**大多数时候只想跳转**,不想切枝。操作原子组的「切枝 ⇄」对 tool 节点跳转无意义(tool 节点不作为切枝锚点——切枝锚点是 user/assistant/context 节点)

**后果**: 最高频操作从 1 步变 2 步,且弹出的原子组中 2/3 操作(切枝/折叠)对 tool 节点**无语义意义**。tool 节点的「折叠/展开该轮 ±」作用于 tool 所在轮次(非 tool 本身),「切枝 ⇄」对 tool 节点无法执行(tool 不是合法 anchor)。

**严重级**: 🔴 高(破坏最高频交互,且弹出的原子组对 tool 节点大部分无意义)

**规避建议**: tool/switch 节点应保持现有行为(单击跳转),不弹操作原子组。或:操作原子组中动态过滤——对 tool 节点仅显示「关闭 ✕」(等于无操作),退化为无意义弹出。

---

**场景 1.2: tool 结果流式更新时的点击竞态**

tool 节点在运行中时 `meta.result === false`,结果流式更新。用户可能在结果更新过程中点击节点——此时:
- 如果操作原子组已弹出,流式更新导致节点位置可能变化(fanOut 重算时操作原子组的锚点 `pendingJump.x/y` 仍是旧坐标)
- 操作原子组悬浮在过期位置

**后果**: 操作原子组与实际节点位置脱节,用户点击原子组时指向错误区域。

**严重级**: 🟡 中(视觉错位,但不影响功能)

**规避建议**: 操作原子组的锚点应从 `L.restPos[pendingJump.id]` 实时读取,而非存储静态 `x/y`。当前实现(line 818)存储了 `x: p.x, y: p.y` 为点击时快照——需改为每帧重算。

---

**场景 1.3: 双击跳转与单击弹组的冲突**

现状的拖拽交互: `onMouseDown` → `pendRef` 记录起点 → 4px 阈值内移动 = 拖拽,未移动 = onClick 触发。

如果 tool 节点的单击改为弹操作原子,用户想通过**双击**快速跳转 tool-call 时:
- 第 1 次单击 → 弹操作原子组(覆盖节点)
- 第 2 次单击 → 点在操作原子组上(被 `stopPropagation` 拦截),或点在操作原子组间隙(冒泡到 SVG → `onClickBg` → 清除操作原子)
- **双击跳转不可用**

**后果**: 用户丧失快速跳转 tool-call 的方式,被迫走"弹原子 → 点击跳转"的长路径。

**严重级**: 🔴 高(tool 节点跳转完全依赖操作原子组,丧失直接性)

**规避建议**: 保留 tool 节点单击跳转不变;操作原子组仅对 user/assistant/context/jump 节点弹出。

---

### 攻击面 2: 折叠原子「±」语义模糊

**新要求**: 操作原子含「折叠/展开该轮 ±」。

**场景 2.1: tool/switch 节点的「±」归属**

tool/switch 节点的 `roundOf` 归属该轮用户消息(通过 userIdx 映射)。对 tool 节点点「±」= 折叠/展开**该 tool 所在的整个用户轮次**(包括该轮的所有 assistant、tool、context 节点)。

问题: 用户点击一个 tool 节点想折叠「该轮」,但:
- 「该轮」包含该 tool 的父级 assistant 节点和同级其他 tool 节点
- 折叠后,被点击的 tool 节点本身也消失(它是该轮的成员)
- 操作原子组还挂在那里,但锚点节点已隐藏

**后果**: 折叠后操作原子组的锚点节点不在 `visible` 中,操作原子组渲染位置基于 `pendingJump.x/y`(旧坐标快照),与折叠后的布局不匹配。

**严重级**: 🔴 高(折叠操作原子组自身,导致状态不一致)

**规避建议**: 「±」原子点击后必须先清除 `pendingJump`,再执行 `toggleFold`。或:对 tool/switch 节点禁用「±」(仅显示「切枝 ⇄」+「关闭 ✕」)。

---

**场景 2.2: turn 节点本身的「±」与现有折叠冲突**

turn 节点**已有**折叠行为(line 726-756): 点击 turn 节点 = `toggleFold(rk) + jumpNode(n)`。

新方案中 turn 节点单击应弹操作原子组。操作原子组中的「±」也是 `toggleFold`。两个路径做同一件事:
- 路径 A: 直接点击 turn 节点 → 弹操作原子 → 点「±」→ toggleFold
- 路径 B: 不应该存在(因为现在 turn 节点不直接折叠了)

但如果保留 turn 节点的直接折叠(不弹原子),则 turn 节点的行为与其他节点不一致(其他节点弹原子,turn 直接折叠)。

**后果**: 交互不一致——turn 节点是唯一一个"单击直接操作"的节点类型,其他节点都需要先弹原子再操作。

**严重级**: 🟡 中(设计一致性问题)

**规避建议**: 统一方案:所有节点单击都弹操作原子组,turn 节点的「±」原子执行现有 toggleFold。或:turn 节点保持现有直接折叠,不弹原子(但违反"任意原子弹操作原子组"的要求)。

---

**场景 2.3: jump 节点的「±」语义**

jump 节点的 `roundOf` 归属——jump 节点是 `category: 'jump'` 的摘要节点,其 `roundOf` 取决于 `roundOf[it.id]` 的计算(line 406-416)。jump 节点的 seq 来自 `sgJump` 事件,其 `roundOf` 映射到**最早**的 userIdx(通常是最老的用户消息)。

对 jump 节点点「±」= 折叠 jump 节点所在轮次。但 jump 节点本身就是遮蔽段的摘要,其所在轮次可能**已部分折叠**(遮蔽态)。折叠一个已遮蔽的轮次——语义混乱。

**后果**: 用户困惑:折叠一个"摘要节点"意味着什么?

**严重级**: 🟡 中(语义混乱,但不崩溃)

**规避建议**: 对 jump 节点禁用「±」,仅显示「关闭 ✕」。

---

### 攻击面 3: fanOut 虚拟挂载与 memo sig

**场景 3.1: memo sig 不含 pendingJump**

当前 memo sig(line 451):
```js
const sig = base.length + ':' + (cursor || '') + ':' + runs.length + ':' + (runs.length ? runs[runs.length - 1].runId : '') + ':' + foldKey
```

`foldKey` 仅含折叠状态(attack surface 2 的折叠 key),**不含 `pendingJump`**。

如果操作原子作为虚拟节点挂进 childMap:
- 布局由 `buildLayout` 计算 → `memoRef.current`
- `pendingJump` 变化(弹出/消失)不改变 sig → **布局不重算**
- 操作原子的位置是正确的(因为它们在主循环外用 `fanPos` 独立计算,不进 `buildLayout`)

但这意味着操作原子**不在布局体系内**:它们不参与 spineIdx、不参与 edge 生成、不参与 live 动画插值。如果将来需要操作原子参与布局(比如与真实工具簇混排),sig 必须含 pendingJump。

**后果**: 当前实现中操作原子独立于布局是可行的(因为它们在主循环外渲染)。但如果需求演进为"操作原子进布局",sig 必须扩展,每次弹出/消失都触发完整布局重算——性能代价。

**严重级**: 🟢 低(当前实现可行,但演进需注意)

**规避建议**: 明确记录:操作原子**不进布局**,仅在主循环外独立渲染。如未来需进布局,sig 必须加 `pendingJump` 哈希。

---

**场景 3.2: 操作原子与真实工具簇的 fanOut 几何冲突**

新要求复用 fanOut 扇形几何。当前 fanOut(line 217-246):
- childMap 按 assistant 分组:tool/switch 节点挂到最近的 assistant 下
- stackIdx 按顺序编号(0, 1, 2, ...)

操作原子的 fanPos(line 848-851):
```js
const fanPos = (k) => {
  const fanY = (k - 0.5) * LAYOUT.FAN_DY
  return { x: pendingJump.x - (LAYOUT.FAN_X0 + k * LAYOUT.FAN_DX), y: pendingJump.y + fanY }
}
```

如果目标节点(如 user, r=16)已有 2 个真实工具簇(fanOut stackIdx 0 和 1),操作原子 fanPos(0) 的位置:
```
x = node.x - FAN_X0 - 0 * FAN_DX = node.x - 26
y = node.y - 0.5 * FAN_DY = node.y - 9
```

真实工具簇的 fanOut 位置:
```
第一个工具: x = assistant.x - FAN_X0 - 0 * FAN_DX = assistant.x - 26
第二个工具: x = assistant.x - FAN_X0 - 1 * FAN_DX = assistant.x - 48
```

操作原子的锚点是**被点击节点**(user, x 坐标),而真实工具簇的锚点是**父级 assistant**(x 坐标不同)。两者的 x 基准不同——操作原子与真实工具簇**不会重叠**(因为 user 节点和 assistant 节点在图谱中通常是不同 x 坐标)。

**但**: 如果用户点击的节点恰好是 assistant 节点,操作原子的锚点 = assistant.x,与真实工具簇的锚点 = assistant.x **相同**。操作原子 fanPos(0) 的 x = assistant.x - 26,与真实工具 clusterIdx 0 的 x = assistant.x - 26 **完全重叠**。

**后果**: 点击 assistant 节点时,操作原子与真实工具原子重叠,用户无法区分。

**严重级**: 🔴 高(操作原子与真实工具原子视觉重叠,点击可能误触)

**规避建议**: 操作原子的 fanOut 基准应**偏移**——例如在真实工具簇的下方继续展开(从 stackIdx.length 开始编号),或使用不同角度的扇形(如右侧展开)。

---

**场景 3.3: 操作原子与 live 动画插值**

live 动画(line 565-588):
```js
const tick = () => {
  setLive((lv) => {
    const next = {}
    for (const id of Object.keys(lv)) {
      const cur = lv[id]
      const rest = L.restPos[id]
      next[id] = { x: cur.x + (rest.x - cur.x) * 0.1, ... }
    }
    return moved ? next : null
  })
}
```

操作原子不在 `L.restPos` 中(它们不在布局体系内)。如果操作原子的锚点节点在 live 动画中(比如折叠/展开时节点位置变化),操作原子用的是静态 `pendingJump.x/y`,不会跟随动画。

**后果**: 折叠/展开动画过程中,操作原子悬浮在旧位置。

**严重级**: 🟡 中(视觉错位,但动画时间短~180ms)

**规避建议**: 操作原子的渲染位置应从 `eff(pendingJump.id)` 读取(即 live 或 restPos),而非静态快照。

---

### 攻击面 4: 操作原子组与节点重叠

**场景 4.1: 点击 user 节点时扇形几何的起点**

user 节点半径 r=16,是图中最大的原子。操作原子 fanPos(0) 的坐标:
```
x = user.x - 26, y = user.y - 9
```

user 节点的透明命中圈半径 = r + HIT_PAD = 16 + 10 = 26。操作原子(圆, r=11)的中心在 user.x - 26,即刚好在命中圈边缘。操作原子的命中圈 = 11 + 10 = 21,覆盖范围 [user.x - 47, user.x - 5]。

user 节点的命中圈覆盖范围 [user.x - 26, user.x + 26]。操作原子与 user 节点的命中圈在 [user.x - 26, user.x - 5] 范围内**重叠**。

**后果**: 用户点击操作原子时,事件可能同时命中 user 节点和操作原子。如果事件冒泡,`onClick` 会触发两次(一次在操作原子上,一次在 user 节点上)。

**严重级**: 🟡 中(取决于事件冒泡处理)

**规避建议**: 操作原子的 `onClick` 中已用 `e.stopPropagation()`,但 SVG 中 `<g>` 元素的事件冒泡需要仔细测试。如果操作原子在主循环外的独立 `<g>` 中,需确保该 `<g>` 的事件不与节点的 `<g>` 冲突。

---

**场景 4.2: 操作原子与相邻节点的工具簇重叠**

假设图谱中:
- assistant A 在 (0, 100),有 3 个工具簇(stackIdx 0/1/2)
- user B 在 (20, 200),与 assistant A 相邻

用户点击 user B 弹操作原子。操作原子 fanPos(0) 的位置:
```
x = 20 - 26 = -6, y = 200 - 9 = 191
```

assistant A 的工具 clusterIdx 0 位置:
```
x = 0 - 26 = -26, y = 100 + fanY
```

两者 y 坐标相差 91px(191 vs ~100),不会重叠。

**但**: 如果图谱节点密集(如 10 轮对话,每轮 3 个工具),相邻节点的工具簇和操作原子可能在 y 方向上接近。

**后果**: 视觉拥挤,操作原子与相邻节点的工具簇难以区分。

**严重级**: 🟢 低(边界情况,不影响功能)

---

### 攻击面 5: 多轮/边界

**场景 5.1: 折叠后 pendingJump 的清理**

用户点击节点 A 弹操作原子(pendingJump = A) → 点「±」折叠 A 所在轮次 → 轮次折叠后 A 隐藏。

当前代码: `onClick` 中 turn 节点的处理(line 732-733):
```js
onClick: () => { toggleFold(rk); jumpNode(n, items); setPendingJump(null) }
```

turn 节点点击时会清除 `pendingJump`。但如果用户点击的是操作原子组中的「±」原子:
- 「±」原子的 `onClick` 应调用 `toggleFold(rk)` + `setPendingJump(null)`
- 但「±」原子不知道 `rk`(折叠 key)——它只知道 `pendingJump.id`(被点击节点的 id)
- 需要从 `pendingJump.id` 反查 `roundOf[pendingJump.id]` 得到 `rk`,再 `toggleFold(rk)`

**后果**: 需要额外的映射逻辑(roundOf 反查),且折叠后操作原子组消失(pendingJump 清除)是正确的。但如果 `toggleFold` 的 re-render 在 `setPendingJump(null)` 之前发生,可能出现:折叠生效 → 布局重算 → 锚点节点隐藏 → 操作原子组仍渲染(因为 pendingJump 尚未清除) → 一帧的视觉 glitch。

**严重级**: 🟢 低(React 批处理会合并状态更新,通常不会出现)

---

**场景 5.2: 切枝确认后布局突变时操作原子组的残留**

用户点击节点 A 弹操作原子 → 点「切枝 ⇄」→ `host.call('sessiongraph.jump')` → 成功 → `setPendingJump(null)` → 布局突变(遮蔽段消失)。

当前代码(line 651-654): 成功时 `setPendingJump(null)` + 清除定时器。布局突变由 `base` 变化触发(投影更新),React re-render 会清除操作原子组。

**但**: 如果 `host.call` 的 `.then` 回调与投影更新不同步(投影更新通过 session/event 流异步到达),可能出现:
1. `host.call` 成功 → `setPendingJump(null)` → 操作原子组消失
2. 投影更新到达 → `base` 变化 → re-render → 布局突变

或:
1. 投影更新先到达 → `base` 变化 → re-render → 布局突变(遮蔽段消失) → 但 pendingJump 仍在 → 操作原子组锚点节点已隐藏

**后果**: 在投影更新和 RPC 回调之间的时间窗口,操作原子组可能锚定在已隐藏的节点上。

**严重级**: 🟡 中(时间窗口短,但可能出现)

**规避建议**: `confirmJump` 的 `.then` 回调中应先 `setPendingJump(null)`,再依赖 React 批处理确保操作原子组先消失。

---

**场景 5.3: 超时取消与折叠原子并存**

操作原子 3 秒超时自动消失(ACT_TIMEOUT_MS = 3000)。超时清理在 `React.useEffect` 中(line 592-606):
```js
React.useEffect(() => {
  if (pendingJump) {
    pendingJumpTimerRef.current = timer.timeout(() => { setPendingJump(null) }, ACT_TIMEOUT_MS)
  }
  return () => { ... }
}, [pendingJump])
```

如果用户点了「±」折叠轮次,折叠操作本身会触发 re-render(折叠状态变化)。如果 `toggleFold` 和 `setPendingJump(null)` 不在同一个 React 批处理中:
- `toggleFold` 先执行 → 折叠生效 → re-render → 操作原子组仍在(因为 pendingJump 未变)
- 超时定时器仍在运行(因为 pendingJump 未变)
- `setPendingJump(null)` 后执行 → 操作原子组消失 → 超时定时器清理

**后果**: 折叠后操作原子组可能短暂存在(一帧),且超时定时器需要额外清理。

**严重级**: 🟢 低(React 批处理通常合并)

---

### 攻击面 6: 性能

**场景 6.1: 每次点击都重算布局的代价**

当前 `pendingJump` 变化不触发 `buildLayout` 重算(sig 不含 pendingJump)。操作原子在主循环外独立渲染,不参与布局。

但如果操作原子**进布局**(childMap 虚拟挂载),每次 `setPendingJump` 都会:
- 改变 sig(pendingJump hash 加入)
- 触发 `buildLayout` 重算
- 触发 React re-render

`buildLayout` 的复杂度: O(items.length) for chain 构建 + O(items.length) for fanOut = O(n)。

**后果**: 对 100+ 节点的长会话,每次点击都触发 O(n) 布局重算。用户快速连续点击(切换操作原子目标)时,布局重算频率 = 点击频率。

**严重级**: 🟡 中(100 节点的 O(n) 计算通常 < 1ms,但快速连续点击可能造成卡顿)

**规避建议**: 操作原子**不进布局**(当前实现已如此),仅在主循环外独立渲染。这是正确的设计选择。

---

**场景 6.2: memo sig 变化频率**

当前 sig 含: `base.length + cursor + runs.length + lastRunId + foldKey`。

如果加入 pendingJump hash:
- 每次点击节点 → pendingJump 变化 → sig 变化 → buildLayout 重算
- 每次点击空白 → pendingJump 清除 → sig 变化 → buildLayout 重算

**后果**: 点击任何东西都触发布局重算,丧失 memo 化的意义。

**严重级**: 🟡 中(同上,单次计算快但频率高)

---

### 攻击面 7: 与 T6 冲突

**T6 设计**(t6-child-graph.md line 37):
> 委派节点: **单击展开**(无子数据时降级为跳转),**双击跳转** tool-call 锚点

**新要求**: 点击任意原子(**含 switch/委派**)弹出操作原子组。

**直接冲突**:
- T6: switch 单击 = 展开子图谱
- 新要求: switch 单击 = 弹操作原子组(切枝/折叠/关闭)

两个方向互斥:
1. 如果 switch 单击弹操作原子组,展开子图谱的入口在哪里?操作原子组中没有「展开子图谱」按钮。
2. 如果 switch 单击展开子图谱,弹操作原子组的方案对 switch 不适用。

**场景 7.1: 操作原子组是否承载「展开子图谱」入口**

如果操作原子组新增「展开子图谱」按钮,则操作原子组变为:
- 「切枝 ⇄」
- 「折叠/展开该轮 ±」
- 「展开子图谱 ⊕」(仅 switch 节点)
- 「关闭 ✕」

4 个原子的扇形排列:
- fanPos(0) = 切枝, fanPos(1) = 折叠, fanPos(2) = 展开, fanPos(3) = 关闭
- 扇形展开长度 = 4 * FAN_DX = 4 * 22 = 88px

**后果**: 扇形过长,操作原子组占据大量视觉空间;且不同节点类型的原子组内容不同(tool 无展开,switch 有展开),用户需记忆"哪些节点有哪些原子"。

**严重级**: 🔴 高(T6 与新要求直接冲突,需要统一决策)

**规避建议**:
- **方案 A**: 新要求排除 switch 节点(switch 保持 T6 的单击展开/双击跳转)。操作原子组仅对 user/assistant/context/jump/tool 节点弹出。
- **方案 B**: 放弃 T6 的单击展开,改为操作原子组中增加「展开子图谱 ⊕」按钮。但这增加了操作步数(单击弹原子 → 点展开)。
- **方案 C**(推荐): T6 和新要求分阶段实现。当前先实现新要求(排除 switch),T6 实现时再决定 switch 的交互。

---

## 2. 攻击清单摘要(每项一行)

| # | 场景 | 后果 | 级别 |
|---|------|------|------|
| 1.1 | tool 节点跳转成本升高(1步→2步) | 最高频操作退化,原子组对 tool 大部分无意义 | 🔴 |
| 1.2 | tool 流式更新时操作原子组锚点过期 | 视觉错位 | 🟡 |
| 1.3 | tool 双击跳转不可用 | 丧失快速跳转方式 | 🔴 |
| 2.1 | tool/switch 的「±」折叠自身所在轮次 | 操作原子组锚点节点消失,状态不一致 | 🔴 |
| 2.2 | turn 节点「±」与现有直接折叠冲突 | 交互不一致 | 🟡 |
| 2.3 | jump 节点的「±」语义混乱 | 摘要节点折叠无意义 | 🟡 |
| 3.1 | memo sig 不含 pendingJump | 操作原子不进布局,演进需注意 | 🟢 |
| 3.2 | 点击 assistant 时操作原子与真实工具重叠 | 视觉重叠,点击误触 | 🔴 |
| 3.3 | 操作原子不跟随 live 动画 | 折叠/展开时视觉错位 | 🟡 |
| 4.1 | user 节点操作原子与命中圈重叠 | 事件可能冲突 | 🟡 |
| 5.1 | 折叠后 pendingJump 清理的帧序问题 | 可能短暂视觉 glitch | 🟢 |
| 5.2 | 切枝后投影更新与 RPC 回调不同步 | 操作原子锚定已隐藏节点 | 🟡 |
| 6.1 | 操作原子进布局时 O(n) 重算 | 快速点击可能卡顿 | 🟡 |
| 6.2 | sig 含 pendingJump 时 memo 丧失意义 | 每次点击都重算布局 | 🟡 |
| 7.1 | T6 委派展开与操作原子组直接互斥 | 两套交互方向冲突,需统一决策 | 🔴 |

---

## 3. 必须修改设计的 3 条

### 3.1 tool/switch 节点不应弹操作原子组,保持现有跳转行为

**理由**: tool 节点是图谱最高频交互(查看工具结果),单击跳转是 1 步操作。改为弹操作原子组后:
- 跳转变 2 步(攻击面 1.1)
- 操作原子组中「切枝 ⇄」对 tool 无语义(tool 不是合法切枝锚点)
- 「±」折叠自身轮次导致操作原子组悬空(攻击面 2.1)
- 双击跳转不可用(攻击面 1.3)
- T6 设计已规定 switch 单击 = 展开子图谱(攻击面 7)

**修改方向**: 操作原子组仅对 **user/assistant/context/jump** 节点弹出。tool 节点保持 `setSelectedId + jumpNode`,switch 节点遵循 T6 设计(单击展开)。

---

### 3.2 操作原子 fanOut 必须偏移,避免与真实工具簇重叠

**理由**: 点击 assistant 节点时,操作原子 fanPos(0) 的坐标与真实工具 clusterIdx 0 的坐标完全重叠(攻击面 3.2),用户无法区分。

**修改方向**: 操作原子的 fanOut 起始位置应从**真实工具簇数量 + 1**开始编号,即 `fanPos(k)` 改为:
```js
const baseIdx = (childMap[pendingJump.id] || []).length  // 真实工具簇数量
const fanY = ((baseIdx + k) - 0.5) * LAYOUT.FAN_DY
return { x: pendingJump.x - (LAYOUT.FAN_X0 + (baseIdx + k) * LAYOUT.FAN_DX), y: pendingJump.y + fanY }
```

---

### 3.3 操作原子的渲染位置必须从 eff() 实时读取,不能用静态快照

**理由**: 当前实现(line 818)存储 `x: p.x, y: p.y` 为点击时快照。如果节点位置在折叠/展开/live 动画中变化,操作原子悬浮在旧位置(攻击面 1.2, 3.3)。

**修改方向**: 操作原子渲染时从 `eff(pendingJump.id)` 实时读取坐标:
```js
const anchorPos = eff(pendingJump.id)
if (anchorPos) {
  const fanPos = (k) => {
    const fanY = (k - 0.5) * LAYOUT.FAN_DY
    return { x: anchorPos.x - (LAYOUT.FAN_X0 + k * LAYOUT.FAN_DX), y: anchorPos.y + fanY }
  }
  // ... 渲染操作原子
}
```

---

## 4. 实现时必守的 5 条红线

### 红线 1: 操作原子的「±」点击后必须先 setPendingJump(null),再 toggleFold

**理由**: 折叠后锚点节点隐藏,操作原子组必须在折叠动画之前消失(攻击面 2.1)。React 批处理会合并 `setPendingJump(null)` 和 `setFolded(...)` 到同一帧,但如果不在批处理中(如从定时器回调触发),可能出现视觉 glitch。

**验证方法**: 实现后测试:点击「±」原子,操作原子组应与折叠动画同步消失,无残留帧。

---

### 红线 2: 操作原子的「±」必须禁用对 jump 节点的操作

**理由**: jump 节点是遮蔽段摘要,其 `roundOf` 映射到最早用户消息(攻击面 2.3)。折叠 jump 节点所在轮次 = 折叠一个已遮蔽的轮次,语义混乱。

**验证方法**: 实现后测试:点击 jump 节点,操作原子组中「±」应灰显或不显示。

---

### 红线 3: 操作原子的「切枝 ⇄」必须在 running 时禁用

**理由**: T5 设计已规定运行中禁止切枝(Host 守卫 + Client 禁用)。操作原子组的「切枝 ⇄」必须继承此规则(攻击面 1.1 场景 1.2 的延伸)。

**验证方法**: 实现后测试:存在 `meta.result === false` 的 tool 节点时,点击任何节点弹出的操作原子组中「切枝 ⇄」应灰显。

---

### 红线 4: 操作原子的命中圈必须在 SVG 层级中高于节点命中圈

**理由**: 操作原子渲染在主循环外的独立 `<g>` 中(SVG 后渲染的元素在视觉上覆盖先渲染的)。但如果操作原子的 `<g>` 在 `<children>` 数组中的索引低于节点的 `<g>`,点击时 SVG 的命中测试会先命中节点。

**验证方法**: 实现后测试:点击操作原子按钮,应触发操作原子的 `onClick`,而非节点的 `onClick`。

---

### 红线 5: 超时清理必须覆盖所有操作原子的取消路径

**理由**: 操作原子有 3 条消失路径:① 超时 3s;② 点击空白;③ 点击其他节点;④ 折叠/展开。每条路径都必须清理 `pendingJumpTimerRef`(当前代码 line 592-606 仅覆盖了超时和 pendingJump 变化,未覆盖路径 ②③④ 的定时器清理——当前实现中路径 ②③ 通过 `setPendingJump(null)` 触发 `useEffect` 的 cleanup 间接清理)。

**验证方法**: 实现后测试:在操作原子弹出后 1 秒点击空白,定时器应被清理,不再触发 `setPendingJump(null)`。

---

## 附录: 兼容建议(T6 与新要求)

**推荐路径**: 
1. **当前实现**: 操作原子组仅对 user/assistant/context/jump 节点弹出
2. **T6 实现时**: switch 节点保持 T6 设计(单击展开子图谱/双击跳转)
3. **未来演进**: 如果需要 switch 节点也弹操作原子组,可在操作原子组中增加「展开子图谱 ⊕」按钮,但需重新评估 fanOut 几何和交互步数

**不推荐**: 在操作原子组中硬编码「展开子图谱」按钮——这将 switch 节点的交互从 T6 的"直接展开"变为"弹原子 → 点展开",增加了操作步数,且「展开子图谱」与「切枝/折叠」是不同维度的操作,混在同一组原子中会造成认知负担。

---

> 审查完成。本报告专注于对抗性分析,不修改任何文件。
