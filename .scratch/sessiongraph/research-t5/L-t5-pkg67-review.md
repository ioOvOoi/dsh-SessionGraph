# L-t5: pkg-67 Client 红队审查报告

> 审查目标: `pkg-67.client.js` (1195 行) vs 基线 `pkg-66.client.js` (1108 行)
> 操作原子组: 复用工具原子视觉 + fanOut 几何 + 折叠展开并入
> 对照: `J-atom-reuse-design.md`(复用设计), `K-atom-redteam.md`(红队 3 必改 + 5 红线), `t5-design.md` §3(用户拍板)
> 审查日期: 2026-08

---

## 一、差异概览

| 变更区域 | pkg-66 | pkg-67 | 影响 |
|----------|--------|--------|------|
| CSS `.sg-act*` | 有(L44-48: `.sg-act`, `.sg-act-disabled`, `.sg-act-msg`) | 删除 | 正确,复用 renderToolAtom 后不需要 |
| `renderToolAtom` | 不存在 | 新增 L332-360 | 公共函数,tool/switch/操作原子共用 |
| switch 原子渲染 | 手写 circle+text(L757-769) | 调用 `renderToolAtom`(L794-803) | 复用,标签位置变更(见 M3) |
| tool 原子渲染 | 手写 circle+text(L770-787) | 调用 `renderToolAtom`(L814-824) | 复用,标签位置变更(见 M3) |
| 操作原子组 | 2 原子(确认+取消),`.sg-act` 样式(L843-898) | 3 原子(确认+折叠+取消),renderToolAtom(L881-965) | 核心重构 |
| `pendingJump` 结构 | `{id, anchorSeq, x, y, r}`(L818) | `{id, anchorSeq}`(L856) | 红线 3 落实:坐标从 eff() 读取 |
| 操作原子位置 | `fanPos(k)`: `y=(k-0.5)*FAN_DY`(L848-851) | `actPos(k)`: `y=(k-baseK-1)*FAN_DY`(L898-901) | baseK 偏移,防与真实工具重叠 |
| confirm 原子 r | 11 | 7(switch 风格) | 更小,复用 tool 视觉 |
| jumpMsg 位置 | 固定 `pendingJump.y + FAN_DY + 18`(L893-894) | 动态计算 closeY+16(L975-981) | 跟随原子组位置 |

---

## 二、红队 K 逐条核对

### 2.1 三条必改落实情况

| # | 必改要求 | 落实 | 验证 |
|---|---------|------|------|
| 3.1 | tool/switch 不弹操作原子组,保持跳转 | ✅ | tool onClick: `setSelectedId+jumpNode`(L821),无 setPendingJump; switch onClick: `setSelectedId+jumpNode+setPendingJump(null)`(L789,800) |
| 3.2 | fanOut 偏移防重叠(baseK) | ✅ | L893: `baseK = isAsst && L.childMap[pendingJump.id] ? L.childMap[pendingJump.id].length : 0`; actPos(k) 从 baseK 开始编号(L901) |
| 3.3 | eff() 实时坐标 | ✅ | L887: `const p = eff(pendingJump.id)`,不存 x/y 到 pendingJump |

### 2.2 五条红线落实情况

| # | 红线 | 落实 | 验证行 |
|---|------|------|--------|
| 1 | 「±」先 setPendingJump(null) 再 toggleFold | ✅ | L938-944: `setPendingJump(null)` → 清 timer → `toggleFold(actRK)` |
| 2 | jump 节点禁用「±」 | ✅ | L922-923: `const isJumpNode = targetNode && targetNode.category === 'jump'; const foldDisabled = isJumpNode \|\| !actRK` |
| 3 | running 时禁用「切枝 ⇄」 | ✅ | L913: `confirmJump, running`(第 10 参数 disabled=running) |
| 4 | 操作原子 stopPropagation 全覆盖 | ✅ | renderToolAtom L339/350: `e.stopPropagation()`; fold onClick L938: `e.stopPropagation()` |
| 5 | 超时清理覆盖所有取消路径 | ✅ | useEffect L621-634: pendingJump 变化即清理 timer; 所有手动清理路径(pendingJump=null)都伴随 timer ref 清理 |

---

## 三、问题清单

### P1: switch 节点点击未清理 pendingJump — 回归

**位置**: L789 (switch onClick)
**级别**: 🔴 中(回归)
**描述**: pkg-66 的 switch onClick 包含 `setPendingJump(null)`(L760),可清除已弹出的操作原子。pkg-67 的 switch onClick(L789)删除了此调用,仅 `setSelectedId+jumpNode`。若用户已弹出操作原子(如点击 assistant),再点击 switch 节点,操作原子组不会被清除,需等 3s 超时。
**建议**: 恢复 switch onClick 中的 `setPendingJump(null)` 及关联 timer 清理。

### P2: tool/switch 原子标签在低缩放下不隐藏 — 回归

**位置**: L794-803 (switch), L814-824 (tool)
**级别**: 🟡 中(回归)
**描述**: pkg-66 中 tool 标签(L785)和 switch 标签(L767)受 `showLabels` 条件保护:z ≤ 0.38 时隐藏,避免密集缩放时标签堆叠。pkg-67 使用 renderToolAtom 后,标签始终渲染(无 showLabels 判断)。在低缩放(z ≤ 0.38)下,所有 tool/switch 标签同时显示,视觉噪声显著增加。
**建议**: renderToolAtom 增加 `showLabels` 参数,或在 tool/switch 调用处条件渲染。

### P3: 折叠原子「±」双层 stopPropagation 冗余

**位置**: L938 (fold onClick) + L339/350 (renderToolAtom 内)
**级别**: 🟢 低
**描述**: fold 原子的 `<g>` onClick(L938)已调用 `e.stopPropagation()`,renderToolAtom 内 circle 的 onClick(L339/350)也调用 `e.stopPropagation()`。双重 stopPropagation 功能正确但冗余,增加维护负担。confirm 和 close 原子同理(L905, L952 的 `<g>` 无 onClick,但 fold 的 `<g>` 有)。
**建议**: 移除 fold `<g>` 上的 onClick+stopPropagation,仅保留 renderToolAtom 内的 stopPropagation。或统一:所有操作原子的 `<g>` 都不加 onClick,由 renderToolAtom 统一处理。

### P4: 确认原子 r 从 11 缩为 7

**位置**: L908
**级别**: 🟢 低(设计决策)
**描述**: pkg-66 confirm 原子 r=11,视觉突出(主要操作)。pkg-67 改为 r=7(switch 风格)。三个操作原子(r=7,5,5)大小差异缩小,主要操作「切到这里继续」的视觉权重降低。
**建议**: 确认这是有意设计决策(复用 tool 视觉一致性 > 操作权重区分)。如需保持权重,可将 confirm r 提至 8-9。

### P5: 操作原子 hover 反馈消失

**位置**: renderToolAtom L332-360
**级别**: 🟢 低(视觉退化)
**描述**: pkg-66 的 `.sg-act:hover{opacity:.85}` 提供悬停反馈。pkg-67 删除了 `.sg-act` 样式,renderToolAtom 无 hover 效果。操作原子从"悬停变透明→点击"变为"无视觉反馈→点击",交互感知退化。
**建议**: 在 renderToolAtom 的 circle 上添加 `onMouseEnter/Leave` 样式切换,或在 CSS 中为操作原子添加 hover class。

### P6: switch 原子标签位置从 circle 上方移到内部

**位置**: L794-803 (renderToolAtom 调用)
**级别**: 🟢 低(视觉变更)
**描述**: pkg-66 switch 标签在 circle 上方(L767: `y = p.y - r - 5`, anchor:middle)。pkg-67 使用 renderToolAtom 后,标签在 circle 内部(L355: `y = y + 3`, anchor:middle)。标签与 circle 重叠,降低可读性(尤其 r=7 的 switch)。
**建议**: 如需保持 switch 标签在 circle 上方,可在 renderToolAtom 中为 switch 类型定制标签位置。或接受新视觉(更紧凑)。

---

## 四、交互回归逐项检查

| 场景 | pkg-66 行为 | pkg-67 行为 | 回归? |
|------|------------|------------|-------|
| tool 单击 | 跳转(L774) | 跳转(L821) | ✅ 无回归 |
| switch 单击 | 跳转+清 pendingJump(L760) | 跳转,不清 pendingJump(L789) | ⚠️ P1 |
| turn 折叠态单击 | 展开+跳转+清 pendingJump(L733) | 同(L761) | ✅ 无回归 |
| turn 展开态单击 | 折叠+跳转+清 pendingJump(L746) | 同(L774) | ✅ 无回归 |
| user/context/assistant/jump 单击 | 弹操作原子(L800-822) | 弹操作原子(L838-859) | ✅ 无回归 |
| 拖拽隔离(pendRef.moved) | 有效(L803) | 有效(L841) | ✅ 无回归 |
| 同节点重复点击 | 不重置(L804-809) | 不重置(L842-847) | ✅ 无回归 |
| 点击空白清除 | 有效(L950-957) | 有效(L1037-1044) | ✅ 无回归 |
| 超时自动消失 | 3s(L592-606) | 3s(L620-634) | ✅ 无回归 |
| 操作原子 stopPropagation | renderToolAtom 内(L339/350) | 同 | ✅ 无回归 |
| SlimOverlay 仅定位 | 仅跳转(L1066) | 仅跳转(L1153) | ✅ 无回归 |

---

## 五、状态机一致性

### pendingJump 数据结构

- **写入**: L856 `setPendingJump({ id: n.id, anchorSeq: n.seq })` — 仅 id + anchorSeq
- **读取-渲染**: L887 `eff(pendingJump.id)` — 从 live/restPos 实时读坐标 ✅
- **读取-confirm**: L674 `pendingJump.anchorSeq` → RPC ✅
- **读取-cancel**: L703 `setPendingJump(null)` ✅
- **读取-fold**: L921 `roundOf[pendingJump.id]` → actRK ✅
- **清理-超时**: L627 `setPendingJump(null)` ✅
- **清理-session切换**: L403 `setPendingJump(null)` ✅
- **清理-空白点击**: L1040 `setPendingJump(null)` ✅
- **清理-confirm成功**: L681 `setPendingJump(null)` ✅
- **清理-fold**: L940 `setPendingJump(null)` ✅

所有读取/清理路径一致,无残留引用旧字段(x/y/r)。✅

### anchorSeq 来源

L856: `anchorSeq: n.seq` — 来自节点的 seq(投影计算)。与 pkg-66 L818 一致。✅

### 切枝成功后清理

L679-682: `.then` 回调中 `res.ok` → `setPendingJump(null)` + 清 timer。✅

### jumpMsg 位置

- **渲染**: L969-984,条件 `jumpMsg && pendingJump`,位置跟随 eff(pendingJump.id)
- **设置**: L686/694(LPC 确认失败/异常)
- **清理**: L623(useEffect 清理), L677(confirm 前清理), L942(fold 清理), L1042(空白清理)
- **超时清理**: L689/696 `timer.timeout → setJumpMsg(null)`

所有路径一致。✅

---

## 六、平台合规

| 检查项 | 结果 |
|--------|------|
| 无全局 setTimeout/clearTimeout | ✅ 所有定时器通过 `ctx.get('timer').timeout()` |
| timer.timeout 返回 dispose | ✅ 所有 timer 调用都存储返回值到 Ref,并在 cleanup 中调用 |
| 无 JSX | ✅ 全部 React.createElement |
| 无 import/require | ✅ |

---

## 七、代码质量

| 检查项 | 结果 |
|--------|------|
| 死代码 | 无发现 |
| 注释与实现不符 | 无发现(注释准确描述实现) |
| 魔法数字 | 已提取为常量(ACT_TIMEOUT_MS, ACT_MSG_MS, LAYOUT.*) |
| 重复代码 | renderToolAtom 消除了 tool/switch/操作原子的渲染重复 ✅ |
| renderToolAtom 签名 | 11 参数,接近可读性上限,但每个参数都有明确语义 |

---

## 八、结论

### 总体评估: ⚠️ 需修改

**通过项**:
- 红队 3 必改全部落实(3.1 tool/switch 不弹组, 3.2 baseK 偏移, 3.3 eff() 实时坐标)
- 红队 5 红线全部落实(先清后折, jump 禁用, running 禁用, stopPropagation, 超时清理全覆盖)
- renderToolAtom 公共函数正确封装,消除了渲染重复
- 操作原子组几何公式与 fanOut 一致(baseK 偏移正确)
- pendingJump 状态机一致,无残留引用
- 拖拽隔离、重复点击防重置、空白清除全部保留
- 平台合规(timer/dispose/无 JSX)

**必须修改 top 3**:

| 优先级 | 问题 | 影响 |
|--------|------|------|
| **1** | **P1: switch 点击未清理 pendingJump** | 回归:操作原子组在 switch 点击后不消失,需等 3s 超时。用户体验退化 |
| **2** | **P2: tool/switch 标签在低缩放下不隐藏** | 回归:z ≤ 0.38 时 tool/switch 标签全部显示,视觉噪声。pkg-66 有 showLabels 保护 |
| **3** | **P5: 操作原子 hover 反馈消失** | 视觉退化:删除 .sg-act:hover 后无悬停反馈,交互感知降低 |

**可选改进**(非阻塞):
- P3: 移除 fold `<g>` 上冗余的 stopPropagation
- P4: 评估 confirm 原子 r=7 是否满足主要操作的视觉权重需求
- P6: 评估 switch 标签从 circle 上方移到内部的可读性影响
