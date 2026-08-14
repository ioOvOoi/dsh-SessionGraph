# T5 细化设计 — 跳转与会话写入(B1 上下文隔离,适配当前状态)

> 2026-08-14。四路并行研究聚合(A 平台事实 / B 现状对照 / C 交互设计 / D 风险边界,
> 详见 `research-t5/` 四份报告)。本设计取代 #5 票面旧文案,按平台现实与当前插件状态(pkg-62)细化。

## 0. 平台现实修正(02 决策票假设过时)

| 02 票假设 | 平台现实(源码实证) |
|---|---|
| 跳转 = "切 activeCursor" | **不存在 activeCursor / 切 active API**。Session 是纯线性追加日志,"当前点"= 日志末尾,由 AgentLoop 内部 `phase.turn` 隐式追踪 |
| B1 遮蔽 = compaction 式 replace | ✅ **成立**:`session.append(type, data, { surfaceOp: { op:'replace', start, end }, sourceEventSeqs })` 是公开 API,动态插件可直接调用;被遮蔽节点从 surface 移除,`deriveMessages()` 不再返回(模型上下文排除) |
| 新消息从游标长出新分支 | 平台无回退;**新消息永远追加日志末尾**。分支感由插件自建(遮蔽标记 + 图谱渲染) |

**B1 在平台层的重新定义:「遮蔽+继续」**——点击历史节点 → 确认 → 在日志末尾 append replace 遮蔽"该节点之后到当前末尾"的 surface 段 → 之后继续对话,模型上下文从摘要继续,旧分支不污染;图谱上旧分支段显示遮蔽态,新消息视觉上从摘要之后延续。

## 1. 用户流程(演示剧本)

1. 新会话聊几轮 → 图谱实时长节点(现状)
2. 点击历史节点(如第 3 轮某原子)→ 聊天定位 + 金环闪烁(现状保留)→ **节点旁出现确认气泡**「切到这里继续 / 取消」
3. 确认 → Host `sessiongraph.jump`:计算遮蔽范围(anchor 之后全部 current surface 节点)→ 构造摘要 → append replace
4. 图谱:被遮蔽段折叠为**灰显摘要节点**;摘要进聊天流(一条标记消息)
5. 再聊几轮 → 新消息追加,模型上下文 = 第 1-3 轮 + 摘要 + 新消息 → **回答不被旧分支污染**
6. 多次跳转 → 多个遮蔽段按时间排列,各自可点击定位

## 2. 技术设计

### 2.1 Host 半体(基于 pkg-62.host.js 扩展)

**新 RPC `sessiongraph.jump`**(`{ sessionId, anchorSeq }` → `{ ok, shadowedCount, summary }`):
1. 取 session(`ctx.get('sessions')`)
2. **运行中守卫**:若最近事件不是 turn/end(或存在未闭合 tool 运行),返回 `{ ok:false, reason:'busy' }`——禁止运行中切枝(D 高风险#2)
3. **compaction 互斥检查**:日志尾部是否有未闭合 `compaction/start`(无对应 end);有 → 拒绝并提示(D 高风险#1)
4. 计算遮蔽范围:`sessionQuery.readSurface()` 或 `session.surface.nodes`,取 anchorSeq 之后全部 current 节点(其 seq 即 `sourceEventSeqs`;start/end 语义待验证,见 §5)
5. 构造摘要(不调 LLM,手工模板):`「分支切换:遮蔽 N 条 · 首条缩略… · 末条缩略… · 意图标签」`
6. `session.append('user/message', { role:'user', content:[{type:'text', text: summary}], sgJump:{ anchorSeq, shadowedSeqs:[...], summary } }, { surfaceOp:{ op:'replace', start, end }, sourceEventSeqs:[...shadowedSeqs] })`——`sgJump` 标记供投影/图谱识别,聊天流中显示为一条普通用户消息(可接受,后续可优化显示样式)
7. 返回结果;投影随 session/event 自动刷新

**投影扩展**(sp.register apply):
- 新事件分支:识别带 `sgJump` 标记的 user/message → 生成 `category:'jump'` 摘要节点(meta: anchorSeq/shadowedSeqs/summary),并把被遮蔽节点标记 `meta.shadowed = true`(apply 时按 shadowedSeqs 就地更新已有节点)
- view 输出不变形状(`{nodes, cursor}`),React.memo 引用比较自动生效(B 确认无需改)

### 2.2 Client 半体(基于 pkg-62.client.js 扩展)

- **点击流程改造**(B 清单 #5-#9,6 处 onClick):非 turn 原子点击 = 定位+闪烁(现状)+ 设置 `pendingJump={id, anchorSeq, key}` → 渲染**确认气泡**(图谱内 `<g>`,非系统弹窗):「切到这里继续」/「✕」,3 秒无操作自动消失,点空白/其他节点取消
- 确认 → `host.call('sessiongraph.jump', ...)`;`busy` 时气泡内提示"当前回合进行中,稍后重试"
- **遮蔽态渲染**:`n.meta.shadowed` 节点 → opacity 0.6 + 虚线边框;其所在轮次折叠为**遮蔽摘要节点**(复用 turn-summary 视觉模式):「⛔ 已遮蔽 N 条 · 首尾缩略」,悬停 title 完整摘要
- **roundOf 折叠共存**:遮蔽段不参与用户轮次折叠,独立显示(B 清单 #15)
- **SlimOverlay**:点击圆点直接切枝(无确认,C 推荐,窄条小不易误触;列为决策点 #4)
- 运行中:图谱存在"运行中"工具节点时,确认气泡的切枝按钮禁用/不弹(与 Host 守卫双保险)

## 3. HITL 决策点(须用户拍板,来自 C 报告,推荐已附)

| # | 决策 | 选项 | 推荐 |
|---|---|---|---|
| 1 | 确认交互 | A 单击定位/双击切枝;B **单击+确认气泡**;C Shift+点击 | B(演示直观、无系统弹窗、可取消) |
| 1a | 气泡细节 | 样式/位置(优先右下,边缘翻转)/3s 消失/「切到这里继续」+✕ | 主题圆角 8px 气泡,右下 |
| 2 | 遮蔽态表现 | A **灰显+折叠为摘要节点**;B 斜线纹理+内联; C 收缩胶囊 | A(复用 turn-summary,认知成本低) |
| 2a | 摘要内容 | `N 条 · 首条缩略…末条缩略`;是否可展开(推荐不可,原文已出上下文) | 不可展开,悬停 title 看全 |
| 3 | 多跳累积 | A **全部显示按时间排列**;B 只显示最新 N;B 收起为历史标记 | A(实现最简,信息完整) |
| 3a | 上限 | 无限制 / 5 个 / 超限收起 | 先无限制(演示规模) |
| 4 | 窄条切枝 | A **直接切枝**;B 简化确认; C 不支持 | A |
| 4a | 窄条反馈 | 圆点变色/闪烁;是否显示遮蔽段标记 | 切枝后刷新,遮蔽段点灰显 |

## 4. 风险与规避(来自 D,实现必须遵守)

| 风险 | 级别 | 规避 |
|---|---|---|
| 自动压缩 × 手动遮蔽叠加 | 🔴 | jump 前检查未闭合 compaction/start;段单调递增,不支持嵌套 |
| 运行中切枝 → surface 与 AgentLoop phase 不一致 | 🔴 | Host 守卫 + Client 禁用,排队到 turn/end |
| 摘要不可逆(append 后无法还原) | 🟡 | 二次确认(气泡)+ 不提供撤销;跳转历史可从日志恢复 |
| 多 agent(subagent)会话 | 🟡 | 子会话独立,不联动;switch 节点不参与遮蔽 |
| 冷启动/重建 | 🟡 | replace 段随日志 fold 保留,投影 v5 兼容(A 已验证) |
| 平台 API 依赖 | 🟡 | 见 §5 待验证清单,实现前逐项实证 |

## 5. 实现前待验证清单(阻塞项,来自 A/D)

1. **`surfaceOp.start/end` 语义**:types.d.ts 写 "surface position",compaction-basic 传 seq——读 `dsh-session/lib/index.js` append 实现确认(索引 vs seq)
2. **自定义 data 标记**(`sgJump` 附加在 user/message data 上)是否随日志持久化、投影/deriveMessage 是否透传
3. **手动 replace(无 compaction/start|end 事务)**后,`sessionQuery.listEvents` 的 shadowed 标记是否正常生成
4. **并发检测**:尾部 compaction/start 未闭合时的判定方式(事件流扫描)
5. **实测 `deriveMessages()`**:append replace 后下一次 derive 确认被遮蔽段被排除(演示验收的关键)

## 6. 验收标准(更新 #5 票)

- [ ] 点击历史节点 → 确认气泡 → 切枝:被放弃段被 replace 遮蔽为摘要,摘要进模型上下文
- [ ] 图谱:被遮蔽段灰显+折叠为摘要节点;新消息从摘要后延续;当前路径高亮更新
- [ ] 运行中(回合未完成)禁止切枝,UI 与 Host 双重守卫
- [ ] 与自动压缩共存:未闭合 compaction 时拒绝跳转
- [ ] 完整演示路径走通:聊几轮 → 实时长节点 → 跳转 → 遮蔽 → 再聊几轮,回答不被旧分支污染(实测 deriveMessages 排除)

## 7. 范围外(移入 #6 Not yet specified)

- 摘要由 LLM 生成(现为手工模板)
- 撤销/回滚跳转;多跳自动合并清理(远景 fog)
- 真正多分支并行(平台仅线性日志 + replace,分支为插件模拟)
