# T5 红队审查报告

> 审查员: 红队(对抗性设计审查员)
> 审查对象: T5 跳转与会话写入设计
> 审查范围: 8 大攻击面逐项攻击
> 审查日期: 2026-08

---

## 0. 审查前提

本报告基于 `t5-design.md` 技术设计、`A-platform-facts.md` 平台事实、`D-risks.md` 风险分析、以及 `pkg-62.host.js` / `pkg-62.client.js` 现状代码进行对抗性审查。目标: 专门找漏洞、反例、边界爆炸、破坏性后果。

---

## 1. 攻击面逐项分析

### 攻击面 1: append replace 到真实会话的破坏性

**场景 1.1: 伪造用户消息进入聊天流**

T5 设计 §2.1 第 6 步:
```
session.append('user/message', { role:'user', content:[{type:'text', text: summary}], ... })
```

问题: 这在聊天流中插入了一条**用户自己没写过**的 `user/message`。聊天 UI 会将它渲染为用户消息(带用户头像/角色标记)。用户看到一条不是自己发的"用户消息"——视觉上与自己的消息无法区分。

**后果**: 用户困惑; 聊天记录被污染; 如果是共享会话(团队协作场景),其他协作者会误以为这是真实用户输入。

**严重级**: 🔴 高(破坏数据真实性)

**规避建议**: 使用 `type: 'plugin'` + `source.kind: 'plugin'` 而非 `role: 'user'`,或者使用平台未提供的自定义 type(如 `sg/summary`)。若平台不支持自定义 type,至少应在 data 中标记 `sgJump: true` 并在投影中特殊处理。

---

**场景 1.2: 摘要内容被遮蔽段仍在聊天流中显示**

设计说被遮蔽节点从 surface 移除,`deriveMessages()` 不再返回。但聊天 UI 的渲染逻辑是否完全依赖 `deriveMessages()` 的输出? 如果聊天 UI 直接读 session.log(而非 surface),被遮蔽段的消息仍会显示在聊天流中——只是模型上下文看不到。

**后果**: 用户在聊天流中看到完整的旧对话(包括被遮蔽段),但模型"失忆"了。视觉上"还在",模型上"已消失"——认知不一致。

**严重级**: 🟡 中(取决于聊天 UI 实现)

**规避建议**: 需实测聊天 UI 渲染是否完全依赖 `deriveMessages()` 输出。如果是,被遮蔽段自然消失;如果不是,需要额外处理。

---

**场景 1.3: 模型上下文意外变化对正在进行的 UI 状态的影响**

append replace 立即生效(平台 API 行为)。如果用户确认跳转时,聊天 UI 正在渲染某个状态(如正在流式输出的 assistant 回复),surface 突然变化可能导致:

- 正在流式输出的 assistant 回复突然消失(因为它的 seq 在被遮蔽段内)
- 聊天滚动位置跳变
- 正在输入的 prompt 被截断

**后果**: UI 状态混乱,用户丢失正在进行的工作。

**严重级**: 🔴 高(破坏交互连续性)

**规避建议**: 设计已通过 busy 守卫防止运行中跳转。但 busy 守卫的覆盖范围有限(见攻击面 2),需要更严格的检查。

---

**场景 1.4: 现有投影不识别 sgJump 事件**

`pkg-62.host.js` 的投影 apply 函数(§2.1)处理事件类型时,`user/message` 分支(line 165-182)会将所有 `user/message` 事件生成 `category: 'user'` 节点。带 `sgJump` 标记的事件会得到一个 `category: 'user'` 节点——与真实用户消息完全一样的节点类型。

**后果**: 图谱上摘要节点和真实用户消息节点无法区分(除非 meta 中有额外信息)。点击摘要节点弹出的交互原子"切到这里继续"的语义不明确(摘要节点不是历史分支点)。

**严重级**: 🟡 中(功能正确但语义混乱)

**规避建议**: 投影 apply 中需先检查 `event.data.sgJump`,命中时生成 `category: 'jump'` 节点而非 `category: 'user'` 节点。设计文档已提到这一点(§2.1 第 39 行),但需确保实现时不遗漏。

---

### 攻击面 2: busy 守卫的可靠性

**场景 2.1: 会话创建后未开始(无事件)**

会话刚创建,日志为空,没有 `turn/end` 事件。busy 守卫检查"最近事件不是 turn/end"——此时没有事件,检查结果是什么?

**后果**: 如果守卫默认允许(无事件=空闲),用户可以在从未对话过的会话上触发跳转——但没有任何历史节点可跳。如果守卫默认拒绝,首次对话前无法进行任何操作(过度保守,但无实际危害)。

**严重级**: 🟢 低(无实际危害,但逻辑需明确)

**规避建议**: 明确规定"无事件=空闲"或"无事件=拒绝",并在代码中处理 `session.events.length === 0` 的边界。

---

**场景 2.2: compaction 运行中**

自动压缩触发时,`compaction/start` 已写入但 `compaction/end` 尚未写入。busy 守卫只检查最近事件是否为 `turn/end`——如果自动压缩在 turn 结束后触发,最近事件是 `compaction/start`(不是 `turn/end`),守卫会正确拒绝。

但如果自动压缩在 turn 中间触发(平台事实: `compactIfNeeded` 在 token 压力时触发,可能在 tool/result 之后、assistant 消息之前),最近事件是 `tool/result`(不是 `turn/end`),守卫也会拒绝——但此时 surface 状态不完整(部分消息已 append,部分未 append)。

**后果**: 守卫可能在不完整的 surface 状态上允许跳转(如果最近事件恰好是 `turn/end` 但 surface 未完全 fold)。

**严重级**: 🟡 中(取决于 surface fold 的实时性)

**规避建议**: busy 守卫应额外检查: ① 最近事件是否为 `compaction/start`(未闭合); ② 最近事件的 seq 是否等于 `session.surface.nodes` 的最后一个 seq(surface 是否最新)。

---

**场景 2.3: subagent 运行中**

子 agent 是独立会话,父会话的 `turn/end` 可能已经 emit(父会话的 turn 已结束,但子 agent 仍在后台运行)。此时 busy 守卫判断"最近事件是 turn/end"=空闲,允许跳转。

**后果**: 父会话跳转时,子 agent 可能仍在写入(通过 subagent 事件),导致父会话的 surface 被子 agent 的写入意外修改。

**严重级**: 🟡 中(子 agent 事件是否影响父会话 surface 取决于平台实现)

**规避建议**: busy 守卫应额外检查: 当前会话是否有活跃的 subagent(`subagents.listChildren(sessionId)` 中是否有未结束的子 agent)。

---

**场景 2.4: 事件流中间有 turn/start 无 turn/end 的异常态**

如果 AgentLoop 异常中断(进程崩溃、网络断开),可能留下 `turn/start` 无对应 `turn/end` 的未闭合 turn。busy 守卫检查最近事件是否为 `turn/end`——此时最近事件是 `turn/start`(不是 `turn/end`),守卫正确拒绝。

但如果异常中断后又开始了新 turn(新 `turn/start`),最近事件仍是 `turn/start`,守卫仍拒绝——但旧 turn 的 surface 可能已部分 fold。

**后果**: 会话卡死(无法跳转,也无法正常对话),因为守卫永远看到 `turn/start` 作为最近事件。

**严重级**: 🟡 中(恢复困难,但不影响数据完整性)

**规避建议**: busy 守卫应检查"最近事件是 turn/start 但无对应 turn/end"的情况,标记为异常态,允许用户强制跳转(需二次确认)。

---

**场景 2.5: 守卫误判的最坏后果**

假设守卫错误地允许了不该允许的跳转(运行中切枝):

- surface 被 replace 修改,但 agent loop 的 `phase.turn` 未同步
- agent loop 继续在旧 surface 上追加消息,新消息的 seq 超出 replace 的 end
- surface 与 agent loop 不一致: agent 认为自己在 turn N,但 surface 已经被遮蔽为 turn M 的摘要
- 下一次 `deriveMessages()` 返回的内容与 agent 的预期不一致
- agent 可能产生混乱的回复(引用了被遮蔽的上下文,或遗漏了新上下文)

**后果**: 模型上下文不一致,回复质量严重下降; 可能导致 agent 进入无限循环(反复尝试修复上下文)。

**严重级**: 🔴 高(破坏核心功能)

**规避建议**: busy 守卫必须是硬性检查(非建议性),且需覆盖所有 surface 不完整的状态。Client 端按钮禁用是必要的 UI 层保护,但 Host 端守卫是最终防线。

---

### 攻击面 3: 遮蔽范围计算

**场景 3.1: anchor 是 turn 节点**

设计说"anchor 之后全部 current 节点"。如果 anchor 是 turn 节点(如 `turn-3`),其 seq 是 `turn/start` 事件的 seq。"之后"是否包括 turn 节点本身? turn 节点的 seq 在 surface 中吗?

平台事实: `turn/start` 和 `turn/end` 是 `log-only` 事件(不进 surface)。所以 turn 节点的 seq 不在 surface 中。"anchor 之后"应该从 turn 节点之后的第一个 surface 节点开始。

**后果**: 如果实现错误地将 turn 节点的 seq 作为 start,`sourceEventSeqs` 可能包含一个不在 surface 中的 seq,导致 `surfaceOp` 参数错误。

**严重级**: 🟡 中(参数错误可能被平台拒绝)

**规避建议**: 明确规定: anchor 只能是 surface 中的节点(user/assistant/tool/context 类型),turn 节点不可作为 anchor。

---

**场景 3.2: anchor 是工具节点且其 tool/result 尚未到达**

用户点击一个 `tool/call` 节点想跳转,但该工具的 `tool/result` 事件尚未到达(工具仍在运行)。此时:

- tool/call 节点在 surface 中(current)
- tool/result 不在(尚未到达)
- 遮蔽范围: tool/call 之后的所有 current 节点——包括后续的 assistant 消息(如果 turn 已结束)

**后果**: 遮蔽范围包含了 tool/call 之后的 assistant 回复,但 tool/call 本身未被遮蔽(它在 anchor 之前)。模型上下文中保留了 tool/call 但丢失了对应的 assistant 回复——因果链断裂。

**严重级**: 🟡 中(工具调用无结果,模型困惑)

**规避建议**: busy 守卫应覆盖此场景(工具运行中禁止跳转)。如果工具已完成(result 已到达),遮蔽范围应包含 tool/call 和 tool/result 作为一组。

---

**场景 3.3: 被遮蔽段含子会话委派(switch 节点)**

switch 节点是 Client 端构建的虚拟节点(不在 session.log 中,seq 是 `tool/call` 的 seq + 0.5)。如果被遮蔽段包含一个 tool/call 节点(其对应的 subagent 已完成),switch 节点如何处理?

设计 §4 风险表说"switch 节点不参与遮蔽"。但 switch 节点的 seq(tool/call 的 seq + 0.5)不在 `sourceEventSeqs` 中(因为它是 Client 端虚拟的)。平台的 `surfaceOp` 不会处理它。

**后果**: tool/call 节点被遮蔽后,Client 端构建 switch 节点时仍然会基于该 tool/call 生成 switch 节点(因为 buildItems 遍历所有 items)。但 tool/call 已不在 surface 中,switch 节点悬空。

**严重级**: 🟡 中(图谱渲染异常)

**规避建议**: 投影的 apply 函数中,当 tool/call 被标记为 shadowed 时,对应的 switch 节点也应被标记为 shadowed。Client 端 buildItems 需过滤掉 shadowed 的 tool/call 生成的 switch 节点。

---

**场景 3.4: anchor 本身是否应保留在 surface**

设计说"anchorSeq 之后全部 current 节点"。anchor 本身是否保留在 surface 中?

- 如果 anchor 保留: 用户跳转到第 3 轮,第 3 轮的消息仍在 surface 中,模型上下文包含第 3 轮+摘要+新消息。这符合"从第 3 轮继续"的语义。
- 如果 anchor 不保留: 第 3 轮的消息被遮蔽,模型上下文只有摘要+新消息。用户想"从第 3 轮继续"但第 3 轮消失了。

**后果**: 设计文档未明确 anchor 是否保留。如果实现错误地将 anchor 也遮蔽,用户失去了跳转目标本身。

**严重级**: 🔴 高(核心语义错误)

**规避建议**: 明确规定: anchor 节点**必须**保留在 surface 中。遮蔽范围是 (anchorSeq, currentEnd] 半开区间,不包含 anchor。

---

### 攻击面 4: 交互原子与现有交互冲突

**场景 4.1: 单击 = 定位+闪烁+交互原子 与 拖拽冲突**

现有代码(line 682-687): 非 turn/switch 节点的 `onMouseDown` 设置 `pendRef`(用于拖拽检测),`onClick` 执行 `setSelectedId + jumpNode`。

T5 设计: 单击节点后弹出交互原子(操作按钮组)。

问题: `onMouseDown` → `pendRef`(拖拽检测) → `onClick` 执行定位+闪烁。如果交互原子也在 `onClick` 中弹出,用户想拖拽节点时,`onMouseDown` 先触发,4px 阈值内未移动则 `onClick` 触发——弹出交互原子。

但交互原子的按钮区域可能覆盖节点的透明命中圈(r + HIT_PAD = r + 10),用户点击交互原子按钮时,事件会冒泡到 SVG 背景(`onClickBg`),导致 `selectedId` 被清除——交互原子消失。

**后果**: 交互原子弹出后,用户点击按钮时原子消失,无法执行操作。

**严重级**: 🔴 高(交互原子不可用)

**规避建议**: 交互原子的按钮需在 `onClick` 中 `e.stopPropagation()` 阻止冒泡。或者交互原子渲染在 SVG 之外(HTML overlay),避免 SVG 事件冒泡问题。

---

**场景 4.2: 交互原子与 turn 节点折叠冲突**

现有代码(line 617-647): turn 节点的 `onClick` 执行 `toggleFold + jumpNode`。

T5 设计: 非 turn 原子点击 = 定位+闪烁+设置 pendingJump → 渲染交互原子。

问题: turn 节点的点击同时执行折叠和定位。如果 turn 节点也弹出交互原子,折叠操作和交互原子会同时发生。

**后果**: 用户点击 turn 节点时,既折叠了轮次,又弹出交互原子——两个操作冲突。

**严重级**: 🟡 中(功能冲突,用户体验差)

**规避建议**: turn 节点的点击行为应保持现有(折叠+定位),不弹出交互原子。交互原子仅对 user/assistant/tool/context 类型节点生效。

---

**场景 4.3: 交互原子弹出时其他节点的点击**

交互原子弹出后,用户点击其他节点:

- 现有 `onClick`: `setSelectedId(n.id)` → 被点击的节点被选中,交互原子消失(setSelectedId 变化触发重渲染)
- 问题: 如果交互原子是 SVG 内的 `<g>` 元素,点击交互原子按钮时事件冒泡到 SVG,`onClickBg` 触发 `setSelectedId(null)`——交互原子消失

**后果**: 交互原子难以稳定使用,容易被意外关闭。

**严重级**: 🟡 中(交互不稳定)

**规避建议**: 交互原子使用 HTML overlay(定位在节点旁边的绝对定位 div),而非 SVG 内的元素。HTML overlay 的事件不会冒泡到 SVG。

---

**场景 4.4: SlimOverlay 与交互原子**

设计 §4 决策点 #4: 窄条不支持切枝,仅定位跳转。但 SlimOverlay 的 `onClick` 直接调用 `jumpNode`(line 864)——没有交互原子,没有确认。

问题: 窄条的"切枝"被禁止了,但窄条的"定位跳转"仍然有效(滚动到节点位置)。这是正确的。但如果用户在窄条模式下想切枝,必须先展开完整图谱——增加了操作成本。

**后果**: 功能限制可能导致用户困惑(为什么窄条不能切枝?完整图可以?)。

**严重级**: 🟢 低(设计决策,非 bug)

**规避建议**: 窄条上可通过 tooltip 提示"展开完整图谱可切枝"。

---

**场景 4.5: 运行中判定在 Client 侧的来源**

设计 §2.2 说"运行中:图谱存在'运行中'工具节点时,确认气泡的切枝按钮禁用/不弹"。

问题: Client 端如何知道"运行中"? 现有代码中,工具节点的 `meta.result === false` 表示"运行中"(line 90: `n.meta.result ? (n.meta.error ? ' ✗' : '') : ' 运行中…'`)。但这是投影状态,是否实时?

如果投影更新有延迟(投影是增量更新,依赖 session/event 流),用户点击节点时投影可能还未更新——工具已完成但投影仍显示"运行中",导致切枝按钮被错误禁用。

**后果**: 用户无法在工具完成后立即切枝(需等待投影更新)。

**严重级**: 🟡 中(延迟导致功能暂时不可用)

**规避建议**: 运行中判定应结合 Host 端检查(通过 RPC 查询 agent 的 `phase.kind === 'running'`),而非仅依赖 Client 端投影状态。

---

### 政击面 5: 摘要质量

**场景 5.1: 手工模板摘要的信息损失**

设计 §2.1 第 5 步: 摘要格式为 `「分支切换:遮蔽 N 条 · 首条缩略… · 末条缩略… · 意图标签」`。

问题: 这是手工模板,不调用 LLM。信息损失严重:

- 用户在被遮蔽段中做了一个重要决策(如"用方案 A 而非方案 B"),摘要无法捕获
- 用户在被遮蔽段中发现了一个 bug 并修复,摘要无法捕获
- 被遮蔽段中的关键代码片段、文件路径、API 调用细节全部丢失

**后果**: 模型在后续回答中"失忆",重复之前已排除的方案,或无法引用之前发现的 bug。

**严重级**: 🔴 高(核心功能退化)

**规避建议**: 短期: 摘要模板应更丰富(包含用户消息的关键实体、决策点、代码片段)。长期: 必须使用 LLM 生成摘要(设计 §7 已列为远景)。但需注意: LLM 摘要本身也有信息损失,且增加延迟和成本。

---

**场景 5.2: 摘要过长**

如果被遮蔽段包含 20 条消息,首条+末条缩略(各 50 字) + 意图标签,摘要约 200-300 字。这在模型上下文中占用约 300-500 tokens。

如果连续 3 次跳转,模型上下文中有 3 个摘要段,共约 900-1500 tokens。加上新对话的 token,上下文可能接近压缩阈值。

**后果**: 频繁跳转导致上下文压力增大,触发自动压缩,可能覆盖摘要本身。

**严重级**: 🟡 中(性能问题)

**规避建议**: 摘要长度应有上限(如 200 tokens/段),且需监控上下文总 token 数。

---

**场景 5.3: 摘要过短**

如果被遮蔽段只有 2-3 条消息,摘要仍包含"遮蔽 N 条 · 首条缩略 · 末条缩略 · 意图标签"——信息冗余(N=2 时首条和末条可能相同)。

**后果**: 摘要占用上下文但信息量低,不如保留原始消息。

**严重级**: 🟢 低(效率问题)

**规避建议**: 当被遮蔽段消息数 ≤ 阈值(如 3 条)时,不执行遮蔽(直接保留原始消息)。

---

**场景 5.4: 中文/英文混排**

摘要模板是中文("分支切换:遮蔽 N 条"),但用户对话可能是英文。模型上下文混合中英文摘要和英文对话,可能影响模型的理解。

**后果**: 轻微的模型困惑,但通常不影响功能。

**严重级**: 🟢 低

**规避建议**: 摘要语言应与会话主要语言一致(检测前 N 条消息的语言)。

---

### 攻击面 6: 多跳叠加

**场景 6.1: 连续 3 次跳转后的 surface 结构**

假设初始 surface: [m1, m2, m3, m4, m5, m6, m7, m8, m9, m10]

第一次跳转(遮蔽 m4-m10): surface = [m1, m2, m3, summary1]
用户再聊: surface = [m1, m2, m3, summary1, m11, m12]

第二次跳转(遮蔽 m11-m12): surface = [m1, m2, m3, summary1, summary2]
用户再聊: surface = [m1, m2, m3, summary1, summary2, m13, m14]

第三次跳转(遮蔽 m13-m14): surface = [m1, m2, m3, summary1, summary2, summary3]

问题: 3 个摘要段在 surface 中,模型上下文是 [m1, m2, m3, summary1, summary2, summary3]。摘要之间没有连接关系,模型可能无法理解"summary1 是在 summary2 之前的分支"。

**后果**: 模型困惑,无法正确理解多跳的上下文关系。

**严重级**: 🟡 中(模型理解能力下降)

**规避建议**: 摘要中应包含时间锚点(如"在 m3 之后,原分支 m4-m10 被遮蔽"),帮助模型理解时间线。

---

**场景 6.2: 跳转目标在被遮蔽段内**

用户跳转到 m3,遮蔽 m4-m10。然后用户想跳转到 m7(m7 在被遮蔽段内)。

问题: m7 已被遮蔽(不在 surface 中),用户无法在图谱上点击它(图谱只显示 current 节点)。但如果用户通过其他方式(如搜索)找到 m7 的 seq,尝试跳转到它——此时 m7 的 seq 不在 surface 中,`surfaceOp.start` 参数无效。

**后果**: 跳转失败,返回错误。

**严重级**: 🟡 中(功能限制,但有明确错误)

**规避建议**: 设计文档应明确: 跳转目标必须是 current 节点。被遮蔽段内的节点不可作为跳转目标。用户若想恢复被遮蔽段,需要"撤销跳转"(设计 §7 列为范围外)。

---

**场景 6.3: 与自动压缩(fog)叠加的显示**

自动压缩的 summary 节点和手动遮蔽的 summary 节点在图谱上如何区分?

设计未提及两者在视觉上的区分。用户看到多个灰色摘要节点,无法区分"这个是自动压缩的"还是"这个是手动跳转的"。

**后果**: 用户困惑,无法理解图谱结构。

**严重级**: 🟡 中(可读性问题)

**规避建议**: 摘要节点应显示来源标签("自动压缩" vs "手动跳转"),且视觉样式略有差异(如自动压缩的摘要节点边框为虚线,手动跳转的为实线)。

---

### 攻击面 7: 演示场景外

**场景 7.1: DSH AgentLoop 的其他写入**

DSH 平台有多个组件会写入 session:

- 标题生成(`sessionTitle.refresh`): append 一个 `context` 事件
- 检查点(`session/flush`): 触发 compaction
- 定时器事件: append 定时器消息

如果用户确认跳转时,标题生成正在 append 一个 context 事件——两个 append 并发,可能导致:

- 标题事件的 seq 落在被遮蔽段的 start-end 之间
- 标题事件被意外遮蔽(丢失)
- 或标题事件在 replace 之后 append,surface 中多出一个不相关的 context 节点

**后果**: 标题丢失或图谱多出无关节点。

**严重级**: 🟡 中(数据完整性问题)

**规避建议**: busy 守卫应额外检查是否有并发的 session 写入(通过 session 的写锁机制,如果平台提供)。

---

**场景 7.2: 异常中断(append 成功后插件崩溃)**

`session.append` 是同步操作(写入日志后返回)。如果 append 成功但插件后续逻辑崩溃(如投影更新失败),会发生什么?

- 日志中已有 replace 事件
- 投影未更新(仍显示旧 surface)
- Client 端收到 session/event 流中的 replace 事件,但投影不处理它

**后果**: 图谱显示与实际 surface 不一致(图谱仍显示被遮蔽段,但模型上下文已排除)。

**严重级**: 🟡 中(显示不一致)

**规避建议**: 投影的 apply 函数应处理 `user/message` 带 `sgJump` 标记的情况(设计已提到)。如果投影更新失败,应有重试机制(投影 stateVersion 机制保证重建时能恢复)。

---

**场景 7.3: 平台 AgentLoop 的 replace 与手动 replace 叠加**

平台自动压缩使用 `session.append("user/message", ..., { surfaceOp: { op:'replace', ... } })` 时,会同时写入 `compaction/start` 和 `compaction/summary` 事件。手动遮蔽不写这些事件。

如果自动压缩和手动遮蔽同时操作 surface(虽然 busy 守卫尝试防止),两者的 replace 段可能重叠。

**后果**: surface 状态不一致,`deriveMessages()` 可能抛错。

**严重级**: 🔴 高(平台 API 契约违反)

**规避建议**: 手动遮蔽应使用与平台 compaction 相同的事件结构(compaction/start + compaction/summary + compaction/end),以利用平台的互斥锁机制。但设计已决定不使用 compaction 事件结构(§2.1),这增加了风险。

---

### 攻击面 8: 安全/合规

**场景 8.1: append 伪造用户消息违反平台事件契约**

平台的 `user/message` 事件的 `source.kind` 字段区分消息来源(`user` = 真实用户输入, `plugin` = 插件注入, `context` = 上下文注入)。

设计 §2.1 第 6 步没有设置 `source` 字段——默认行为是什么? 如果默认 `source.kind === 'user'`,则伪造的用户消息在平台层面被标记为"真实用户输入",违反了事件契约。

**后果**: 平台审计日志显示"用户发了一条消息",但实际是插件伪造的。数据完整性被破坏。

**严重级**: 🔴 高(安全/合规问题)

**规避建议**: 必须设置 `source: { kind: 'plugin', plugin: 'sessiongraph' }`,明确标记为插件注入。这样平台审计日志能正确识别消息来源。

---

**场景 8.2: 对会话持久化的影响**

replace 事件被追加到 `session.jsonl`(append-only)。测试会话被污染后,能否清理?

平台没有删除或回滚日志的 API。replace 事件一旦写入,永远存在于日志中。即使用户想"撤销跳转",也需要追加另一个 replace 事件(反向操作)——日志只会越来越长。

**后果**: 测试会话被污染后无法完全清理; 日志持续增长; 多次跳转后日志中累积大量 replace 事件。

**严重级**: 🟡 中(数据管理问题)

**规避建议**: 设计应明确: ① 测试会话应在测试前 fork 一份副本; ② 提供"清理所有跳转"(批量反向 replace)的工具; ③ 考虑 replace 段上限(设计 §4 风险 7 建议 20 个)。

---

**场景 8.3: 事件契约中的 sourceEventSeqs 一致性**

`surfaceOp.sourceEventSeqs` 必须包含所有被遮蔽的 surface node seq(平台要求)。如果实现中遗漏了某个 seq,`surface fold` 会抛错。

**后果**: 跳转失败,返回错误; 如果错误处理不当,可能导致 session 状态不一致。

**严重级**: 🔴 高(平台 API 契约)

**规避建议**: 计算 `sourceEventSeqs` 时,必须精确匹配 `surface.nodes` 中 anchor 之后的所有节点的 seq。建议使用 `sessionQuery.listEvents(id)` 获取每个事件的 surface 状态,过滤 `surface === 'current'` 的事件,再筛选 seq > anchorSeq 的。

---

## 2. 攻击清单摘要(每项一行)

| # | 场景 | 后果 | 级别 |
|---|------|------|------|
| 1.1 | 伪造用户消息进入聊天流 | 数据真实性破坏,用户困惑 | 🔴 |
| 1.2 | 被遮蔽段仍在聊天流显示 | 视觉/模型认知不一致 | 🟡 |
| 1.3 | surface 突变导致 UI 状态混乱 | 正在流式输出的内容消失 | 🔴 |
| 1.4 | 投影不识别 sgJump 事件 | 摘要节点与用户消息节点混淆 | 🟡 |
| 2.1 | 会话无事件时守卫判断 | 无实际危害,但逻辑需明确 | 🟢 |
| 2.2 | compaction 运行中守卫盲区 | surface 不完整时可能允许跳转 | 🟡 |
| 2.3 | subagent 运行中守卫遗漏 | 父会话跳转时子 agent 写入冲突 | 🟡 |
| 2.4 | turn/start 无 end 的异常态 | 会话可能卡死 | 🟡 |
| 2.5 | 守卫误判的最坏后果 | agent 上下文不一致,回复混乱 | 🔴 |
| 3.1 | anchor 是 turn 节点 | sourceEventSeqs 参数错误 | 🟡 |
| 3.2 | anchor 是运行中的工具节点 | 工具调用因果链断裂 | 🟡 |
| 3.3 | 被遮蔽段含 switch 节点 | switch 节点悬空 | 🟡 |
| 3.4 | anchor 本身是否保留未明确 | 可能丢失跳转目标 | 🔴 |
| 4.1 | 交互原子与拖拽冲突 | 交互原子不可用 | 🔴 |
| 4.2 | 交互原子与 turn 折叠冲突 | 折叠和弹出同时发生 | 🟡 |
| 4.3 | 交互原子弹出时其他节点点击 | 交互原子被意外关闭 | 🟡 |
| 4.4 | SlimOverlay 与交互原子 | 功能限制(设计决策) | 🟢 |
| 4.5 | 运行中判定 Client 端延迟 | 切枝按钮暂时不可用 | 🟡 |
| 5.1 | 手工模板摘要信息损失 | 模型"失忆",重复排除的方案 | 🔴 |
| 5.2 | 摘要过长 | 上下文压力增大 | 🟡 |
| 5.3 | 摘要过短 | 摘要冗余,不如保留原始 | 🟢 |
| 5.4 | 中文/英文混排 | 轻微模型困惑 | 🟢 |
| 6.1 | 连续 3 次跳转 | 摘要间无连接关系,模型困惑 | 🟡 |
| 6.2 | 跳转目标在被遮蔽段内 | 跳转失败(有明确错误) | 🟡 |
| 6.3 | 与自动压缩叠加显示 | 摘要节点无法区分来源 | 🟡 |
| 7.1 | AgentLoop 其他写入并发 | 标题丢失或图谱多出无关节点 | 🟡 |
| 7.2 | append 成功后插件崩溃 | 图谱与实际 surface 不一致 | 🟡 |
| 7.3 | 平台 replace 与手动 replace 叠加 | surface 状态不一致 | 🔴 |
| 8.1 | 伪造用户消息违反事件契约 | 审计日志数据完整性破坏 | 🔴 |
| 8.2 | 会话持久化无法清理 | 测试会话污染,日志持续增长 | 🟡 |
| 8.3 | sourceEventSeqs 一致性 | 跳转失败,session 状态不一致 | 🔴 |

---

## 3. 必须修改设计的 3 条

### 3.1 必须使用 `source.kind: 'plugin'` 标记摘要消息

**理由**: 当前设计的 `session.append('user/message', ...)` 不设置 `source` 字段,导致摘要消息在平台层面被标记为"真实用户输入"。这违反了事件契约(攻击面 8.1),破坏数据完整性和审计日志。必须设置 `source: { kind: 'plugin', plugin: 'sessiongraph' }`。

**修改位置**: t5-design.md §2.1 第 6 步,追加 `source: { kind: 'plugin', plugin: 'sessiongraph' }` 到 event data。

---

### 3.2 必须明确 anchor 节点保留在 surface 中(遮蔽范围是半开区间)

**理由**: 设计文档未明确 anchor 是否保留(攻击面 3.4)。如果实现错误地将 anchor 也遮蔽,用户失去了跳转目标本身——核心语义错误。必须明确规定: 遮蔽范围是 `(anchorSeq, currentEnd]` 半开区间,anchor 节点**必须**保留在 surface 中。

**修改位置**: t5-design.md §2.1 第 4 步,明确"取 anchorSeq 之后(**不含 anchor**)全部 current 节点"。

---

### 3.3 busy 守卫必须覆盖 surface 不完整的状态(不仅检查 turn/end)

**理由**: 当前守卫仅检查"最近事件是否为 turn/end"(攻击面 2.2-2.5),遗漏了: ① compaction 运行中; ② subagent 运行中; ③ turn/start 无 end 的异常态; ④ surface fold 未完成。必须扩展为: 检查 `session.surface.nodes` 最后一个 seq 是否等于 `session.events` 最后一个事件的 seq(surface 是否最新),且无未闭合的 compaction/start。

**修改位置**: t5-design.md §2.1 第 2-3 步,扩展 busy 守卫的检查条件。

---

## 4. 实现时必守的 5 条红线

### 红线 1: sourceEventSeqs 必须精确匹配 surface.nodes 中 anchor 之后的所有节点

**理由**: 平台 `surfaceOp.sourceEventSeqs` 必须包含所有被遮蔽的 surface node seq(攻击面 8.3)。遗漏任何 seq 都会导致 `surface fold` 抛错,跳转失败。必须使用 `sessionQuery.listEvents(id)` 获取每个事件的 surface 状态,精确计算。

**验证方法**: 实现后用 `sessiongraph_debug` 工具验证: 跳转前后 surface.nodes 的变化是否符合预期,sourceEventSeqs 是否完整。

---

### 红线 2: 交互原子必须阻止事件冒泡(使用 stopPropagation 或 HTML overlay)

**理由**: 交互原子的按钮点击事件会冒泡到 SVG 背景,触发 `onClickBg` → `setSelectedId(null)` → 交互原子消失(攻击面 4.1)。必须在交互原子的按钮上使用 `e.stopPropagation()`,或将交互原子渲染在 SVG 之外(HTML overlay)。

**验证方法**: 实现后测试: 点击交互原子按钮,原子不应消失,且 host.call 应被触发。

---

### 红线 3: 投影 apply 必须先处理 sgJump 标记,再进入 user/message 分支

**理由**: 当前投影的 `user/message` 分支(§2.1 line 165-182)会将所有 `user/message` 事件生成 `category: 'user'` 节点。带 `sgJump` 标记的事件必须生成 `category: 'jump'` 节点,否则摘要节点与真实用户消息节点混淆(攻击面 1.4)。

**验证方法**: 实现后用 `sessiongraph_debug` 工具验证: 跳转后图谱中是否存在 `category: 'jump'` 节点,且其 meta 包含 anchorSeq/shadowedSeqs/summary。

---

### 红线 4: 遮蔽段消息数 ≤ 阈值时不执行遮蔽

**理由**: 当被遮蔽段只有 2-3 条消息时,摘要的信息量不如保留原始消息(攻击面 5.3)。执行遮蔽反而增加了上下文压力(摘要占用 token)。必须设置最小遮蔽阈值(如 4 条),低于阈值时直接保留原始消息。

**验证方法**: 实现后测试: 遮蔽段消息数 = 3 时,跳转应被拒绝或直接保留原始消息。

---

### 红线 5: 跳转前必须验证 surface.nodes 最后一个 seq 与 session.events 最后一个 seq 一致

**理由**: surface fold 可能滞后于日志写入(攻击面 2.2)。如果 surface 未完成 fold 就执行 replace,sourceEventSeqs 可能不完整。必须在跳转前验证: `session.surface.nodes` 的最后一个 seq 等于 `session.events` 的最后一个 seq(surface 已最新)。

**验证方法**: 实现后测试: 在快速连续发送消息时触发跳转,验证 surface 是否最新。

---

## 附录: 未覆盖但需关注的边界

- **并发跳转**: 两个 Client 同时对同一会话触发跳转(多窗口/多标签场景)
- **会话恢复后跳转**: 会话从持久化恢复后,投影重建完成前用户触发跳转
- **长会话性能**: 1000+ 消息的会话,`sessionQuery.listEvents()` 的返回值可能很大,计算 sourceEventSeqs 的性能
- **摘要渲染中的 XSS**: 摘要内容由用户消息生成,如果用户消息包含 HTML/Script,摘要渲染到聊天流时可能触发 XSS(取决于聊天 UI 的渲染策略)

---

> 审查完成。本报告专注于对抗性分析,不修改任何文件。
