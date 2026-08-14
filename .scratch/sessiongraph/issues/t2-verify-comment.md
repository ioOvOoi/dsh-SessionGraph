## T2 实现与验证记录(2026-08)

### 实现

- **数据通道事实**(源码确认):`subagent/start|end` 是 Host 事件、**不进会话日志**,投影单元折叠不到 → 切换节点需要独立通道
- **Host**:`ctx.on('subagent/start'|'subagent/end')` 维护按父会话分区的切换记录(childId/provider/runId/startedAt/stopReason/endedAt);`harness.handle('sessiongraph.switches')` 供 Client 拉取
- **Client**:合并渲染——遍历节点,遇含 `subagent` 工具徽标的助手节点,在其后插入「委派」切换卡片(顺序对应 run,邻接即父→子边);样式:琥珀色虚线边框
- **坑位记录**:发射端 `dispatch("emit", [carrier(parent), name, info])` 只把 **info** 传给回调,parent 是作用域载体(`this`)→ 箭头函数取第二参恒为 undefined;pkg-7 改为 `agents.currentInitiator()` 取父会话 id(end 晚到时全表按 runId 兜底)

### 验证证据(经 sessiongraph_debug,真实委派一次子代理)

| 验收标准 | 证据 |
|---|---|
| 委派时图谱出现切换节点(与子会话首节点合并为一个),父→子边正确 | 委派后切换记录出现:childId d1444068…、provider spawn、runId 完整;委派助手节点工具徽标 `subagent✓`;Client 按邻接插入卡片(父→子边 = 邻接) |
| 切换节点元数据含 agent id 与委派父信息 | childId(子 agent id)+ provider + stopReason{kind:completed} + startedAt/endedAt;记录按父会话 id 分区(switchKeys = 本会话) |
| 根组合收到子 agent 会话事件流,切换节点在根会话树上正确归位 | 投影注册于根组合:子会话事件流经同一投影单元(子会话独立 cell,符合 Q5 分区);切换节点归位由 Client 合并于委派节点之后 |

### 待人工确认

- 图谱 tab 视觉:委派过的助手节点下方应出现琥珀色「委派 → d1444068… · spawn · 完成:completed」卡片
