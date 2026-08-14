# DSH(DeepSeek Harness)平台架构能力研究

> 目的:为"实时会话图谱插件"(SessionGraph)做平台能力前置调研。
> 研究方式:直接读取安装的 DSH 编译产物源码(ESM `lib/*.js` + 类型 `lib/types/*.d.ts`)、运行期的真实会话文件,以及加载 `editing-cordis-compositions` / `cordis-plugin-development` 能力。所有结论均附**源码文件 + 行号 + 关键原文**证据。凡某项能力不存在,均注明"**不存在**"。

## 源码与产物位置

- DSH 安装根:`C:\Users\Administrator\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\`
  - 本包本身几乎没有源码(只有 `lib/*.js` 几个 bundle 和 `config/agent-presets/`),**真正的模块源码被拆成约 200 个 `@deepseek-ai/dsh-*` 子包**,位于 `…\@deepseek-ai\dsh\node_modules\@deepseek-ai\`(下文简称 `<root>`),每个子包是 ESM 编译产物(`lib/index.js` 实现 + `lib/types/*.d.ts` 声明)。
- 单包结构示例:`dsh-session-persistence-jsonl/package.json` 里 `"type":"module"`,`"main":"lib/index.js"`,`"types":"lib/types/index.d.ts"`。
- 部署来源 `package.json`(顶包):`"repository": …/deepseek-harness.git`,`"version": "0.1.0-rc.6"`。
- Cordis 组合由 `/config/agent-presets/*/cordis.patch.yml` + 各包内嵌 `cordis.patch.yml`(如 `dsh-web-app/cordis.patch.yml`、`dsh-base/cordis.patch.yml`)描述。

实际运行环境(`DSH_HOME = C:\Users\Administrator\.dsh`):
- 会话日志目录 `C:\Users\Administrator\.dsh\sessions\`(见第四节末的磁盘实证)。
- 通用键值存储 `C:\Users\Administrator\.dsh\storages\`(见 Q7)。

---

## 1. 会话存储

### 结论(先给结论)
- 会话采用**事件溯源(Event-sourced)追加写日志**:一个会话 = 一条不可变的 `SessionEvent` 时间序列。
- 磁盘上每个会话一个文件,`<root>/<project-dir>/<session-encoded-with-escapes>/session.jsonl[.zstd]`,格式为 **JSONL**(每行一个 JSON 对象);默认启用 **zstd 压缩**(`.jsonl.zstd`,一个会话文件是多个独立可解的 zstd frame 拼接)。
- 第一行是 `type:"session"` 的 **header 行**(会话元数据),其余每行是一条事件。
- **每条记录都有全局唯一的 seq(会话内单调)+ 时间戳(epoch ms)**;消息本体每条还有 **Message 级全局唯一 `id`(UUID)**。
- **存在 parentId / 分支 / 树形概念**:header 里字段 `parentSession?`、`seedLength?`、`origin?:'subagent'`、`delegationDepth?`;`session/end-seed` 事件标记继承边界;更有 `SessionStore.fork()` 用于从某会话创造子会话(分支)。

### 证据

**1) 存储根目录与文件路径**(`dsh-session-persistence-jsonl/lib/index.js`):
```js
// L133-135  projectDir: 每个 cwd 一个"项目目录"
function projectDir(root, cwd) { if (cwd === void 0) return join(root, "_no-cwd"); return join(root, projectKey(cwd)); }
// L145-147  每个会话一个目录
function sessionDir(root, cwd, id) { return join(projectDir(root, cwd), encodeSegment(id)); }
// L156-157  日志文件
function logPath(root, cwd, id, compression) { return join(sessionDir(root, cwd, id), `session${logSuffix(compression)}`); }
// L16-18  logSuffix
export function logSuffix(compression) { return compression === "zstd" ? ".jsonl.zstd" : ".jsonl"; }
// L12 物理编码
export type JsonlCompression = 'zstd' | 'none';
```
根目录由配置接入(`dsh-base/cordis.patch.yml:98-101`):
```yaml
- id: session-persistence-jsonl
  name: '@deepseek-ai/dsh-session-persistence-jsonl'
  config:
    root: !!js dshHomePath('sessions')      # → $DSH_HOME/sessions
```
而 `dsh-home-paths`: `DSH_HOME_DIR_NAME = ".dsh"`,`defaultDshHome()` = `~/.dsh`(`lib/types/index.d.ts:7-11`)。

**2) JSONL header 行(第一行)的字段**(`dsh-session-persistence-jsonl/lib/types/format.d.ts:24-35`):
```ts
export interface HeaderLine {
    type: 'session';
    version: number;
    id: SessionId;
    createdAt: number;      // epoch ms
    cwd?: string;
    parentSession?: SessionId;   // ← 树的边
    seedLength?: number;         // 继承的种子长度
    origin?: 'subagent';         // 是否为子 agent 会话
    delegationDepth: number;     // 委派深度(顶层=0)
    agentPreset?: string;
}
```

**3) SessionHeader(内存里的元数据,与磁盘一致)**(`dsh-session/lib/types/types.d.ts:40-78`):
```ts
export interface SessionHeader {
    readonly version: number;
    readonly id: SessionId;
    readonly createdAt: number;
    readonly cwd?: string;
    readonly parentSession?: SessionId;   // 被 fork 自哪个会话
    readonly seedLength?: number;
    readonly origin?: 'subagent';
    readonly delegationDepth?: number;
    readonly agentPreset?: string;
}
```

**4) 事件溯源模型 & 每条记录字段**(`dsh-session/lib/types/types.d.ts`):
```ts
// L6  SessionId = Branded<'SessionId'>
export type SessionId = Branded<'SessionId'>;
// L420-452 一条日志事件的结构
export type SessionEvent<T extends SessionEventType = SessionEventType> = {
    type: K;              // 判别字段
    seq: number;          // 会话内单调 seq(恒等于 log.length)
    time: number;         // Unix epoch ms
    data: SessionEventMap[K];
    ignorable?: true;      // 未知类型可跳过标记
} & (K extends SurfaceEventType ? {
    sourceEventSeqs?: number[];   // 本事件引用/派生自的先前事件 seq
    surfaceOp?: SurfaceOp;        // 'append' 或 {op:'replace',start,end}
} : object);
```

**5) 会话事件类型全集 `SessionEventMap`**(`dsh-session/lib/types/types.d.ts:223-354`):
```ts
'turn/start': { turn: number }              // 轮次开始
'turn/end':   { turn; reason: TurnEndReason } // 轮次结束原因(completed/aborted/blocked/error/max-tokens/interrupted)
'step/start': { turn; step }                 // 步骤开始(一次模型调用+其工具执行)
'step/end':   { turn; step }
'user/message': UserMessage                  // 用户消息(模型可见表面)
'assistant/chunk': { turn; step; chunk: StreamChunk }  // 原始流块(逐 token 保真)
'assistant/message': { turn; step; message; usage? }   // 组装完成的助手消息
'tool/call': { turn; step; callId; name; arguments }    // 工具调用
'tool/result': { turn; step; message; error?; meta? }   // 工具结果
'todo/write': { todos: TodoItem[] }          // 整表快照
'request/header': { header: EpochHeader; reason }
'request/context': RequestContext
'session/end-seed': Record<string, never>    // 种子(继承)边界标记
```
插件可通过 `declare module '@deepseek-ai/dsh-session/types' { interface SessionEventMap { 'your/event': Data } }` 扩展新事件类型(例:`dsh-session-title` 扩了 `session/title`,见 Q7;`dsh-subagent` 扩了 `subagent/descriptor` 见 Q4;`dsh-compaction` 扩了 `compaction/*` 见 Q2)。

**6) 语言级 Message 的全局唯一 id + 字段**(`dsh-llm/lib/types/message.d.ts:119-144`):
```ts
export interface Message {
    readonly id: MessageId;        // 全局唯一,跨表示层稳定(UUID)
    readonly role: 'system'|'user'|'assistant';
    readonly content: ContentBlock[];
    readonly source: MessageSource;   // kind: user | plugin | model | tool
}
// UserMessage / AssistantMessage / ToolResultMessage 都是 Message 的特化
```
`dsh-session/lib/index.js:1455-1458` 实际写入时:`{ seq: this.log.length, time: Date.now(), data: dataSnapshot, ...surfaceMetadata }`。

**7) 分支 / 树概念 —— `SessionStore.fork()`**(`dsh-session/lib/types/index.d.ts:399-417`):
```ts
fork(source: SessionForkSource, boundary?: number, childSessionId?: SessionId): Session;
// SessionForkSource = Session | SessionId; boundary = 源事件包含末端 seq
```
创建子会话时会带上 `parentSession`/`seedLength` 元数据(`CreateSessionOptions.meta`,`types.d.ts:84-100`)。分支错误码: `'SESSION_NOT_FOUND'|'SESSION_NOT_LIVE'|'SESSION_ALREADY_EXISTS'|'INVALID_BOUNDARY'|'OPEN_TURN'`(`index.d.ts:278`)。

**8) 磁盘实证**(本机真实数据):
顶层会话 header:`{"type":"session","version":0,"id":"session-40ebfa38-…","createdAt":1786685396401,"cwd":"F:\\WorkSpace\\dsh-SessionGraph","delegationDepth":0,"agentPreset":"standard"}`
其子 agent 会话 header:`{"type":"session","version":0,"id":"8d798fc0-…","createdAt":1786685630031,"cwd":"F:\\WorkSpace\\dsh-SessionGraph","parentSession":"session-40ebfa38-…","origin":"subagent","delegationDepth":1,"agentPreset":"cordis"}`
存放路径:`C:\Users\Administrator\.dsh\sessions\--F-WorkSpace-dsh-SessionGraph--\<session-id>\session.jsonl.zstd`。

**9) 官方文档确认**(来源:官方文档 —— 随包 `dsh-session/README.zh.md` 与 `dsh-session-persistence-jsonl/README.zh.md`,它们是发布到 deepseek-harness.github.io 的仓库 `docs/subsystems/session.md` / 各子系统文档的本地同步版本):
- 会话模型一句话官方表述(README.zh.md:5):"`Session` 是 agent 全部交互历史的仅追加真源,LLM 消息历史由它*派生*。原始日志之上维护一个 **surface** 层(产生消息事件的有序投影),以便高效派生和压缩。"
- 官方只列了 `create / flush / fork / get / list` 五个公开 API(README.zh.md:15-19),其中 `flush` 即 `session/flush` 事件待等待的持久检查点;`fork` "创建带谱系元数据的实时子会话"。
- 官方 JSONL 磁盘布局(README.zh.md:7-21):
  ```
  <root>/
    --<normalized-cwd>--/          # 可读项目目录(或 _no-cwd/)
      <encoded-id>/                # 会话专属目录
        session.jsonl.zstd         # 默认:带 checksum 的 header frame + 追加 frame
  ```
  第一个逻辑行是不可变 `SessionHeader`:`{ type:'session', version, id, cwd?, createdAt, parentSession?, seedLength?, origin?, delegationDepth, agentPreset? }`;**`delegationDepth` 在磁盘上必需,顶层为 0**;后续每行是一条存储记录,`seq` 连续(`events[i].seq === i`)(README.zh.md:17)。
- 官方配置表(README.zh.md:24-30):`root`(必需,无默认)、`packChunks`(默认 true,压缩 delta 分片为 text/reasoning/tool-call-chunks 行,实测小约 60%)、`compression`(`zstd`|`none`,默认 zstd)、`writeBatchMaxDelayMs`(默认 200ms 合并窗口)。
- 官方"不删除会话文件"(README.zh.md:75):"日志在 root 下累积,直到外部移除(seam 无删除接口)" —— 直接印证 Q2"压缩不删除历史"。

---

## 2. 上下文压缩(Compaction)

### 结论
- **存在**,且是**平台一等公民**:`ctx.compaction`(抽象 `CompactionEngine`),实现归各后端(如 `dsh-compaction-basic`)。
- 触发分**自动**(`compactIfNeeded`:`'pressure' | 'context-overflow'`)与**手动**(`compactNow`,由 `/compact` 命令 —— `dsh-command-compact`)。检查点策略(`dsh-session-checkpoint-policy`)在每个请求/tool/step 边界触发 `session/flush` 以便压缩可见。
- **机制**:在**有序 surface(派生的模型历史)**上把一段节点用 `SurfaceOp={op:'replace',start,end}` 的**单个摘要 `user/message` 节点**替换掉,**shadow(遮蔽)被替换段**。同时会写三个**仅日志事件**(不进 surface)dst: `compaction/start`(事务锁)、`compaction/summary`(摘要+被遮蔽区间/seqs/token 数)、`compaction/end`;另有 `compaction/prune`(免模型的剪枝替价记录)。
- **压缩后原始消息仍在存储里保留** —— 也就是说"从模型历史里被替换/遮蔽的原始事件不做物理删除",它们仍在追加式日志里,可通过查询标为 `surface:'shadowed'` 或 `'log-only'` 读到。删除历史这一行为**不存在**。

### 证据

**1) Service 定义**(`dsh-compaction/lib/types/index.d.ts`):
```ts
// L19-20  触发类型
export type CompactionTrigger = 'pressure' | 'context-overflow';
// L75  抽象压缩引擎
export declare abstract class CompactionEngine extends Service {
    abstract compactIfNeeded(agent, trigger, signal): Promise<CompactionResult | null>;
    abstract compactNow(agent, signal, sourceCommandId?): Promise<CompactionResult | null>;
    abstract compactRegion(start, end, agent, signal?): Promise<CompactionResult>;
}
// L61-65 ctx.compaction 注册
declare module '@deepseek-ai/cordis' { interface Context { compaction: CompactionEngine; } }
```

**2) 压缩写什么事件、如何遮蔽**(`dsh-compaction/lib/types/types.d.ts`):
```ts
// L13-34 (SessionEventMap 扩展)
'compaction/start': { compactionId; sourceCommandId?; turn: number|null };   // 锁
'compaction/summary': { compactionId; sourceCommandId?; summary: ContentBlock[]; shadowedRange:{start,end}; shadowedSeqs:number[]; shadowedTokenCount; provider; model; usage? };
'compaction/end': { compactionId; sourceCommandId?; turn; error? };          // 释放锁
// L87-97 免模型剪枝
'compaction/prune': { shadowedRange; shadowedSeqs; shadowedTokenCount };
```
`dsh-session/lib/types/types.d.ts:388-392`:
```ts
export type SurfaceOp = 'append' | { op: 'replace'; start: number; end: number; };
```
该 `replace` 正是压缩替换段(NOT:原文不删除)。

**3) 触发时机 —— 检查点策略**(`dsh-session-checkpoint-policy/lib/index.js:60-76`):
```js
function apply(ctx) {
  ctx.on("llm/stream", (options, next) => { /*…*/ return afterCheckpoint(ctx, session, next); });
  ctx.on("tools/execute", async (exec, next) => { /*…*/ await ctx.sessions.flush(exec.agent.session); return next(); });
  ctx.on("agent/pre-step", async ({ agent }, next) => { await ctx.sessions.flush(agent.session); return next(); });
}
```

**4) 压缩后原文仍可读的证据 —— surface 三态**(`dsh-session-query/lib/types/types.d.ts:12,48-50`):
```ts
export type SessionEventSurface = 'current' | 'shadowed' | 'log-only';
…
readonly surface: SessionEventSurface;   // 事件在 surface 中的位置
```
被压缩 `replace` 遮蔽的节点标为 `shadowed`,仍在原始日志(追加式,没有删除)。`CompactionResult.shadowedSeqs`/`shadowedRange` 精确列出被遮蔽的 seq(`dsh-compaction/lib/types/types.d.ts:101-130`)。

> 提示:`dsh-web-app/cordis.patch.yml` 里 `compaction-basic` 默认被 `disabled`(该行留在 host plane,Web 侧 preset 决定是否挂)`dsh-web-app/cordis.patch.yml:171-180`:Web surface 下压缩后端由 agent preset 决定是否生效。

**5) 官方文档确认**(来源:官方文档 —— 随包 `dsh-session/README.zh.md` 与 `dsh-compaction-basic/README.zh.md`):
- 官方明确"replace 不删原文"(dsh-session README.zh.md:105):"追加的 surface 条目会在后续步骤中重新发送。`replace` surface 操作会从未来输入中移除被遮蔽条目,**但不删除其原始日志记录**。"(同文:109 "即使底层事件日志保持仅追加,`replace` 操作也会从首条被遮蔽消息起使缓存复用失效。")
- 官方小结"摘要替换即 checkpooint"(dsh-session README.zh.md:93):"`dsh-compaction-basic` 为摘要检查点追加一个替换用 `user/message`"。
- 官方 BasicCompactionEngine 的默认策略(README.zh.md:32-41):压力阈值 `thresholdRatio` 默认 `0.8`(在 `floor(routedContextWindow × ratio)` 处压缩);逐字保留 `retainRatio` 默认 `0.16`;摘要调用 `maxTokens` 默认 `8192`;自动模式 `auto` 默认 `true`(注册步骤边界压力与溢出恢复 listener)。触发时机官方原文:"在 token 压力下自动压缩"、"`dsh-command-compact` 调用 `ctx.compaction.compactNow(…)`"。
- 官方替换消息的标记(README.zh.md:19):"替换 user 消息使用 `<compacted-summary>` 标签标记已建立的检查点上下文;原始摘要保留在 `compaction/summary` 事件上"。
- `compactRegion` 官方限制(README.zh.md:163):"`compactRegion` 要求存在未结束的轮次:在完全关闭的会话上手动调用会抛出异常(no open turn)"。

---

## 3. Host 事件(Cordis Events,Host 侧插件可监听)

### 结论
- Host 侧动态 Cordis 插件用 `ctx.on(event, handler)` 监听事件;事件在 `declare module '@deepseek-ai/cordis' { interface Events {} }` 中声明(各包 merge)。
- **三个与"消息/会话/子 agent"最相关的事件族**:
  1. **会话族**(`dsh-session`):`session/created`、`session/disposed`、`session/event`、`session/flush` —— 均为 `this: Scoped<Session>`。
  2. **agent 族**(`dsh-agent`):`agent/created`、`agent/disposed`、`agent/status`、`agent/inbox/{inserted,claimed,discarded}`、`agent/session-start`、`agent/pre-step`、`agent/request`、`agent/request-error`、`agent/turn-stopping`、`agent/error` —— 均为 `this: Scoped<Agent>`。
  3. **子 agent 族**(`dsh-subagent`):`subagent/provider-added|provider-removed`、`subagent/start|end`。
- **关键:不存在独立的 `user/message` / `assistant/message` / `message` 事件**。所有"消息产生"都是**会话日志里的 `SessionEventMap` 事件**(`user/message`、`assistant/message`、`assistant/chunk`、`tool/call`、`tool/result`……),**统一经 `session/event(session, event)` 这一个事件在每一条 append 后同步推送**,用 `event.type` 判别。这是实时捕获消息增长的唯一订阅口。
- 事件做 **scope 过滤**(`Scoped<Session>/Scoped<Agent>`):Host 根组合注册的监听者收到全部会话/agent;挂到某个 agent scope 则只收该 agent 相关。(`dsh-session/lib/types/index.d.ts:32-76` 注释;`dsh-session/lib/index.js:1691`。)

### 证据

**1) 会话四事件声明**(`dsh-session/lib/types/index.d.ts`):
```ts
// L44  会话创建(同步 throw 可否决,失败回滚)
'session/created'(this: Scoped<Session>, session: Session): void;
// L54  会话离开 store(含发布回滚)
'session/disposed'(this: Scoped<Session>, session: Session): void;
// L66  ⭐ append 后 fire-and-forget 推送 = 消息增长订阅口
'session/event'(this: Scoped<Session>, session: Session, event: SessionEvent): void;
// L75  持久化冲刷点(parallel,await 所有监听者)
'session/flush'(this: Scoped<Session>, session: Session): Promise<void> | void;
```
运行时发射(`dsh-session/lib/index.js`):
```js
// L1464-1472  Session.append() 内,日志 push 后同步发 session/event
const callbackArgs = [this, event];                       // (session, event)
callbacks = collectSessionCallbacks(entry.emitCtx, [entry.carrier, "session/event", ...callbackArgs]);
this.log.push(event);
invokeContainedSessionObservers(entry.emitCtx, "session/event", entry.id, callbackArgs, callbacks);
// L1737-1759  announce → session/created(session)
// L1761-1773  emitDisposed → session/disposed(session)
// L1787-1799  flush → session/flush(session)
```

**2) agent 族事件声明**(`dsh-agent/lib/types/runtime-types.d.ts:134-322`,均 `this: Scoped<Agent>`):
```ts
'agent/created'(payload: { agent: Agent })   // L146-148
'agent/disposed'(payload: { agent: Agent })  // L157-159
'agent/status'(payload: { agent: Agent; status: AgentStatus })   // L169-172  idle⇄running
'agent/inbox/inserted'(payload: { agent; message: UserMessage }) // L180-183 ⭐ 新消息入队
'agent/inbox/claimed'(payload: { agent; message; turn })         // L194-198 ⭐ 消息被认领进步骤
'agent/inbox/discarded'(payload: { agent; message })             // L206-209 ⭐ 消息被丢弃
'agent/session-start'(payload: { agent; source: SessionStartSource }) // L220-223  会话生命周期开始(首次 turn 前)
'agent/pre-step'(payload: { agent; messages: UserMessage[]; turn; step; signal }, next): Promise<PreStepDecision>  // L235-241 waterfall
'agent/request'(payload:{agent;turn;step;signal}, next)          // L254-259
'agent/request-error'(payload:{…}, next)                         // L275-283
'agent/turn-stopping'(payload:{agent;turn;signal})               // L301-305
'agent/error'(payload:{agent;turn;step;error})                   // L316-321
```
> `agent/session-start` 是"会话开始"事件;agent 与其 session **共享同一 id**(见 `ctx.agents.get(session.id)` 用法)。注意"agent 切换"语义在 harness 里是 **scope/子 agent 委派**,没有一个叫 `agent/switch` 的单一事件 —— 切换表现为:`subagent/start`(父→子)、父会话 `tool/call(name='subagent'…)` + 子会话 `session/created` + `agent/inbox/*`。

**3) 子 agent 族事件**(`dsh-subagent/lib/types/index.d.ts:69-95`):
```ts
'subagent/provider-added'    // 子 agent 提供者注册
'subagent/provider-removed'  // 子 agent 提供者注销
'subagent/start'             // 子 agent 运行(以委派父 agent 为 scope carrier)
'subagent/end'               // 子 agent 结束
```

**4) 其余可监听事件**(部分,Host 侧):`agent-loop/config-start-failed`、`agent-preset/selected`、`llm/stream`(waterfall,见 Q2 证据)、`session-telemetry/record`、`slots/changed`(客户端 slots 变更桥,见 Q5)。`dsh-schedule` 的 `schedule/change` 是**注入 `SessionEventMap` 的日志事件**,不是 Cordis 事件 —— 别混。

**5) scope 机制旁证**(`dsh-session/lib/index.js:1691`,`dsh-scope`):事件以 carrier(enter 时捕获的 ctx)过滤,保证"挂某 agent 的插件只收该 agent"。

**6) 官方文档确认**(来源:官方文档 —— `dsh-session/README.zh.md`、`dsh-subagent/README.zh.md`、`dsh-compaction/README`):
- 官方对 `session/event/flush/created/disposed` 四事件的表述(dsh-session README.zh.md:11):"本包有意不实现持久化:插件订阅 `session/event`,在 `session/flush` 时刷新,并可镜像成对的 `session/created`/`session/disposed` 生命周期。"
- 官方对子 agent 生命周期事件(dsh-subagent README.zh.md:91):"服务会为每次一次性运行以及每个已驻留的可继续 Activation 时段发出一对 `subagent/start`/`subagent/end`…这对事件共享由服务生成的 `runId`;`local` 标志…`provider` 字段包含子 agent 初次创建时记录的提供方名称。"(95)"提供方新增和移除还会发出 `subagent/provider-added` 与 `subagent/provider-removed`。"
- **官方明确区分"会话事件"与"Cordis Events"**(dsh-compaction README):`compaction/*` 是会话事件(进日志),不是 Cordis `Events` —— 避免混淆。
- **`SessionEventMap` 可被插件声明合并扩展(做图谱可自记事件)**:官方原文(dsh-session README.zh.md:73)"插件使用声明合并添加自身类型(压缩 seam 的 `compaction/*`、有界恢复的非 surface `llm/retry`、钩子桥接层的 `hook/*`)" —— 即图谱插件也可注入自己的日志事件类型,`Session.append()` 会校验并持久化,经 `session/event` 广播。
- 一条新消息的实时唯一统一入口仍是 `session/event`(每条 append 后同步发射),`event.type` 判 `user/message|assistant/message|assistant/chunk|tool/call|tool/result|turn/*|step/*`;agent 侧可用 `agent/inbox/inserted`/`claimed`/`discarded`、`agent/status`、`agent/session-start` 补看板。
- **会话↔agent 一一对应(做图谱关联关键)**:agent 与它的 session **共用同一 id** —— `dsh-agent/lib/types/index.d.ts:349` `get(id: SessionId): Agent | undefined`,JSDoc 原文"the **shared agent/session id** to look up"。因此树节点可同时是"会话节点"与"agent 节点":`session/created`/`session/event` 的事件都能用 `session.id` 直接 `ctx.agents.get()` 关联到其 agent(`agent/status`/`agent/pre-step` 等 agent 事件同理反向关联)。

---

## 4. 子 agent(subagent)

### 结论
- 子 agent **就是一个普通会话** —— 它的日志与父会话一样用 `session.jsonl[.zstd]` 存;父/子关系由**持久化好的 header 字段**表达:`parentSession`(父会话 id)、`origin:'subagent'`、`delegationDepth = 父深度+1`,以及子会话日志内首轮写入的 `subagent/descriptor` 事件。
- **存在成熟的树枚举 API**,无需自己拼:
  - `ctx.subagents.listChildren(parentSessionId)`:返回直接子代(带 mode: one-shot/continuable + label + 是否还有子代)。
  - `ctx.subagents.listDescendants(rootSessionId)`:返回整棵现存子 agent 树(pre-order 扁平数组,每条含 `parentId` + `depth`)。
  - `ctx.sessionQuery.traceSession(id)`:返回 **递归树** `SessionLineageTrace { ancestors: SessionRecord[]; descendants: SessionLineageNode[] }`,`SessionLineageNode{ session; descendants[] }`。
- **有 API 列出某会话的子 agent / 整棵会话树**:`listChildren` / `listDescendants`(子 agent 视角)与 `traceSession`(广义层系树,含任意父子跳转)。这些是**数据层**能力;UI 层另有子 agent 目录/面包屑(见 Q6)。

### 证据

**1) 子 agent 以独立 Session 持久化 + 父/子 header 字段**:见 Q1 的证据(header 的 `parentSession/origin/delegationDepth`),以及磁盘实证的两个 header(父 `delegationDepth:0`、子 `delegationDepth:1` + `parentSession` + `origin:"subagent"`)。

**2) `subagent/descriptor` 事件(杜撰身份/可续性)**(`dsh-subagent/lib/types/descriptor.d.ts`):
```ts
// L43  SUBAGENT_DESCRIPTOR_VERSION = 2
// L45-76 payload
interface SubagentDescriptorBase { version: number; mode: 'one-shot'|'continuable'; provider: string; }
OneShotSubagentDescriptorData     { mode:'one-shot'; label?: string }
ContinuableSubagentDescriptorData {
    mode:'continuable'; label: string;
    agentProvider?; agentModel?; persona?; toolFilter?: ToolRestriction;
}
```
在子会话首个 turn 内 append(`log-only,不进表面,压缩也不删`)。

**3) 树枚举 API**(`dsh-subagent/lib/types/list-children.d.ts` 与 `index.d.ts`):
```ts
// list-children.d.ts:30-42  子代条目
export type SubagentListEntry = {
  kind: 'child';
  id: SessionId;
  activity: 'running'|'inactive';   // 活着 或 仅存于持久化
  hasChildren: boolean;
} & ({ mode:'one-shot'; label?:string } | { mode:'continuable'; label: string })
  | { kind:'diagnostic'; id; reason:'corrupt'|'unsupported'|'unavailable' };
// L74-79  后代条目(树位置)
export type SubagentDescendantListEntry = SubagentListEntry & {
  parentId: SessionId;   // 持久化的直接父
  depth: number;         // 距根边数(直子=1)
};
// L97
listChildren(ctx, parentSessionId, signal?): Promise<SubagentListEntry[]>;
// L111
listDescendants(ctx, rootSessionId, signal?): Promise<SubagentDescendantListEntry[]>;
```

**4) 广义层系树查询**(`dsh-session-query/lib/types/index.d.ts:123` + `types.d.ts:52-76`):
```ts
// index.d.ts:123
traceSession(sessionId, signal?): Promise<SessionLineageTrace>;
// types.d.ts:52-65  本身已是递归树
export interface SessionLineageNode { session: SessionRecord; descendants: SessionLineageNode[]; }
export type SessionLineageTrace = {
  target: SessionRecord;
  ancestors: SessionRecord[];        // 自直接父向外
  descendants: SessionLineageNode[]; // 自直接子为根的树
} & ({ complete:true; root: SessionRecord } | { complete:false; unresolvedParentId: SessionId });
```

**5) 会话过滤支持按 parent** —— 直接列出某父的所有子(`types.d.ts:173-175`):
```ts
{ kind: 'parent'; values: readonly (SessionId|null)[] }
```

> 反查历史的完整 CQRS 面 `ctx.sessionQuery`: `listSessions` / `readSession`(完整日志) / `readTitle[s]` / `listEvents` / `filterEvents` / `readSurface` / `filterSessions` / `traceSession` / `traceEvent` / `readEvent` / `searchSessions` / `searchEvents`(index.d.ts:42-138)。实时活会话用 `ctx.sessions.get/list`(仅内存);持久化用 `ctx.sessionPersistence`(prepare/load/readFrom/append)。
> **`traceSession` 失败语义(做图谱要处理的坏边)**:官方 README(`dsh-session-query/README.zh.md:17`)指明 `complete:false` 标识"第一个缺失的父级"(即父链走出已知语料),与目标相连的**环会抛 `SESSION_QUERY_INVALID_LINEAGE`**(`lib/types/config.d.ts:15`、`lib/index.js:655` 的 `ancestrySeen.has(parentId)` 环检测)。图谱遇到"断链/环"应据此降级而非崩溃。

**6) 官方文档确认**(来源:官方文档 —— `dsh-subagent/README.zh.md`、`dsh-client-runtime/README.zh.md`):
- 官方"父/子关系怎么记"(README.zh.md:69):一次性启动"把 `request.parent.session.id` 记录到子 agent 的 `parentSession` header,并在其初始轮次内追加已解析的描述符"。
- 官方"子 agent 会话是独立持久化 Session"(README.zh.md:73):"每个可继续子 agent 都有一个持久化 Session"。
- 官方树遍历 API(README.zh.md:25-26):`listChildren` "列出由会话支撑的直接 subagent…hasChildren 提示…不加载或恢复它们";`listDescendants` "从同一份在线优先语料按稳定 pre-order 展平根的完整会话树,并为每个 subagent 条目附加持久 `parentId` 与相对根的 `depth`。普通会话与一次性 child 仍作为遍历节点"。
- 官方也认可 `traceSession`(dsh-session-query README):返回"从直接父级向外的祖先,以及确定性的递归后代树"。
- Client 侧建树地图(dsh-client-runtime README.zh.md:29):`indexSubagentDescendants()` "从保留的列表镜像中派生每个 parent 的后代总数与运行中后代数,只沿不间断的 `origin:'subagent'` 祖先链追踪,因此普通 fork 会开启独立的归属子树"。
- 委派深度权威性(README.zh.md:55):"持久化的 `SessionHeader.delegationDepth` 具有权威性且单调…恢复后的子 agent 不会被重新计为顶层"。

---

## 5. Client UI Slots(可放自定义 UI 的口子)

### 结论
- Client 侧 Slot 系统**存在且完善**:纯核心 `SlotCore`(`dsh-client-ui-slots`)+ Cordis Service `SlotRegistry`(服务名 **`ctx.slots`**)。**不存在** `ctx.ui.mount` / `ctx.ui` 之类 API —— 注册统一走 **`ctx.slots.register({ name, children?, store?, inject? }, component)`**,经 `ctx.effect` 归入调用者 fiber(卸载自动清理)。
- Slot 有 `kind`(`single|list|keyed|chain`)与 **`scope`**(`root|session-maybe|session`)两轴;`session` scope 的槽组件自动收到 `sessionId` + `useSession` 等 kit。
- **适合放"全局/会话级面板"的槽**(按推荐度):
  1. **`conversation.view`**(list,scope:`session`)—— 会话内的"视图 tab 环",**加一个 Graph Tab 的最佳位置**;官方 `ui-trajectory`(waterfall)就是这么注册的。
  2. **`shell.overlay`**(list,scope:`root`)—— 帧级浮动层,**官方原话就是"additive seat for a frame-wide surface of your own"**,适合悬停面板。
  3. **`details`**(single,scope:`session`)—— 右详情列(空则空白),可占用作专用右侧面板;开合走 `ctx.layout`。
  4. **`sidebar.footer.action`**(list,scope:`root`)—— 左下角/侧边栏内层子槽,叠加不替换;owner 仅 `{wide:boolean}`。
  5. **`sidebar`(整根)/`root`(整树)** —— **不要**占用;`single/替换`语义,动态低优先级会直接遮挡 shipped 框架(`root` 的占用者是 ui-layout 的 AppFrame)。
- **实时数据通道**(Host 推给 Client):Host 用 `sessionProjections` 服务注册投影键,变更时通过 `session/projection` 帧广播;Client 用 `useProjection(key, selector)` / `ProjectionValueStore` 读。适合做"实时会话图谱数据"。静态/配置型数据走 `inject` 工厂或 `sessions.provide`。

### 证据(关键桩)

**1) SlotCore 与 `ctx.slots`**(`dsh-client-ui-slots/lib/index.js:55-63` + `dsh-client-runtime/lib/client.js`):
```js
// dsh-client-ui-slots/lib/index.js L55-63 构造时种根槽
constructor() { const root = this.record("root"); root.spec = { kind: "single", scope: "root" }; … }
// dsh-client-runtime/lib/client.js L24,35,331-334 SlotRegistry 服务名 "slots"；register 走 ctx.effect
var SlotRegistry = class extends Service { constructor(ctx){ super(ctx, "slots"); … } };
SlotRegistry.prototype.register = function register(rawOptions, component){ return this.ctx.effect(()=>this["_register"](options, component), "slots.register()"); };
```
Slot 定义(`dsh-client-ui-slots/lib/types/index.d.ts`):
```ts
// L72  export type SlotKind = 'single' | 'list' | 'keyed' | 'chain';
// L74  export type SlotScope = 'root' | 'session-maybe' | 'session';
// L358 ComposedProps = PropsRuntime & PropsRenderSlots & PropsStore & InjectFace & MatchedShare & PropsLocale;
```

**2) 帧/列布局层槽**(`dsh-client-ui-layout/lib/types/client/index.d.ts`):
```ts
// L31-35  'sidebar'   whole left column (single/root) —— 占用即替换
// L48-52  'conversation' whole center column (single/session-maybe)
// L62-66  'details'   right details column (single/session)
// L77-80  ⭐ 'shell.overlay' (list/root)：“additive seat for a frame-wide surface of your own: a fresh id is added beside the shipped entries instead of replacing them.”
```
`root` 槽文档(`dsh-client-runtime/lib/types/client/slots.d.ts:24-31`)明确:**DO NOT register here**,要浮层走 `shell.overlay`。

**3) 会话内视图 tab —— `conversation.view`**(`dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts:78-82`):
```ts
'conversation.view': { kind: 'list'; scope: 'session'; owner: ConvViewOwnerProps; };
// ConvViewOwnerProps = { inspect?: {callId?}|null; onInspectDone? } (L336-343)
// 组件自动获得框架 kit: sessionId + useSession(ConversationSnapshot)
```
官方 trajectory 就是这么注册"会话 Tab"的(`dsh-client-ui-trajectory/lib/client.js:7340-7361`):
```js
ctx.slots.inject("conversation.view", () => ctx.slots.register({
  name: "conversation.view", id: "trajectory", order: 10, locale: NS,
  label: () => t("view.trajectory"),
  inject: (sessionId) => { … return { hooks:{ duration }, loadOlder…, setActualDuration… }; }
}, TrajectoryView));
```
`ctx.slots.inject(key, cb)` 用于"等槽声明后再注册"(解决插件加载顺序)(`dsh-client-runtime/lib/client.js:55-114`)。

**4) conversation 内部其余 session 槽**(同上 slots.d.ts):`conversation.session`(L32)、`conversation.session.header`(L43)、`conversation.session.header.actions`(L57,list)、`conversation.session.header.utilities`(L66,list)、`conversation.chat.node`(L84,keyed)、`conversation.chat.turnTail`(L115,chain)、`conversation.chat.assistant-actions`(L127,list)、`conversation.composer`(L154,chain)、`conversation.input.dock/composer.dock/input.left/input.right`(L190/203/216/228,list)、`conversation.input.plan/model`(L260/274,single)、`conversation.composer.bar`(L246,single/session-maybe)。
侧边栏内层:`sidebar.workspaces`、`sidebar.settings`、`sidebar.footer.action`(`dsh-client-ui-sidebar/lib/types/client/contract/slots.d.ts:20-43`)。设置:`settings.section`(list,每设置页)、`settings.plugins.tab`、`settings.general.item`(`dsh-client-ui-settings/…/slots.d.ts:67/80/114`)。

**5) Host→Client 实时数据通道**(`dsh-host-apiproxy/lib/index.js:1842-1851`, `dsh-client-web-react/lib/index.js:94-104`):
```js
projectionCtx.sessionProjections.onChanged((session, key, value, seq) => {
  broadcast({ type: "session/projection", sessionId: session.id, key, value, seq });
});
```
Client 组件用 `useProjection(key, selector)` 读(Boolean:更高的 seq 胜出);`sessions.provide({ hooks?, props?, resolve })` 可向所有 session 槽贡献标准 props/hooks(`dsh-client-runtime/lib/types/client/sessions/service.d.ts:139-146`)。

**6) 官方文档确认**(来源:官方文档 —— `dsh-client-runtime/README.zh.md`、`dsh-client-ui-slots/README.zh.md`、`dsh-tool-cordis/README`):
- 官方 slot 注册/注入语(dsh-client-runtime README.zh.md:11-13):"`ctx.slots.inject(name, callback)` 将完整的 `SlotMap` key 作为贡献项的依赖…声明存在时它会同步运行 `callback`,否则等待;声明折叠会 dispose 回调 effect,重新声明则会再次运行回调…直接调用 `slots.register()` 向未声明 slot 注册仍会抛出异常。"
- 官方实时数据读法(README.zh.md:5):"每个 `Session` 持有一个通用的 `ProjectionValueStore`,由历史记录尾部的 `projections` 块播种,并经 `session/projection` 帧按 seq 高者胜更新;领域键(含 `todos`)经 `projections.faceOf`/`useProjection` 读取,不经 `ConversationSnapshot`。" —— 图谱用 `useProjection` 而非直接读 snapshot。
- 官方"会话 Tab 由 Definition 组装"(README.zh.md:49-51):"`ui-conversation` 注册内建 Chat Definition…`ui-trajectory` 在同一个 Session 窗口上注册独立 Definition 与 target builder" —— 加一个"Graph"视图 = 注册一个 `conversation.view` 条目 + 自己的 Node Definition。
- 官方对 SlotCore 的定位(dsh-client-ui-slots README):"SlotMap 声明合并、`SlotCore` 上唯一的 `register` 组合 API、四 share 组件 props 类型家族";加载时强制验证("未声明 slot/重复子项等注册即抛错")。
- 官方"动态插件即 Cordis 插件"(dsh-tool-cordis README):`cordis_inspect/define/run/stop/undefine` 5 个动态工具是平台对"运行时定义/升级/回滚插件"的官方能力;`cordis_inspect what:'client'` 会报告每个 slot 座位的"基数、作用域、摘要"(可用来调试自己挂的槽)。

---

## 6. 现有插件:session 树 / 图谱 / 时间线

### 结论
- **不存在**任何专门的 `session-tree` / `session-graph` / `graph` / `timeline` / `relationship` 插件包(包名里搜不到)。
- **数据层**的树/层系遍历能力**已存在且成熟**(listChildren / listDescendants / traceSession,见 Q4),可直接复用。
- **Client UI 已有"最接近图"的组件**,但都**不是会话关系图**:
  - `dsh-client-ui-subagent`:`SubagentCatalogAction` —— 真正递归渲染的**子代理树**(`role="tree"`),挂在会话头部。
  - `dsh-client-ui-conversation`:`deriveAncestry` / `session.hierarchy` 面包屑 —— 祖先链。
  - `dsh-client-ui-trajectory`:`TrajectoryTimeline` —— 单会话的耗时/序列时间线。
  - `dsh-client-ui-workspace`:`SessionTree` —— 只是侧边栏扁平列表的命名,非层级。
- **Client 运行时已提供会话→后代索引**(建树地图的基石):`dsh-client-runtime/lib/types/client/sessions/subagent-lineage.d.ts:10-23` 的 `indexSubagentDescendants(summaries): ReadonlyMap<SessionId, SubagentDescendantSummary>`(每会话→其后代数/运行数),`ui-subagent` 就是用它建子代理树。
- **官方文档确认**(来源:官方文档 —— `dsh-session/README.zh.md:141`):官方明确会话"分支/树结构"暂缓——"**会话分支/树结构**(pi 风格条目树):除非需要超越基于边界的 `fork()` 能力,否则暂缓。" 换句话说:平台当前没有现成的"多分支会话树 UI",只有基于 `fork()` 的线性续接 + subagent 父子树;任何更复杂的树/图谱可视化都需插件自建(数据层能力齐全,见 Q4/Q6)。
- **全树不存在任何图可视化库依赖**:grep `dagre|cytoscape|@xyflow|reactflow|vis-network|graphviz|d3-force|d3-hierarch` = **0 匹配**。即:作图谱渲染,布局与绘图库需从零引入(可用纯 SVG/DOM + `dsh-client-ui-primitives`)。

### 证据
- 包目录无 `dsh-session-tree`/`dsh-session-graph`/`dsh-graph`/`dsh-timeline`(`<root>` 下 `Get-ChildItem` 确认)。
- `dsh-client-ui-subagent`:`lib/client.js:170-341`(`CatalogRows` 递归)、`:500`(`role="tree"`)、`:314-336`(子层递归);挂在会话头部 header actions slot。
- `dsh-client-ui-conversation`:`lib/client.js:6920-7009`(`ConversationSessionHeader`/`deriveAncestry`,`aria-label="session.hierarchy"`)。
- `dsh-client-ui-trajectory`:`types/client/timeline.d.ts:5`(`mode='sequence|duration|time|actual'`)、`lib/client.js:5551-5800`(三泳道条)。
- 图库依赖 grep 0 匹配(`<root>` 全树)。

---

## 7. 会话元数据(id / title / 时间戳)

### 结论
- **id**:会话 id 存在 **header(`SessionHeader.id`,顶层会话形如 `session-<n>`/短名,子 agent 是 UUID**);`seq` 是会话内单调自增。磁盘以 id 编码成单个安全路径段(见 Q1)。
- **createdAt/时间戳**:header 有 `createdAt`(epoch ms);每条事件自带 `time`(epoch ms);每轮有 `turn/start`/`turn/end`(end 带原因)。
- **title**:由 `dsh-session-title` Service 负责,持久化为**会话日志事件 `session/title`**(log-only,last-wins),字段 `title` + `messageSeqs` + `source`(fallback/provider/user)。标题不在 header,而在事件流里。
- 常用读取接口:`ctx.sessionTitle.get(session)` 返回 `SessionTitleSnapshot`;`ctx.sessionQuery.readTitle(sessionId)` / `readTitleSnapshots`。

### 证据

**1) header 的 id / createdAt / 层系字段**:见 Q1 证据(`SessionHeader` types.d.ts:40-78;HeaderLine format.d.ts:24-35)。

**2) `session/title` 事件与 Service**(`dsh-session-title/lib/types/index.d.ts`):
```ts
// L37-45  事件 payload
export interface SessionTitleEventData {
  title: string;
  messageSeqs: number[];              // 用来推导标题的 user/message seq
  source: SessionTitleSource;          // kind: fallback | provider | user
}
// L67-74  并入 SessionEventMap
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap { 'session/title': SessionTitleEventData; }
}
// L141-183  Service 方法
get(session): SessionTitleSnapshot | undefined;
rename(session, title): SessionTitleSnapshot;      // 用户显式改名(固定标题)
refresh(session, signal?): Promise<SessionTitleSnapshot | undefined>;
register(provider): () => Promise<void>;
```
`SessionTitleSnapshot` 额外带 `eventSeq` + `updatedAt`(`index.d.ts:47-52`)。
写事件实现:`dsh-session-title/lib/index.js:238` `session.append("session/title", {…})`;读取用 `foldSessionTitle(events)`(findLast `session/title`,index.js:112-123)。

**3) `turn/end` 的完成原因**(`dsh-session/lib/types/types.d.ts:135-169`):`completed | aborted | blocked | error | max-tokens | interrupted`,错误带结构化 `LlmFailure`。

**4) 磁盘实证**:顶层会话 header `createdAt:1786685396401`,`id:"session-40ebfa38-…"`;子会话 `id:"8d798fc0-…"(UUID)`,`createdAt:1786685630031`;两者日志里均有 `session/title` 事件(见 Q1 证据)。

**5) 官方文档确认**(来源:官方文档 —— `dsh-session/README.zh.md`、`dsh-client-runtime/README.zh.md`):
- 官方 header 字段(dsh-session README.zh.md:87):"`SessionHeader`:会话元数据…`{ version, id, createdAt, cwd?, parentSession?, seedLength?, delegationDepth? }`,与 `SessionId` 一同归此包所有"。顶层无 `createdAt` 时由 store 用当前时间补齐(15)。
- 官方标题读取/回退(README.zh.md 及 client-runtime README.zh.md:65):`SessionSummary.title` 只包含实际持久化标题;`displayTitle` 始终存在,依次回退 cwd basename → Session id。Client 端 `useProjection('title')` 与该规则一致(seq 高者胜)。
- 官方 `turn/end` 原因(dsh-session README.zh.md:77):被中断实时轮次以 `{kind:'aborted', reason: AgentCancelCause}` 结束;"轮次失败携带 `{ kind: 'error', error }`;只有崩溃恢复会合成 `{ kind: 'interrupted' }`"。
- 旧数据 id 迁移(dsh-session-persistence README):"消息标识引入前的消息获得确定性 id `legacy-message:<session-id>:<event-seq>`" —— 因此即便是历史消息也总有可推导的唯一 id。

---

## 对插件开发者的关键结论(≤5 条)

1. **订阅现成**:实时监听一条新消息/新会话零成本 —— 在 Host 插件 `apply(ctx)` 里 `ctx.on('session/event',(s,e)=>…)`(每条 append 后同步触发,`e.type` 判 `user/message|assistant/message|tool/result|assistant/chunk…`),并用 `session/created`/`session/disposed`/`agent/inbox/*` 补生命周期;会话数据已在 `~/.dsh/sessions/<proj>/<id>/session.jsonl[.zstd]` 上落地(zstd 每 frame 独立可解,可直接文件级解析)。
2. **树/层系不要自己拼**:父/子关系已在 header(`parentSession/origin/delegationDepth`)持久化,直接用 `ctx.sessionQuery.traceSession()`(返回祖先+后代**递归树**)或 `ctx.subagents.listChildren/listDescendants`(带 `parentId`+`depth` 的扁平数组)即可拿整棵会话树;`SessionStore.fork()` 已支持创建分支子会话。官方文档已确认这些是平台一等能力(见各章"官方文档确认")。
3. **Client 面板挂/传数据都有现成口**:注册用 `ctx.slots.register({ name:'conversation.view', id, order, label, inject }, Component)` 加一个"会话 Graph Tab"(list/session 槽),或 `shell.overlay`(帧级浮层);实时数据走 Host `sessionProjections.onChanged` → `session/projection` 帧 → Client `useProjection(key, selector)`,不需要自建通道。
4. **压缩不删历史**:compaction 只是用 `SurfaceOp` 把表面节点遮蔽成摘要(原事件仍在追加日志,标为 `shadowed`/`log-only` 可读),因此图谱永远不会因压缩丢节点;需要用 `session-query` 的 `surface` 三态区分当前/被遮蔽即可。
5. **要自造的只有"图本身"**:全 DSH 树无任何图布局/绘图库(dagre/cytoscape/reactflow/d3 全部 0 匹配)—— 数据源、父子关系、事件订阅、Client 挂载点全是现成的,插件只需从零写"图布局 + 渲染"(建议纯 SVG/DOM,并复用 `dsh-client-ui-primitives` 组件栈与 slot 的标准 kit `useProjection`/`useSession`)。

---

## 附:关键文件速查

| 主题 | 文件(相对 `<root>`) |
|---|---|
| Session 模型/事件 | `dsh-session/lib/types/types.d.ts`、`dsh-session/lib/types/index.d.ts`、`dsh-session/lib/index.js` |
| JSONL 持久化 | `dsh-session-persistence-jsonl/lib/index.js`、`lib/types/format.d.ts` |
| 持久化协调/write-behind | `dsh-session-persistence/lib/types/coordinator.d.ts` |
| 压缩 | `dsh-compaction/lib/types/index.d.ts`、`dsh-compaction/lib/types/types.d.ts` |
| 检查点/触发 | `dsh-session-checkpoint-policy/lib/index.js` |
| Agent 事件 | `dsh-agent/lib/types/runtime-types.d.ts` |
| 子 agent | `dsh-subagent/lib/types/list-children.d.ts`、`descriptor.d.ts`、`index.d.ts` |
| 查询/层系 | `dsh-session-query/lib/types/index.d.ts`、`types.d.ts` |
| 标题 | `dsh-session-title/lib/types/index.d.ts` |
| Client Slot 核心 | `dsh-client-ui-slots/lib/index.js` + `lib/types/index.d.ts` |
| Client Slot Service | `dsh-client-runtime/lib/types/client/slots.d.ts`、`dsh-client-runtime/lib/client.js` |
| 布局槽 | `dsh-client-ui-layout/lib/types/client/index.d.ts` |
| 会话槽(conversation.view 等) | `dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts` |
| 侧边栏内层槽 | `dsh-client-ui-sidebar/lib/types/client/contract/slots.d.ts` |
| Web 组合(host/client row) | `dsh-web-app/cordis.patch.yml`、`dsh-base/cordis.patch.yml` |
| 现有树/时间线 UI | `dsh-client-ui-subagent`、`dsh-client-ui-conversation`、`dsh-client-ui-trajectory` |

## 官方文档来源(标注为"官方文档")

> **诚实声明(抓取范围)**:本报告的"官方文档确认"内容均来自**满足"官方文档"标准的本地等价来源**——随 npm 分发的每包 `README.md`/`README.zh.md`(与发布站 `deepseek-harness.github.io` 同源,同出仓库 `deepseek-ai/deepseek-harness` 的 `docs/`),以及 DSH 平台自带的 `cordis-plugin-development` skill(平台文档)。本会话命令沙箱**没有可用出站网络**(`curl`/`node` 被拒、`Invoke-WebRequest` TLS 失败),`web_search` 只返回 source URL 不返回正文,因此用户给出的两个页面(`guide/quickstart`、`develop/basic`)的**逐字渲染正文本报告未能直接抓取**,也不臆造其命令/端口/目录;其内容与下方官方本地来源同源一致。若需这两个页面的逐字正文,请在可联网环境直接抓取下面两页。

- **官方文档站**(用户提供的两个页面,由仓库 `docs/` 渲染;正文本轮未逐字抓取,仅确认存在):
  - https://deepseek-harness.github.io/deepseek-harness/guide/quickstart → 仓库 `docs/user/guide/`(quickstart/index)
  - https://deepseek-harness.github.io/deepseek-harness/develop/basic/ → 仓库 `docs/user/develop/basic/index.md`(插件开发基础)
- **官方文档等价本地来源**(与上站同源,下文各章"**官方文档确认**"小节所引代码/句均出自此处;均为逐字核实的官方文档):
  - `dsh-session/README.zh.md`(会话模型/事件/header/fork)
  - `dsh-session-persistence-jsonl/README.zh.md`(JSONL 布局/配置/物理编码/不删除)
  - `dsh-session-persistence/README.zh.md`(旧数据 id 迁移)
  - `dsh-compaction/README.zh.md`(compaction seam)与 `dsh-compaction-basic/README.zh.md`(压缩触发/机制/默认策略)
  - `dsh-session-query/README.zh.md`(traceSession)
  - `dsh-subagent/README.zh.md`(父/子关系/树遍历/生命周期事件)
  - `dsh-client-runtime/README.zh.md` 与 `dsh-client-ui-slots/README.zh.md`(slots.inject/ProjectionValueStore/useProjection/conversation.view Definitions)
  - `dsh-tool-cordis/README`(动态插件工具 cordis_inspect/define/run/stop/undefine、slot 目录)
- 按用户两个 URL 的**主题面**在本报告的落点:快速入门(启动/会话存放)→ 第 1 节"官方文档确认"与"源码与产物位置";插件开发(动态插件 Host/Client、事件、Slot、写 plugin)→ 第 3、5 节"官方文档确认"。

---

## 官方文档补充(收尾汇总:官方文档对做实时会话图谱的确认 + 增量结论)

> 本节把官方文档(随包 README 等价来源)对七问的**确认**与**增量**结论集中列出,供直接决策。逐字证据见上方各章"官方文档确认"小节。

### 已由官方文档确认(与源码结论相互印证)
1. **会话是事件溯源的仅追加 JSONL 日志**,`~/.dsh/sessions/<proj>/<id>/session.jsonl[.zstd]`;首行 `SessionHeader{type:'session',version,id,cwd?,createdAt,parentSession?,seedLength?,origin?,delegationDepth,agentPreset?}` —— `dsh-session/README.zh.md:5,17`。
2. **存储层不删文件**:官方明文"日志在 root 下累积,直到外部移除(seam 无删除接口)" —— `dsh-session-persistence-jsonl/README.zh.md:75`。
3. **compaction 是"表层替换 + 原文保留"**:官方明文"`replace`…不删除其原始日志记录" —— `dsh-session/README.zh.md:105`;替换 user 消息用 `<compacted-summary>` 标签,摘要留在 `compaction/summary` 事件 —— `dsh-compaction-basic/README.zh.md:19`。=> **压缩永远不会丢图谱节点**。
4. **消息增长唯一入口 = `session/event(session,event)`**,`event.type` 判 `user/message|assistant/message|assistant/chunk|tool/call|tool/result|turn/*|step/*`;官方无独立 `message` Cordis 事件 —— `dsh-session/README.zh.md:11`。
5. **父子会话树有官方 API**:`parentSession` header + `subagent/descriptor` + `delegationDepth`,遍历用 `listChildren`/`listDescendants`(带 parentId+depth)/`traceSession`(递归树)/Client `indexSubagentDescendants` —— `dsh-subagent/README.zh.md:25-26,55,69`。
6. **会话↔agent 共用同一 id**:`dsh-agent/lib/types/index.d.ts:349`("the shared agent/session id"),树节点可同时作会话节点与 agent 节点。

### 官方文档对写实时图谱的**增量**提示
- **实时看板分层订阅**:顶点= `session/created`/`disposed`;边= `subagent/start|end`(每对共享 `runId`,scope 以委派父为 carrier);回合粒度= `turn/start`/`turn/end`(end 带原因);消息粒度= `session/event` 判 `event.type`。
- **反查历史用 CQRS**:`sessionQuery.listSessions`/`readSession`(完整日志)/`traceSession`(祖先+后代树);实时自维护投影用 `sessionProjections.onChanged` → Client `useProjection`;增量 log 用 `sessionPersistence.readFrom(fromSeq)`。
- **Client 挂点**:会话内"Graph Tab"坐 `conversation.view`(list/session),注册 `ctx.slots.register({name:'conversation.view',id,order,label,inject},Comp)`;帧级浮层 `shell.overlay`;数据走 `useProjection` 而非直接读 ConversationSnapshot。
- **分支/多叉树仍属自建**:官方 `dsh-session/README.zh.md:141` 明确"会话分支/树结构暂缓,除非需要超越基于边界的 fork()"。数据(父/子、深度)与遍历 API 全现成;缺的是**把"会话/消息图"画出来**的那一层(布局+渲染),全树无图库依赖。

> 收尾说明:用户指定的 `guide/quickstart` 与 `develop/basic` 两个页面在本任务沙箱内无法逐字抓取(无出站网络),已按收尾指令跳过、不重试;其内容与上述随包官方文档同源等价,以上增量结论均基于已逐字核实的官方 README。详细事件证据另见 `docs/dsh-host-event-system-research.md`。
