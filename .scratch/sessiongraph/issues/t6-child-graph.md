# T6 子 agent 图谱展开:委派节点显示完整子会话图谱

> 形态已定案(2026-08-14,用户拍板):**A 就地内联展开**;委派节点 **单击展开子图谱 / 双击跳转**(tool-call 锚点保留为次级行为,悬停 title 直达)。

## What to build

主会话图谱中,subagent 委派目前渲染为单个 switch 小圆点。用户明确:这不对——子 agent 应像主对话一样显示**完整的原子图谱**(user/context/assistant/tool/turn 节点流 + 折叠 + 缩放/平移 + 跳转),**就地内联展开**在父图谱的委派节点位置,递归嵌套(孙级委派同样可展开),可折叠回小圆点。

## 可行性研究结论(research-t5/E-child-session-data.md,2026-08-14)

- ✅ 投影对所有会话自动维护:`sp.snapshot(childSession)` 热路径直接可得子会话节点流
- ✅ 冷启动:投影为空时 `sessionQuery.readSession(childId)` 取完整日志,apply 纯函数重放
- ✅ `subagent/start` 的 `info.id` 即子会话 sessionId
- ⚠️ DSH 无"图中图"UI 先例,形态自研(本票即其设计)
- ⚠️ 跳转锚点是全局 DOM 查询:子会话不在聊天视图时 `scrollToKey` 返回 null → 降级为图谱内节点聚焦(选中 + 金环)
- ⚠️ switchRuns 缺子会话标题:从 `subagent/descriptor` 事件补(或 `sessionQuery.readTitle()`)

## 技术设计(定案 A)

### Host 半体(pkg-62.host.js 扩展)

1. **apply 提取为共享纯函数**:`applyGraph(state, event)` 独立于 `sp.register` 内联,供冷路径重放
2. **新 RPC `sessiongraph.child({ sessionId, childId })`**:
   - 热路径:`sessions.get(childId)` + `sp.snapshot(childSession)` → `{ nodes, cursor, title }`
   - 冷路径:投影缺失 → `sessionQuery.readSession(childId)` + 重放 `applyGraph` → 同样返回
3. **switchRuns 补 title**:监听 `subagent/descriptor`(若存在)或首次 child RPC 时 `sessionQuery.readTitle(childId)` 缓存
4. **新 RPC `sessiongraph.children({ sessionId })`**(可选):一次返回全部委派记录(含 title),供父图谱渲染委派节点时直接带标题

### Client 半体(pkg-62.client.js 扩展)

1. **数据**:点击委派节点(单击)→ `host.call('sessiongraph.child', ...)` → 得子图谱节点流 → 用现有 `buildItems` + `buildLayout` 生成子布局(相对坐标系)
2. **布局递归**:父 `buildLayout` 为**展开态**委派节点预留"子图块"空间(在委派节点位置开洞:子图块 = 子布局整体平移到父坐标,包一层虚线边框 + 浅背景 + 头部「委派→xxx」+ 折叠按钮);子图块高度计入父链节点间距
3. **渲染**:子图块复用同一套节点/边/标签渲染逻辑(抽公共渲染函数,`renderGraph(children, L, ctx)`);子图块内交互与父图一致(悬停/选中/缩放跟随父图视口,不单独缩放——保持同一坐标系)
4. **跳转降级**:子图原子点击 → `scrollToKey`;失败 → 图谱内聚焦(选中 + 脉冲,不滚动聊天)
5. **折叠**:展开态委派节点头部折叠按钮 → 收回子图块恢复小圆点;`folded['child-'+childId]` 状态
6. **递归**:子图内孙级委派节点同样可展开(深度上限 3,防爆)
7. **委派节点**:单击展开(无子数据时降级为跳转),双击跳转 tool-call 锚点;悬停 title = 「委派→xxx · 展开子图谱(单击)/跳转(双击)」

### 性能与边界

- 每展开一个委派节点 = 一次子布局计算(memo 按 childId + 子投影引用缓存);演示规模可控
- 深度上限 3;子图块最小高度限制(子图过长时子图块内滚动?——先整体显示,超长截断折叠,列为后续)
- React.memo 比较器:父 base/cursor 引用变化 + 展开集变化即重算

## Acceptance criteria

- [ ] 单击父图谱委派节点 → 就地展开子会话完整原子图谱(全部节点种类 + 折叠 + 缩放/平移跟随)
- [ ] 子图块带边框/标题,可折叠回小圆点;双击委派节点仍跳转 tool-call 锚点
- [ ] 子图谱原子点击跳转:子会话在聊天视图时滚动定位;不在时图谱内聚焦降级
- [ ] 冷启动(子会话已结束/重启后)仍能显示子图谱
- [ ] 孙级委派可再展开,深度上限 3
- [ ] 子会话标题显示在子图块头部

## Blocked by

- 无(T3/T4 已关闭,details 图谱成熟)

## 决策记录

- [x] 形态:A 就地内联展开(2026-08-14 用户拍板)
- [x] 委派节点点击:单击展开 / 双击跳转(2026-08-14 用户拍板)
- [ ] 子图块超长时的处理(整体显示 vs 块内滚动 vs 自动折叠)— 实现时定
- [ ] 深度上限确认 3 — 实现时定
