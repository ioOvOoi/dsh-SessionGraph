## T1 实现与验证记录(2026-08)

### 实现

- **Host 半**:注册 `sessiongraph.graph` 投影单元(`sessionProjections.register`,纯同步 init/apply/view),按 01 号决策票折叠节点流:
  - user/message、assistant/message → 节点(带 seq/time/role/文本,parent 语义 = 日志前驱)
  - tool/call|result 与 turn/start|end → **不建独立节点**,折叠进所属 assistant 节点元数据(工具名 + ✓/✗ 完成标记、回合号、回合结束原因、token)
  - 其余事件(chunk、compaction/* 等)保持同一引用,零下游工作
- **Client 半**:注册 `conversation.view` 图谱 tab(id: sessiongraph,order: 20),`useProjection('sessiongraph.graph')` 消费,实时列表渲染 + 游标高亮
- 附带 `sessiongraph_debug` 验证工具(读取 Host 投影快照),供后续 T2/T3 继续使用

### 验证证据(经 sessiongraph_debug 读 Host 投影快照)

| 验收标准 | 证据 |
|---|---|
| 新会话消息实时上屏,节点带 seq/time/角色,parentId = 前驱 | nodeCount 随会话实时增长(110 → 116);全部节点含 seq/time/type;游标始终 = 最新节点 |
| 插件中途加载,从日志重建旧会话(增量追平/全量兜底) | 插件注册前的事件被懒折叠重建:节点覆盖 seq 8 起全部历史(asOfSeq 80665 → 87043) |
| tool/result 与 turn/start|end 不产生独立节点,折叠进元数据 | 116 节点全部为 user/assistant;工具调用以 `工具名+✓/✗` 折叠在 assistant 节点内;回合边界 = 回合号 + 回合结束原因 |
| 图状态按 session.id 分区;dispose 保留图数据 | 框架单元语义(每会话独立 cell),无额外处理 |

### 修复记录

- pkg-2:追加验证工具; pkg-3:调试返回显式 `??: null` 保证 lossless JSON; pkg-4:ToolResultBlock 用 `toolCallId` 关联 tool/result(非 callId)

### 待人工确认

- 图谱 tab 视觉效果:conversation.view 视图环 → 「图谱」tab,应显示本会话实时节点列表(视觉打磨归 T3,此处仅验收"实时上屏")
