# DSH Host 侧事件系统调研(实时会话图谱插件前置研究)

> 调研对象:编译后 npm 包(`.../node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/<pkg>`),
> 证据来源为各包的 `lib/types/*.d.ts` 类型声明与 `lib/index.js` 运行时实现。
> 结论均带「文件 + 行号 + 关键代码」原样证据。
> 根目录:`C:\Users\Administrator\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\`
> (下文所有相对路径均以此为根)。

---

## 0. 结论速览(给编排者)

- Host 侧动态 Cordis 插件用 `ctx.on('xxx', (...args) => …)` 可监听的、与消息/会话/agent 生命周期相关的事件,**全部**声明在 `declare module '@deepseek-ai/cordis' { interface Events {…} }`,共 4 类来源:
  1. **会话事件**(`dsh-session`):`session/created`、`session/disposed`、`session/event`、`session/flush`;
  2. **agent 生命周期事件**(`dsh-agent` runtime-types):`agent/created`、`agent/disposed`、`agent/status`、`agent/inbox/*`、`agent/session-start`、`agent/pre-step`、`agent/request`、`agent/request-error`、`agent/turn-stopping`、`agent/error`;
  3. **子 agent 事件**(`dsh-subagent`):`subagent/provider-added`、`subagent/provider-removed`、`subagent/start`、`subagent/end`;
  4. agent-loop 启动失败:`agent-loop/config-start-failed`。
- **关键结论:不存在独立的 `assistant/message`、`user/message`、`message` 事件!** 所有消息级事实
  (`user/message`、`assistant/message`、`assistant/chunk`、`tool/call`、`tool/result`、`turn/*`、`step/*` 等)
  都是**会话日志事件类型**(`SessionEventMap`),统一通过 **`session/event` 这一个"增补流"事件**推送给监听者。
- 因此,**实时订阅每条消息的正确姿势 = 监听 `session/event`**,收到后用 `event.type` 做判别联合(discriminated union)。
- **事件是 scope 过滤的**:`session/*` 事件带 `this: Scoped<Session>`,`agent/*` 事件带 `this: Scoped<Agent>`。
  在根/host 组合层注册(未打 scope 标签)的监听者能收到**全部** agent/会话的事件(事件只向上流,祖先 scope 看到所有后代);在某个 agent 的 scope 内注册则只收到该 agent(含其后代)的事件。
- **反查历史(CQRS/读接口)**:首推 `ctx.sessionQuery`(最全),还有 `ctx.sessions`(仅活会话)、`ctx.sessionPersistence`(持久层)、`ctx.sessionProjections`(投影读模型/变更推送)以及 `ctx.subagents.listChildren/listDescendants`(子 agent 树)、`ctx.sessionReferenceResolver`(跨会话引用快照)。

---

## 1. 可监听事件总清单(含每个事件的精确参数)

### 1.1 会话事件 —— `dsh-session`(`lib/types/index.d.ts`)

`declare module '@deepseek-ai/cordis' { interface Events {…}}`(第 28–76 行)。全部四事件都带 `this: Scoped<Session>`。

| 事件名 | 声明签名(原文) | 语义(节选 JSDoc) |
|---|---|---|
| `session/created` | `'session/created'(this: Scoped<Session>, session: Session): void;`(L44) | 会话发布时的创建公告;同步 throw 可否决并回滚(成对 disposal)。scope 过滤:agent 作用域监听者只收到经该 agent 上下文进入的会话。 |
| `session/disposed` | `'session/disposed'(this: Scoped<Session>, session: Session): void;`(L54) | 公告过的会话离开 store(含发布回滚)时触发一次。监听失败仅记录并隔离。复用 owner scope。 |
| `session/event` | `'session/event'(this: Scoped<Session>, session: Session, event: SessionEvent): void;`(L66) | **提交后、fire-and-forget 的增补流**。`event` 是**原样记录**的日志事件。scope 过滤。这是订阅每条消息的核心事件。 |
| `session/flush` | `'session/flush'(this: Scoped<Session>, session: Session): Promise<void> \| void;`(L75) | 异步并行持久化检查点;所有监听者跑完且全部等待。 |

关键 JSDoc 原文(L66-67):「Post-commit, fire-and-forget append feed. … @param event - the appended event, exactly as recorded.」

**`session/event` 的运行时发射点** —— `dsh-session/lib/index.js` `Session.append()` 第 1440–1480 行:

```
1470:  this.log.push(event);
1471:  this.eventsSnapshot = void 0;
1472:  if (callbacks !== void 0 && entry !== void 0) invokeContainedSessionObservers(entry.emitCtx, "session/event", entry.id, callbackArgs, callbackArgs);
```
其中 `callbackArgs = [this, event]`(L1464),即投递参数 **`(session, event)`**,与类型签名一致。追加是**同步**的(`this.log.push`),但 `session/event` 的监听回调在提交后执行,失败被隔离、不会让追加失败。

> 注:`Session.append` 的构造函数种子(replay/fork/resume)产生的旧事件**不**经 `session/event` 推送(L1327-1344:constructron seeds do not emit)。想拿全量历史要**反查**(见 §4)。

### 1.2 会话日志事件类型词汇表 —— `SessionEventMap`(`dsh-session/lib/types/types.d.ts` L223–354)

这些**不是** Cordis 事件,而是 `session.append(type, data)` 写入日志的 `type`,监听者从 `session/event` 的 `event.type` 判别:

| type | data 形状(L223-354) | 是否上 surface(`SurfaceEventType` L362) |
|---|---|---|
| `turn/start` | `{ turn: number }` | 否 |
| `turn/end` | `{ turn: number; reason: TurnEndReason }` | 否 |
| `step/start` | `{ turn; step }` | 否 |
| `step/end` | `{ turn; step }` | 否 |
| `user/message` | `UserMessage` | **是(append)** |
| `assistant/chunk` | `{ turn; step; chunk: StreamChunk }` | 否(仅 token 粒度) |
| `assistant/message` | `{ turn; step; message: AssistantMessage; usage?: TokenUsage }` | **是(append)** |
| `tool/call` | `{ turn; step; callId; name; arguments }` | 否 |
| `tool/result` | `{ turn; step; message: ToolResultMessage; error?; meta?: JsonValue }` | **是(append)** |
| `todo/write` | `{ todos: TodoItem[] }` | 否 |
| `request/header` | `{ header: EpochHeader; reason }` | 否 |
| `request/context` | `RequestContext` | 否 |
| `session/end-seed` | `Record<string, never>` | 否 |

surface 事件类型:`user/message | assistant/message | tool/result`(L362),它们额外带 `surfaceOp` 与 `sourceEventSeqs`。schema/判别联合定义在 `types.d.ts` L420–452(`SessionEvent` discriminated union:`type`/`seq`/`time`/`data`)。

> 三方扩展也可向 `SessionEventMap` 加类型,例如 `dsh-schedule` 追加 `'schedule/change'`(`lib/types/types.d.ts` L172-180 `declare module '@deepseek-ai/dsh-session/types' { interface SessionEventMap { 'schedule/change': ScheduleChange; } }`),这类事件同样会经 `session/event` 流出。

### 1.3 agent 生命周期事件 —— `dsh-agent/lib/types/runtime-types.d.ts`(L135–322)

全部带 `this: Scoped<Agent>` 且 **scope 过滤(agent 作用域只收对应 agent)**。`@mode` 标注发射方式(emit = fire-and-forget;serial/waterfall = 可拦截)。注意**没有** `agent/start` / `agent/turn` / `agent/end` 这类名字;实际是:

| 事件 | 签名(原文) | 说明 |
|---|---|---|
| `agent/created` | `'agent/created'(this: Scoped<Agent>, payload: { agent: Agent }): void;`(L146) | 配置完成、会话已发布。同步失败可否决发布。 |
| `agent/disposed` | `'agent/disposed'(this: Scoped<Agent>, payload: { agent: Agent }): void;`(L157) | 离开注册表。 |
| `agent/status` | `'agent/status'(this: Scoped<Agent>, payload: { agent: Agent; status: AgentStatus }): void;`(L169) | `idle ⇄ running`。 |
| `agent/inbox/inserted` | `'agent/inbox/inserted'(this: Scoped<Agent>, payload: { agent: Agent; message: UserMessage }): void;`(L180) | 一条消息进入活跃 inbox。 |
| `agent/inbox/claimed` | `'agent/inbox/claimed'(this: Scoped<Agent>, payload: { agent: Agent; message: UserMessage; turn: number }): void;`(L194) | 在其开放回合内被取走。 |
| `agent/inbox/discarded` | `'agent/inbox/discarded'(this: Scoped<Agent>, payload: { agent: Agent; message: UserMessage }): void;`(L206) | 从活跃 inbox 被丢弃。 |
| `agent/session-start` | `'agent/session-start'(this: Scoped<Agent>, payload: { agent: Agent; source: SessionStartSource }): void;`(L220) | 会话生命周期开始(首个回合前一次),通知用、不可否决。 |
| `agent/pre-step` | `'agent/pre-step'(this: Scoped<Agent>, payload: { agent; messages: UserMessage[]; turn; step; signal }, next) => Promise<PreStepDecision>`(L235) | **waterfall**,可拒绝/替换进入回合的消息。 |
| `agent/request` | `'agent/request'(this: Scoped<Agent>, payload: { agent; turn; step; signal }, next) => Promise<LlmCallConfig>`(L254) | **waterfall**,可替换冻结的调用配置。 |
| `agent/request-error` | `'agent/request-error'(this: Scoped<Agent>, payload: { agent; turn; step; provider; failure: LlmFailure; retryPolicy; signal }, next)`(L275) | **waterfall**,处理失败请求。 |
| `agent/turn-stopping` | `'agent/turn-stopping'(this: Scoped<Agent>, payload: { agent; turn; signal }): Promise<void> \| void`(L301) | **serial**,回合即将关闭。 |
| `agent/error` | `'agent/error'(this: Scoped<Agent>, payload: { agent; turn; step; error: unknown }): void;`(L316) | 回合/步骤报错,emit。 |

运行时分发器(scope carrier 耦合)在 `dsh-agent/lib/types/dispatch.d.ts`:
- `AgentSubjectEvent`(L24-28):凡是 `this: Scoped<Agent>` 且首参带 `agent` 字段的事件;
- `agentCarrier(agent): Scoped<Agent>`(L83)、`agentEvents(ctx, agent, carrier)`(L93)、`emitAgentEvent(...)`(L101)。

### 1.4 子 agent 事件 —— `dsh-subagent/lib/types/index.d.ts`(L63–96)

| 事件 | 签名 | 说明 |
|---|---|---|
| `subagent/provider-added` | `'subagent/provider-added'(provider: SubagentProvider): void;`(L69) | **无 scope**。 |
| `subagent/provider-removed` | `'subagent/provider-removed'(name: string): void;`(L75) | **无 scope**。 |
| `subagent/start` | `'subagent/start'(this: Scoped<SubagentRuntime>, info: SubagentRunInfo): void;`(L86) | 提供方建立了已发布的子 agent。scope 以**委派父 agent** 为 carrier;in-process 提供方时 `ctx.agents.get(info.id)` 可在通知内解析。 |
| `subagent/end` | `'subagent/end'(this: Scoped<SubagentRuntime>, info: SubagentRunEndInfo): void;`(L95) | 子 agent settled;与 `start` 同 scope 观众。 |

> 子 agent 消息本身**也**走各自会话的 `session/event`;`subagent/start|end` 补的是「委派/收尾」关系边(父→子、结果)。

### 1.5 其他相关(次要,agent/会话外)

- `agent-loop/config-start-failed`(`dsh-agent-loop/lib/types/index.d.ts` L36-39):配置化 agent 启动失败,payload `{ sessionId: SessionId; error: unknown }`,emit,无 scope。
- `agent-preset/selected`(`dsh-agent-presets/lib/types/types.d.ts` L12):`(sessionId: SessionId, agentPreset: string): void`,无 scope。
- `session-telemetry/record`(`dsh-session-telemetry/lib/types/index.d.ts` L40):`(record, next)` 串行。
- `llm/stream`(`dsh-llm/lib/types/index.d.ts` L43):每次流式模型调用的 waterfall(可用于蹭 token 级 chunk),边界 `this: LlmRuntime`。

---

## 2. "消息事件"的特殊说明(关键)

**不存在 `assistant/message` / `message` 独立 Cordis 事件。** 证据:
- 对整个 `@deepseek-ai` 下全部 `*.d.ts` grep `interface Events` 得到 29 处(见 §6),其中**没有**任何一条名为 `message` / `assistant/message` / `user/message` 的 Cordis 事件。
- 对事件名 grep `'(agent|session|user|assistant|message)[^']*'\(` 得到 19 处(§6),消息相关的事件名**只出现**在 `session/event`(承载),以及 `agent/inbox/inserted|claimed|discarded` —— 即**消息只经过两条路**:
  1. **持久化事实**:任何人/机消息最终写成 `session/event`(事件类型 `user/message`、`assistant/message`、`assistant/chunk`、`tool/*`)。—— 订阅它即可。
  2. **inbox 流转信号**(可选、仅活跃 agent):`agent/inbox/inserted`(进来)、`agent/inbox/claimed`(被取走进回合)、`agent/inbox/discarded`(丢弃)。
- 因此判断一条"完整 assistant 消息"的依据 = 收到 `session/event` 且 `event.type === 'assistant/message'`(整块),或 `assistant/chunk`(token 粒度)。

---

## 3. 事件是否 scope 过滤(对多 agent / 子 agent 的含义)

### 3.1 机制证据

`dsh-scope/lib/types/index.d.ts`:
- `Scoped<T>`(L18-20)是"仅路由用 carrier",不暴露 subject 属性,subject 通过事件参数传入。
- `scopeTarget(base, key)`(L97):"preserves the base filter, admits untagged listeners globally, **and admits tagged listeners for a matching key or any of its ancestors** … a listener owned by an enclosing scope receives every descendant scope's events … events flow **up the chain, never down**."—— 即**祖先 scope 看到所有后代,后代看不见同侪/祖先已之上**。
- `scopeOf(ctx)`(L84)、`createScope(ctx, key)`(L78)。

会话事件的 scope 来源(`dsh-session/lib/index.js` L1689-1701 `enter`):
```
1691:  const carrier = scopeTarget(session, scopeOf(this.ctx));
```
即会话的 carrier 绑定到**把它 enter 进去的那个 context 的 scope**。在 agent 场景,agent-loop 用 `agent.ctx.sessions.enter(session)`(`dsh-agent-loop/lib/index.js` L1159),而 `agent.ctx` 是 agent 的 scoped context → 会话事件挂在**该 agent 的 scope** 上。

agent 事件 carrier 由 `dsh-agent/lib/types/dispatch.d.ts` 的 `agentCarrier(agent): Scoped<Agent>`(L83)统一构造。

### 3.2 对实时会话图谱插件的含义

- **在 HOST 组合层(根 scope)注册**(动态插件默认挂载点在根组合)监听 `session/event`、`session/created|disposed`、`agent/*`、`subagent/start|end` → **能收到全部 agent(含全部子 agent 后代)的事件**。适合做全量图谱。
- 在某个 agent 的 scope 内注册(通过该 agent 的 `agent.ctx` 派生) → 只收该 agent 及其后代的事件,天然实现"按子图过滤"。
- **scope 不直接告诉你 agent**:`session/event` 携带的是 `(session, event)`,`session` 身上可直接拿 `session.id`;agent 与会话**共享同一 id**(`dsh-agent/lib/types/index.d.ts`:"one exact sessionId shared by the agent registry and session log",L61;`ctx.agents.get(id: SessionId): Agent | undefined` L346-349)。所以事件里用 `ctx.agents.get(eventSession.id)` 即可关联到 agent 对象。
- `subagent/start|end` 的 scope 以**委派父 agent** 为 carrier(`dsh-subagent/lib/types/index.d.ts` L79-81):父 scope 监听者能看到其所有直接委派 → 适合建"父子关系边"。

---

## 4. CQRS / 读接口(反查历史)

### 4.1 `ctx.sessions` —— 仅活跃(内存)会话(`dsh-session/lib/types/index.d.ts` L290-416 `class SessionStore`)

| 方法 | 签名 | 说明 |
|---|---|---|
| `get` | `get(id: SessionId): Session \| undefined`(L393) | 查活会话(非活/已构造未进入者拒绝)。 |
| `list` | `list(): Session[]`(L398) | **所有活会话**,按创建序,返回新数组。 |
| `fork` | `fork(source, boundary?, childSessionId?): Session`(L413) | 从活会话稳定 seq 前缀创建活子会话(可建图谱分支)。 |
| `prepare/enter/announce/flush` | (L336/359/369/385) | 会话生命周期原语,一般不需要直接调用。 |

`Session` 对象本身(L106-267):`session.events`(只读快照)、`session.seq`、`session.id`、`session.header`、`session.deriveMessages(): Message[]`(当前模型历史)、`session.requestHeader/requestContext()`、`session.firstLiveSeq`。

> 局限:`get/list` 只有**活跃**会话(当前进程内存),不含已持久化但未活化的历史会话。历史要往下看。

### 4.2 `ctx.sessionQuery` —— 活+持久合并的历史查询引擎(**首推**)(`dsh-session-query/lib/types/index.d.ts`;具体后端 `dsh-session-query-sqlite`)

`declare module '@deepseek-ai/cordis' { interface Context { sessionQuery: SessionQueryEngine; } }`(L19-23)。方法(L31-141):

| 方法 | 签名 | 用途 |
|---|---|---|
| `listSessions` | `listSessions(signal?): Promise<SessionRecord[]>`(L55) | **列全部逻辑会话**(活优先),newest-first。`SessionRecord = { header; live; persisted }`(`types.d.ts` L14-21)。 |
| `readSession` | `readSession(id): Promise<SessionLogSnapshot>`(L62) | 读**完整原始日志**(复查重放后)。`SessionLogSnapshot = { session: SessionHeader; events: SessionEvent[] }`(types L32-37)。 |
| `filterSessions` | `filterSessions(filters, signal?): Promise<SessionRecord[]>`(L69) | 按条件过滤整个语料。 |
| `listEvents` | `listEvents(sessionId): Promise<SessionEventRecord[]>`(L99) | 单会话原始事件轻量清单(seq 升序)。 |
| `filterEvents` | `filterEvents(sessionId, filters)`(L106) | 过滤语义事件文档。 |
| `readSurface` | `readSurface(sessionId): Promise<SessionSurfaceSnapshot>`(L115) | 当前模型 surface 快照。 |
| `readTitle/readTitleSnapshot(s) | (L76/83/93) | 读最新标题。 |
| **`traceSession`** | `traceSession(sessionId, signal?)`(L123) | **追溯祖先与所有后代(子树)**。`SessionLineageTrace`(types L59-76)= `{ target; ancestors: SessionRecord[]; descendants: SessionLineageNode[]; complete; root|unresolvedParentId }`。**正是建父子图谱现成接口。** |
| `traceEvent` | (L131) | 追踪单事件被替换/引用的来源与发展。 |
| `readEvent` | (L138) | 读单事件 + 相邻窗口。 |
| `searchSessions/searchEvents` | (L42/49) | 全文/语义检索(后端实现)。 |

### 4.3 `ctx.sessionPersistence` —— 原始持久层(`dsh-session-persistence/lib/types/index.d.ts` `abstract class SessionPersistence`,L60+)

- `prepare(id, signal?): Promise<SessionPreparation>`(L118):`SessionPreparation` 含 `meta`(SessionHeader)+ `events`(`index.d.ts` L20-26 `SessionInspection`)。
- `readFrom(id, fromSeq, signal?)`(L167):从某 seq 起读后缀(**给读模型/增量用**)。
- `list(signal?)`(L176):**轻量列会话**(仅 metadata,不全量解析)。
- `listSnapshots`(L187)、`readRaw`(L90)、`append`(L107)。
- `ctx.sessionPersistence` 在 `index.d.ts` L38-42 注册。

### 4.4 `ctx.sessionProjections` —— 投影(CQRS 读模型)注册 + 变更推送(`dsh-session-projection/lib/types/index.d.ts`)

- 服务在 L121-229 `class SessionProjectionRegistry`;`declare module` 注册于 L22-26。
- `register(def)`(L137):注册 `{ key, schema, init, apply(state, event), view(state), stateVersion }`。registry 订阅 `session/event` 一次(L108-109:"subscribes to session/event once"),对每个已提交事件 eager 驱动每个投影单元的 `apply`;状态引用变化(非 `Object.is`)触发 `onChanged`(L144)回 `(session, key, value, seq)`。
- `snapshot(session)`(L153):单会话一致读cut(每个 key 的当前值 + `asOfSeq`)。
- `checkpoint/restoreFloor/viewCheckpoint/restore`(L168-222):持久化缓存/冷读(从存储后缀 + 检查点折返)。
- **含义**:图插件既可直接消费 `session/event` 自建投影,也可注册一个自定义投影单元让框架替它增量维护一个"图谱状态",再用 `onChanged`/`snapshot` 消费。`SessionProjectionMap` 可被域插件 merge 扩展(`types.d.ts`)。

### 4.5 `ctx.subagents` —— 子 agent 树遍历(读接口)(`dsh-subagent/lib/types/index.d.ts` L213-229)

- `listChildren(parentSessionId, signal?)`(L213):列出某父会话的直接子 agent(不需加载/恢复 agent;活会话优先 + 持久;每个子 agent 的 mode/label 来自投影单元)。
- `listDescendants(rootSessionId, signal?)`(L229):**完整后代树,稳定 pre-order**,每条带 `parentId` 与 `depth`。也是建子树的可选接口。

### 4.6 `ctx.sessionReferenceResolver` —— 跨会话引用快照(`dsh-session-reference/lib/types/index.d.ts` L23-47)

- `listCandidates(agent, query?, limit?, signal?)`(L36):列出可被该 agent 引用的会话候选(按 cwd 亲缘排序)。
- `prepare(agent, content, references, signal?)`(L45):聚合某条引用到持久上下文。**这不是通用查询 API**,而是"提及其他会话"用的快照预备服务。

### 4.7 「反查历史」推荐组合(给图插件)

1. 全量会话清单 + 元数据:`ctx.sessionQuery.listSessions()`(含 live/persisted 标记),冷启动建图谱顶点。
2. 父子/祖先-后代边:`ctx.sessionQuery.traceSession(id)` 或 `ctx.subagents.listDescendants(root)`(前者持久可靠、含祖先;后者专门列子 agent、带 parentId+depth)。
3. 某会话消息:`ctx.sessionQuery.listEvents(id)`/`readSession(id)`/`readSurface(id)`,或 `ctx.sessionPersistence.readFrom(id, fromSeq)` 增量补齐。
4. 实时增量:订阅 `session/event`(最新增补)+ `agent/*` + `subagent/start|end`,用 `traceSession`/`readSession` 反查补全缺失段。

> 注区分:`dsh-session-query` = 通用历史读/追溯/检索;`dsh-session-projection` = 投影注册/变更推送;`dsh-session-query-sqlite` 是 `sessionQuery` 的 SQLite 后端实现。

---

## 5. 未命中的包结论

- **`dsh-base`**:`lib/types/index.d.ts` 仅 `export {}`,纯 profile bundle(`cordis.patch.yml`),**无运行时 API,无事件**(L8)。
- **`dsh-agent-instructions`**:`lib/types/index.d.ts` 无 `interface Events`,只导出配置/文件加载/渲染工具函数(L1-20),**不声明任何 Cordis / 会话事件**。
- **`dsh-session-reference`**:只注册 `ctx.sessionReferenceResolver`(§4.6),**其本身无 `Events` 声明**(index.d.ts L17-21 只 declare Context)。
- **`dsh-session-projection`**:只声明 `ctx.sessionProjections` 服务,在 `index.d.ts`**没有自有 `Events` 声明**(它靠内部订阅 `session/event` + 自己的 `onChanged` 回调)。
- **`dsh-schedule`**:其事件 `'schedule/change'` 是**注入 `SessionEventMap` 的会话日志事件类型**(`lib/types/types.d.ts` L172-180),**不是** Cordis `Events`;消费它仍走 `session/event`。
- **`dsh-agent-loop`**:唯一新增事件 `agent-loop/config-start-failed`(§1.5),agent 生命周期事件本体在 `dsh-agent`。

---

## 6. 证据索引(grep 结果)

- 全部 `interface Events` 出现位置(`declared in declare module '@deepseek-ai/cordis'`),共 29 处(部分与任务相关):
  `dsh-agent-loop/lib/types/index.d.ts:26` · `cordis/lib/types/events.d.ts:216`(核心注册) ·
  `dsh-agent-presets/lib/types/types.d.ts:4` · `dsh-agent/lib/types/runtime-types.d.ts:135` ·
  `dsh-session/lib/types/index.d.ts:32` · `dsh-subagent/lib/types/index.d.ts:63` ·
  `dsh-session-telemetry/lib/types/index.d.ts:21` · `dsh-llm/lib/types/index.d.ts:30` ·
  (其余:loader/hmr/client-*/fs/commands/credentials/goal/workflow/skill/system-prompt/settings/user-approval/storage-domain/tools 等,与 agent/会话图非直接相关)
- 事件名 grep `'(agent|session|user|assistant|message)[^']*'\(` 完整命中:
  `dsh-agent/lib/types/runtime-types.d.ts` L146 `agent/created`、L157 `agent/disposed`、L169 `agent/status`、L180 `agent/inbox/inserted`、L194 `agent/inbox/claimed`、L206 `agent/inbox/discarded`、L220 `agent/session-start`、L235 `agent/pre-step`、L254 `agent/request`、L275 `agent/request-error`、L301 `agent/turn-stopping`、L316 `agent/error`;
  `dsh-agent-presets/lib/types/types.d.ts` L12 `agent-preset/selected`;
  `dsh-agent-loop/lib/types/index.d.ts` L36 `agent-loop/config-start-failed`;
  `dsh-session/lib/types/index.d.ts` L44 `session/created`、L54 `session/disposed`、L66 `session/event`、L75 `session/flush`;
  `dsh-session-telemetry/lib/types/index.d.ts` L40 `session-telemetry/record`。

## 7. 给实现者的落地建议(一句话版)

- **实时订阅**:`ctx.on('session/event', (session, event) => …)`(根组合注册,收全部 agent/子 agent);消息完整性以 `event.type ∈ {user/message, assistant/message, tool/result, assistant/chunk}` 判断。
- **生命周期顶点/边**:`session/created` + `agent/session-start`(建点)、`session/disposed` + `agent/disposed`(删点)、`agent/status`(运行态)、`subagent/start|end`(建父子边)、`turn/*`/`step/*`(回合粒度边)。
- **反查**:`ctx.sessionQuery.traceSession`(祖先+子树)、`listSessions`、`readSession`/`listEvents`;或用 `ctx.sessionProjections.register` 自维护增量状态。
- **关联到 agent**:`session.id === agent.id`(同一 id),事件里 `ctx.agents.get(session.id)` 即可取 agent。
