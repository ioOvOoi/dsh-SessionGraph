# 设计张力笔记:DSH 会话模型 vs Pi /tree 式跳转

来源:`docs/dsh-host-event-system-research.md`(subagent 侦察,证据:文件+行号)

## DSH 原生会话模型(事实)

- 会话 = **线性 append-only 日志**:消息经 `session/event`(增补流)追加,事件带 `seq` 递增。
- **没有"会话内分支/active 游标"概念**——一条日志就是一条时间线。
- 原生"分支"= **fork 出新会话**(`SessionStore.fork(source, boundary?, childSessionId?)`),跨会话用 `ctx.sessionQuery.traceSession` 追溯祖先+子树(会话间关系,不是会话内)。
- 模型上下文 `session.deriveMessages()` 基于日志快照,线性。

## 用户要的(Pi /tree 式)

- **同一会话内换枝**:跳转到历史节点,新消息从那里长出新分支,旧分支保留在同一会话视图里。
- 明确说"是一个文件里换,不是 fork"。

## 张力

DSH 没有会话内分支;跳转 = 移动一个"视图游标",但 DSH 的日志只能线性追加。

## 候选方案(供 grilling)

- **方案 A(推荐,与 Pi 同构)**:插件维护 **sidecar 会话图**(nodes + parentId + activeCursor,存插件自己的持久化)。跳转 = 改 activeCursor;新消息照常 append 进 DSH 日志(带 seq),图谱挂到游标节点下。DSH 日志保持线性,图谱呈现分支。Pi 的 JSONL 也正是这样(线性文件 + parentId 字段 + active leaf)。
  - 待查:跳转后继续对话,旧分支后续消息是否仍进入模型上下文(污染)?→ 依赖 compaction/边界研究(T02)。
- **方案 B**:跳转 = fork 新会话。违背用户要求(多会话文件),否决,除非 A 的上下文污染无解。
- **方案 C**:跳转 = 从某 seq 截断日志。破坏历史,否决。

## 官方立场(新增,官方文档确认)

- **DSH 官方明确"会话分支/树结构"暂缓**(`dsh-session/README.zh.md:141`):"会话分支/树结构(pi 风格条目树):除非需要超越基于边界的 `fork()` 能力,否则暂缓。" → 平台官方不打算做 pi 风格会话树,**SessionGraph 正是填补这个空白**,方案 A(sidecar 图)与官方方向不冲突。

## 待研究确认(阻塞中)

- DSH 压缩/compaction 机制(能否在跳转时隔离旧分支上下文)
- sidecar 持久化的推荐位置(DSH 有没有插件数据目录惯例;或 `sessionProjections` 是否适用)
- Client 侧 Slot 的最终确认(`conversation.view` tab 模式)
