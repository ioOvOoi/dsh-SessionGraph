# T6 子 agent 图谱展开:委派节点显示完整子会话图谱

## What to build

主会话图谱中,subagent 委派目前渲染为单个 switch 小圆点(仅「委派→childId」标签 + 跳转到 tool-call 锚点)。用户明确:**这不对**——子 agent 应像主对话一样显示**完整的原子图谱**(user/context/assistant/tool/turn 节点流 + 跳转)。

## 可行性研究结论(research-t5/E-child-session-data.md,2026-08-14)

- ✅ 投影对所有会话自动维护:`sp.snapshot(childSession)` 热路径直接可得子会话节点流
- ✅ 冷启动:子会话投影为空时,`sessionQuery.readSession(childId)` 取完整日志,projection apply 是纯函数可离线重放(cold path)
- ✅ `subagent/start` 的 `info.id` 即子会话 sessionId,可直接用于所有会话 API
- ⚠️ DSH 无"图中图"UI 先例,形态需自研
- ⚠️ 跳转锚点是全局 DOM 查询:子会话不在聊天视图时 `scrollToKey` 返回 null,需降级(图谱内节点聚焦)
- ⚠️ switchRuns 缺子会话标题,可从 `subagent/descriptor` 事件或 `sessionQuery.readTitle()` 补充

## 形态方案(待用户拍板)

- **A 就地展开(内联子图)**:点击委派节点 → 图谱内在该位置展开子图谱子树(递归,子图用自身布局缩放),面包屑返回。最"融为一体",但布局/性能复杂度最高,列为远景。
- **B 图谱级切换(推荐)**:点击委派节点 → details 列图谱切换为子会话完整图谱(复用 GraphView,数据 = 子会话投影),顶部面包屑「◂ 主会话 / 委派→xxx」返回;聊天区不动。成本最低,直接满足"像主对话一样完整"。
- **C 会话整体切换**:点击委派 → 聊天区 + 图谱一起切到子会话(复用 DSH 现有 subagent 切换),返回按钮回主会话。最省 UI,但切换范围大、打断主对话视图。

## 技术设计要点(以 B 为基准)

1. **Host**:新 RPC `sessiongraph.child({ sessionId, childId })` → 热路径 `sessions.get(childId)` + `sp.snapshot`;投影缺失时冷路径 `sessionQuery.readSession` + 重放 apply(需把 apply 提取为共享纯函数);返回 `{ nodes, cursor, title }`
2. **Client**:GraphPanel/GraphView 增加视图栈(`[{sessionId, title}]`,根 = 主会话);委派节点点击入栈;面包屑点击出栈;子图谱渲染复用现有全部交互(缩放/折叠/跳转)
3. **跳转降级**:子图谱中点击原子 → 尝试 `scrollToKey`(子会话在聊天视图时);失败 → 图谱内节点聚焦(选中 + 金环,不滚动聊天)
4. **委派节点视觉**:在父图谱中仍为 switch 节点,但点击行为从"仅跳转"改为"展开子图谱"(B)/保留跳转为次级行为(如悬停 title)

## Acceptance criteria

- [ ] 点击父图谱委派节点 → 显示子会话完整原子图谱(与主对话同级:全部节点种类 + 折叠 + 缩放/平移)
- [ ] 面包屑返回主会话图谱,状态不丢失
- [ ] 子图谱原子点击跳转:子会话在聊天视图时滚动定位;不在时图谱内聚焦降级
- [ ] 冷启动(子会话已结束/重启后)仍能显示子图谱
- [ ] 子会话标题显示在面包屑/头部

## Blocked by

- 无(T3/T4 已关闭,details 图谱成熟)

## 决策点

- [ ] 形态:A 就地展开 / B 图谱切换(推荐)/ C 会话整体切换
- [ ] 委派节点点击语义:单击展开子图谱,双击跳转?(或悬停二级菜单)
- [ ] 子图谱是否也允许再展开孙级委派(递归深度上限?)
