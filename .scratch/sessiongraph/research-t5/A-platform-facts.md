# T5: 平台事实调研——同会话跳转 + B1 上下文隔离所需全部平台能力

> 研究目标:查清实现「同会话跳转 + B1 上下文隔离(compaction 式遮蔽)」所需的全部平台事实。
> 研究方式:直接读取 DSH 编译产物源码(`node_modules/@deepseek-ai/` 下各包的 `lib/*.js` + `lib/types/*.d.ts`)。
> **禁止猜测,一切结论以部署源码为准**。根目录:`C:\Users\Administrator\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\`

---

## 1. 会话"当前点"(active)的表示与切换

### 1.1 结论

**平台不存在 `activeCursor` 字段。** Session 是纯线性追加日志,没有"当前游标"概念。"活动点"由以下机制隐式确定:

| 层 | "当前点"表示 | 位置 |
|---|---|---|
| **持久层(磁盘)** | 日志末尾 = 最新事件 | `session.jsonl` 最后一行 |
| **内存 Session** | `session.seq` = `session.log.length` = 下一个 seq | `dsh-session/lib/types/index.d.ts:175-176` |
| **Agent Loop** | `phase.turn` + `phase.step` = 当前正在执行的轮次/步骤 | `dsh-agent-loop/lib/index.js:521-527` |
| **Client UI** | `SessionManager.selected` = 当前选中的会话 id(纯 UI 概念) | `dsh-client-runtime/lib/client.js:7868-7873` |

**关键发现:平台的"跳转"只能是 Client UI 层面的会话选择切换,不能在 Host 端修改 Session 的内部状态来实现"游标回退"。**

### 1.2 会话对象上的 turn 追踪

Agent Loop 的 `phase` 对象跟踪当前 turn:

```js
// dsh-agent-loop/lib/index.js:516-527
async turn() {
    const phase = this.phase;
    const turn = phase.turn + 1;
    this.session.append("turn/start", { turn });
    phase.turn = turn;
    // ...
}
```

`phase` 的完整结构:
- `kind: "idle" | "running" | "maintenance"`
- `turn: number` (当前 turn 编号,running 时递增)
- `step: number` (当前 step 编号)
- `lastTurn: number` (idle 时记录最后完成的 turn)
- `abort: AbortController` (取消信号)

**Agent 对象本身没有 turn 字段**(`dsh-agent/lib/types/runtime-types.d.ts:60-133`),turn 追踪完全在 AgentLoop 内部。

### 1.3 切换 active 的公开 API

**不存在 Host 端的"切换 active"API。** 相关能力:

| 能力 | API | 语义 |
|---|---|---|
| Client 选择会话 | `SessionManager.select(sessionId)` | 纯 UI 切换,不影响 Host 状态 |
| Agent 创建 | `ctx.agents.create(options)` | 创建新 agent+session |
| Agent 恢复 | `ctx.agents.resume(options)` | 从持久化恢复 agent |
| Session fork | `ctx.sessions.fork(source, boundary)` | 从活会话创建子会话(线性续接,非分支) |
| Agent 发消息 | `agent.send(message, target, wakeup)` | 向 agent inbox 投递消息 |
| Agent 跟进 | `agent.followup(message)` | 队列跟进 turn |

### 1.4 新的事件流从哪里继续

Agent Loop 的 `kick()` 方法循环调用 `turn()`,每次 `turn()` 递增 `phase.turn` 并 append `turn/start`:

```js
// dsh-agent-loop/lib/index.js:516-527
async turn() {
    const turn = phase.turn + 1;
    this.session.append("turn/start", { turn });
    phase.turn = turn;
    // ...
}
```

新消息通过 `agent.send()` 或 `agent.followup()` 投递到 inbox,wakeDriver() 启动新的 turn 循环。**事件流永远从日志末尾继续追加,没有"回退"机制。**

### 1.5 turn 编号与 active 的关系

- turn 编号是**会话内单调递增**的,由 AgentLoop 在每次 `turn()` 开始时分配
- `turn/start` 和 `turn/end` 事件标记每个 turn 的边界
- **没有"当前 turn"的全局概念**——每个 AgentLoop 独立追踪自己的 `phase.turn`
- Session 对象不存储 turn 状态,只存储事件日志

---

## 2. compaction replace 遮蔽机制

### 2.1 SurfaceOp 的构造与调用入口

**类型定义**(`dsh-session/lib/types/types.d.ts:388-392`):
```ts
export type SurfaceOp = 'append' | {
    op: 'replace';
    start: number;  // inclusive surface position
    end: number;    // inclusive surface position
};
```

**SurfaceIntent 接口**(`dsh-session/lib/types/types.d.ts:397-406`):
```ts
export interface SurfaceIntent {
    surfaceOp: SurfaceOp;
    sourceEventSeqs?: number[];  // 必须包含所有被遮蔽的 surface node seq
}
```

**Session.append 签名**(`dsh-session/lib/types/index.d.ts:212`):
```ts
append<T extends SessionEventType>(
    type: T,
    data: SessionEventMap[T],
    ...opts: T extends SurfaceEventType ? [opts: SurfaceIntent] : []
): SessionEvent<T>;
```

**实际调用(compaction-basic)**(`dsh-compaction-basic/lib/index.js:605-616`):
```js
session.append("user/message", checkpointMessage, {
    surfaceOp: {
        op: "replace",
        start,   // inclusive first surface-node seq
        end      // inclusive last surface-node seq
    },
    sourceEventSeqs: [
        startEvent.seq,      // compaction/start 事件
        summaryEvent.seq,    // compaction/summary 事件
        ...shadowedSeqs      // 所有被遮蔽的 surface node seq
    ]
});
```

### 2.2 自动压缩触发逻辑

**位置**: `dsh-compaction-basic/lib/index.js:772-901`

触发链:
1. **检查点策略**(`dsh-session-checkpoint-policy/lib/index.js:60-76`)在每个请求/tool/step 边界触发 `session/flush`
2. **压力检测**: `compactIfNeeded(agent, 'pressure', signal)` 在 token 压力超过阈值时触发
3. **上下文溢出**: `compactIfNeeded(agent, 'context-overflow', signal)` 在 provider 报告溢出时触发
4. **手动触发**: `/compact` 命令调用 `ctx.compaction.compactNow(agent, signal)`

**默认阈值**(来自 `dsh-compaction-basic` README):
- `thresholdRatio`: 0.8 (在 `floor(routedContextWindow × ratio)` 处压缩)
- `retainRatio`: 0.16 (逐字保留比例)
- `maxTokens`: 8192 (摘要调用上限)
- `auto`: true (自动模式)

### 2.3 可被插件手动调用的入口

**CompactionEngine 抽象类**(`dsh-compaction/lib/types/index.d.ts:75-131`):
```ts
export declare abstract class CompactionEngine extends Service {
    abstract compactIfNeeded(agent, trigger, signal): Promise<CompactionResult | null>;
    abstract compactNow(agent, signal, sourceCommandId?): Promise<CompactionResult | null>;
    abstract compactRegion(start, end, agent, signal?): Promise<CompactionResult>;
}
```

**动态插件可通过 `ctx.get('compaction')` 获取此服务**,然后调用:
- `compactNow(agent, signal)` —— 强制压缩(需要 agent idle)
- `compactRegion(start, end, agent, signal)` —— 压缩指定范围(需要 open turn)

**Session.append 也是公开 API**,动态插件可以直接调用 `session.append(type, data, { surfaceOp, sourceEventSeqs })` 来构造 replace 操作,只要满足 surface 合约。

### 2.4 deriveMessages() 如何消费 replace 段

**核心逻辑**(`dsh-session/lib/index.js:1539-1553`):
```js
deriveMessages() {
    const surface = this.surface;  // SessionSurface
    const nodes = surface.nodes;   // 当前 surface 中的 seq 列表
    // ...
    for (const seq of nodes.slice(this.derivedNodes)) {
        const msg = this.deriveEventMessage(this.log[seq]);
        if (msg) this.derived.push(msg);
    }
    return [...this.derived];
}
```

**Surface fold 逻辑**(`dsh-session/lib/types/surface.js:279-295`):
```js
function applySurfacePlan(state, plan) {
    if (plan?.kind === 'append') {
        state.nodes.push(plan.seq);
    } else if (plan?.kind === 'replace') {
        // 关键: splice 替换,被遮蔽的节点从 nodes 中移除
        state.nodes.splice(plan.startIdx, plan.endIdx - plan.startIdx + 1, plan.seq);
        state.replaceGeneration += 1;
    }
}
```

**replace 操作将 `start..end` 范围内的 surface 节点替换为单个摘要节点**,被遮蔽的节点从 `surface.nodes` 中移除,因此 `deriveMessages()` 不会看到它们。

### 2.5 被遮蔽事件的标记

**三态标记**(`dsh-session-query/lib/types/types.d.ts:12`):
```ts
export type SessionEventSurface = 'current' | 'shadowed' | 'log-only';
```

- `current`: 在当前 surface 中(模型可见)
- `shadowed`: 被 replace 操作遮蔽(不在 surface 中,但在日志中)
- `log-only`: 从未进入 surface 的事件(turn/start, compaction/*, assistant/chunk 等)

**计算方式**(`dsh-session-query/lib/index.js:388`):
```js
for (const replacement of folded.replacements)
    for (const seq of replacement.shadowedSeqs)
        result.set(seq, "shadowed");
```

### 2.6 compaction/start|summary|end 事件结构

**compaction/start**(`dsh-compaction/lib/types/types.d.ts:20-24`):
```ts
'compaction/start': {
    compactionId: CompactionId;
    sourceCommandId?: CommandId;
    turn: number | null;  // null = standalone manual
};
```

**compaction/summary**(`dsh-compaction/lib/types/types.d.ts:34-67`):
```ts
'compaction/summary': {
    compactionId: CompactionId;
    sourceCommandId?: CommandId;
    summary: ContentBlock[];
    shadowedRange: { start: number; end: number };
    shadowedSeqs: number[];
    shadowedTokenCount: number;
    provider: string;
    model: string;
    maxTokens?: number;
    usage?: TokenUsage;
    rawOutput: ContentBlock[];
    llmStreamCall: true;
};
```

**compaction/end**(`dsh-compaction/lib/types/types.d.ts:72-77`):
```ts
'compaction/end': {
    compactionId: CompactionId;
    sourceCommandId?: CommandId;
    turn: number | null;
    error?: string;
};
```

**compaction/prune**(`dsh-compaction/lib/types/types.d.ts:87-97`):
```ts
'compaction/prune': {
    shadowedRange: { start: number; end: number };
    shadowedSeqs: number[];
    shadowedTokenCount: number;
};
```

---

## 3. 动态插件(Host 半体)可达的 API

### 3.1 ctx.get(...) 可拿到的服务

**Host 沙箱提供的全局**(`dsh-cordis-host-runner/lib/types/sandbox.js:16-41`):
- `ctx` —— Cordis Context(`ctx.get(name)`, `ctx.on()`, `ctx.provide()`, `ctx.effect()`)
- `harness` —— `handle()`, `defineTool()`, `registerTool()`
- `console`, `btoa`, `atob`, `TextEncoder`, `TextDecoder`

**与本任务相关的服务**(通过 `ctx.get(name)` 获取):

| 服务名 | 类型 | 用途 | 来源包 |
|---|---|---|---|
| `sessions` | `SessionStore` | 活会话管理(create/get/list/fork/flush) | `dsh-session` |
| `sessionQuery` | `SessionQueryEngine` | 历史查询(listSessions/readSession/traceSession/listEvents/readSurface) | `dsh-session-query` |
| `sessionPersistence` | `SessionPersistence` | 持久层(prepare/readFrom/append) | `dsh-session-persistence` |
| `sessionProjections` | `SessionProjectionRegistry` | 投影注册/变更推送(register/onChanged/snapshot) | `dsh-session-projection` |
| `compaction` | `CompactionEngine` | 压缩引擎(compactIfNeeded/compactNow/compactRegion) | `dsh-compaction` |
| `agents` | `AgentRegistry` | Agent 管理(get/list/roots/create/resume) | `dsh-agent` |
| `subagents` | SubagentService | 子 agent 树(listChildren/listDescendants) | `dsh-subagent` |
| `sessionTitle` | SessionTitleService | 标题管理(get/rename/refresh) | `dsh-session-title` |
| `tokenMeter` | TokenMeter | Token 计量(measure/estimateMessage) | `dsh-llm` |
| `timer` | TimerService | 定时器(timeout/interval) | Cordis 内置 |
| `fs` | FsService | 文件系统 | `dsh-fs` |
| `web` | WebService | 网络请求 | `dsh-web` |
| `bash` | BashService | 进程执行 | `dsh-bash` |

### 3.2 写入会话或触发遮蔽的 API

**直接写入会话**:
```js
// 通过 session.append() 写入任意事件(包括 replace)
const session = ctx.sessions.get(sessionId);
session.append("user/message", data, {
    surfaceOp: { op: "replace", start, end },
    sourceEventSeqs: [...shadowedSeqs]
});
```

**通过 CompactionEngine 触发遮蔽**:
```js
const compaction = ctx.get('compaction');
// 自动压缩
await compaction.compactIfNeeded(agent, 'pressure', signal);
// 手动压缩
await compaction.compactNow(agent, signal);
// 指定范围压缩
await compaction.compactRegion(start, end, agent, signal);
```

**通过 harness.handle 暴露给 Client**:
```js
harness.handle('my-method', async (args) => {
    // 在这里调用 session.append() 或 compaction.*
    return { result: 'ok' };
});
```

### 3.3 现成的 harness 方法

**harness 提供的方法**(`dsh-cordis-host-runner/lib/types/sandbox.js:28-34`):
- `harness.handle(method, handler)` —— 注册 Client→Host RPC
- `harness.defineTool(definition)` —— 定义动态 Tool
- `harness.registerTool(ctx, tool)` —— 注册动态 Tool

**没有现成的 harness 方法直接写入会话或触发遮蔽**——需要通过 `ctx.get()` 获取服务后自行调用。

---

## 4. 风险点

### 4.1 切 active 对正在运行的 turn 的影响

**平台不存在"切 active"操作。** 如果要实现"跳转",需要:

1. **Client 端**: `SessionManager.select(sessionId)` 切换 UI 显示(不影响 Host)
2. **Host 端**: 需要自己实现"跳转"逻辑,可能涉及:
   - 调用 `agent.cancel()` 停止当前 agent
   - 创建新 agent 恢复到目标点
   - 或者在同一 session 上继续(但 surface 已被 modify)

**风险**:如果在 agent running 时修改 session 的 surface(通过 replace),可能导致:
- Agent Loop 的 `phase.turn` 与实际 surface 不一致
- 正在进行的模型请求的上下文被意外修改
- `compactRegion` 要求 `openTurn !== null`(自动压缩)或 `openTurn === null`(手动压缩)

### 4.2 自动压缩与手动遮蔽叠加时会发生什么

**平台有互斥锁机制**(`dsh-compaction-basic/lib/index.js:504-506`):
```js
function assertCompactionInactive(unmatchedCompactionStart, latestEndSeedSeq, stage) {
    if (unmatchedCompactionStart === void 0 || 
        latestEndSeedSeq !== void 0 && latestEndSeedSeq > unmatchedCompactionStart.seq) return;
    throw new ManualCompactionError("busy", 
        `${stage}: compaction already in progress; the session compaction lock is already active`);
}
```

**compaction/start 是互斥锁**:一旦写入,直到 compaction/end 才能再次压缩。如果手动遮蔽使用 `session.append("user/message", ..., { surfaceOp: { op: "replace", ... } })` 而不写 compaction/start/end,则不会触发此锁,但也不会被平台识别为 compaction 事务。

**风险**:
- 手动 replace 和自动 compaction 可能同时操作 surface,导致 surface 状态不一致
- `sourceEventSeqs` 必须包含所有被遮蔽的节点,否则 surface fold 会抛错
- replace 操作的 `start/end` 必须是当前 surface 中存在的节点 seq

### 4.3 会话冷启动/重建时 replace 段是否保留

**保留。** 原因:

1. **日志是仅追加的**:replace 操作只是在 surface 层面替换节点,原始事件仍在日志中
2. **Surface 是从日志 fold 出来的**:冷启动时 `Session` 构造函数从日志 replay surface,replace 操作会被重新执行
3. **持久化不删除历史**:官方文档明确"日志在 root 下累积,直到外部移除(seam 无删除接口)"

**证据**(`dsh-session-persistence-jsonl/lib/index.js`):JSONL 文件只追加,不删除。zstd 压缩是 frame 级别的,每个 frame 独立可解。

**冷启动流程**:
1. `SessionPersistence.prepare(id)` 读取磁盘日志
2. `Session.fromRestore(id, events, header)` 重建 Session 对象
3. `SurfaceManager` 从头 fold 所有事件,重建 surface
4. 所有 replace 操作的 `shadowedSeqs` 被正确标记为 `shadowed`

---

## 5. 关键文件速查

| 主题 | 文件(相对 `<root>`) |
|---|---|
| Session 模型/append/surface | `dsh-session/lib/types/index.d.ts`, `dsh-session/lib/index.js` |
| Surface fold 逻辑 | `dsh-session/lib/types/surface.js`, `surface.d.ts` |
| SurfaceOp/SurfaceIntent 类型 | `dsh-session/lib/types/types.d.ts:388-406` |
| CompactionEngine 抽象 | `dsh-compaction/lib/types/index.d.ts:75-131` |
| compaction 事件类型 | `dsh-compaction/lib/types/types.d.ts:13-98` |
| BasicCompactionEngine 实现 | `dsh-compaction-basic/lib/index.js:418-962` |
| Agent Loop turn 追踪 | `dsh-agent-loop/lib/index.js:440-560` |
| Agent 类型(无 turn 字段) | `dsh-agent/lib/types/runtime-types.d.ts:60-133` |
| SessionStore.fork | `dsh-session/lib/index.js:1840-1872` |
| SessionQuery 三态标记 | `dsh-session-query/lib/types/types.d.ts:12`, `lib/index.js:388` |
| Client SessionManager.select | `dsh-client-runtime/lib/client.js:7868-7873` |
| Host 沙箱全局 | `dsh-cordis-host-runner/lib/types/sandbox.js:16-41` |
| 检查点策略(触发 flush) | `dsh-session-checkpoint-policy/lib/index.js:60-76` |

---

## 6. 对实现 B1 方案的平台能力评估

### 能做什么

1. **读取任意会话的完整事件日志**: `ctx.sessionQuery.readSession(id)` 或 `ctx.sessions.get(id).events`
2. **读取会话的当前 surface**: `ctx.sessionQuery.readSurface(id)` 或 `session.surface.nodes`
3. **判断事件的 surface 状态**: `ctx.sessionQuery.listEvents(id)` 返回每条事件的 `surface: 'current' | 'shadowed' | 'log-only'`
4. **在 session 上 append replace 事件**: `session.append("user/message", data, { surfaceOp: { op: "replace", start, end }, sourceEventSeqs })`
5. **触发 compaction**: `ctx.compaction.compactRegion(start, end, agent, signal)` (需要 open turn) 或 `ctx.compaction.compactNow(agent, signal)` (需要 idle agent)
6. **监听所有会话事件**: `ctx.on('session/event', (session, event) => ...)`
7. **fork 子会话**: `ctx.sessions.fork(source, boundary)` (线性续接,非分支)
8. **Client UI 挂载**: `conversation.view` slot (list/session), `shell.overlay` slot (list/root)
9. **实时数据推送**: `ctx.sessionProjections.register()` + `session/projection` frame

### 不能做什么

1. **不能修改 Session 的内部状态(如回退 turn)**:Session 是纯追加日志,没有"回退"API
2. **不能在 Host 端"切换 active"**:没有 `setActiveCursor` 或类似 API
3. **不能同时运行多个 agent 在同一 session 上**:Agent 与 Session 一一对应,一个 session 同时只有一个 agent
4. **不能在 open turn 时手动压缩**:`compactNow` 要求 idle,`compactRegion` 需要 open turn 但不能有并发 compaction
5. **不能直接操作 surface 数组**:surface 是从日志 fold 出来的派生状态,只能通过 append 事件间接修改

### 需要变通什么

1. **"跳转"语义**:平台没有"跳转到会话中间某点"的能力。B1 方案的"跳转"需要重新定义为:
   - 在当前 session 上 append 一个 replace 事件,遮蔽"被放弃的分支段"
   - 然后继续在当前 session 末尾追加新消息
   - **这不是真正的"跳转",而是"遮蔽+继续"**

2. **上下文隔离**:B1 方案的"compaction 式遮蔽"可以直接用 `session.append("user/message", summary, { surfaceOp: { op: "replace", start, end }, sourceEventSeqs })` 实现,但需要:
   - 手动构造摘要内容(或调用 LLM 生成)
   - 手动计算 `sourceEventSeqs`(必须包含所有被遮蔽的节点)
   - 手动处理 `compaction/start|end` 互斥锁(如果不想触发平台 compaction 逻辑)

3. **分支可视化**:平台只有线性日志 + surface replace,没有真正的"分支"数据结构。图谱的"分支"需要在插件层自建,用 `sessionQuery.traceSession()` 获取父子关系,用 `sessionQuery.listEvents()` 获取事件流,在 Client 端渲染分支图。

4. **多跳累积**:每次"跳转"都会在日志末尾追加一个 replace 事件,日志会持续增长。需要在图谱插件中跟踪所有 replace 操作,维护"当前 surface 状态"的投影。

---

## 7. 平台能力 vs 缺失 结论表

| 能力 | 平台现状 | 需要做什么 |
|---|---|---|
| **读取会话事件日志** | ✅ `session.events` / `sessionQuery.readSession()` | 直接使用 |
| **读取当前 surface** | ✅ `session.surface.nodes` / `sessionQuery.readSurface()` | 直接使用 |
| **判断事件 surface 状态** | ✅ `sessionQuery.listEvents()` 返回 `surface` 字段 | 直接使用 |
| **append replace 事件** | ✅ `session.append(type, data, { surfaceOp: { op: "replace", start, end }, sourceEventSeqs })` | 直接使用,但需手动构造摘要和 sourceEventSeqs |
| **触发 compaction** | ✅ `ctx.compaction.compactRegion/compactNow()` | 需要 agent 上下文,有 open turn/idle 限制 |
| **监听实时事件** | ✅ `ctx.on('session/event', ...)` | 直接使用 |
| **fork 子会话** | ✅ `ctx.sessions.fork()` | 线性续接,非真正分支 |
| **Client UI 挂载** | ✅ `conversation.view` / `shell.overlay` slot | 直接使用 |
| **Host→Client 数据推送** | ✅ `sessionProjections` + `useProjection` | 直接使用 |
| **切换 active cursor** | ❌ 不存在 | 需要在插件层自建"当前点"概念 |
| **回退到历史点** | ❌ 不存在(仅追加日志) | 用 replace 遮蔽替代 |
| **真正的分支会话** | ❌ 只有 fork(线性续接) | 在插件层用 replace + 图谱可视化模拟 |
| **并发多 agent 同 session** | ❌ 一一对应 | 不可行,需另辟蹊径 |
| **直接操作 surface 数组** | ❌ surface 是派生状态 | 只能通过 append 事件间接修改 |
