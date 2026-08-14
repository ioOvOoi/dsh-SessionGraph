# E: 子会话完整原子图谱展开——数据可行性研究

> 研究目标:查证「在主会话图谱中展开显示子 agent(子会话)的完整原子图谱」的数据可行性。
> 研究方式:直接读取 DSH 部署源码 + SessionGraph 现状代码(pkg-62),禁止猜测。

---

## 摘要(10 行)

1. **投影对所有会话自动维护**: `sessionProjections` 订阅全局 `session/event`,对每个会话的事件流都 apply,包括未被 UI 打开的子会话——前提是该会话对象在内存中。
2. **sp.snapshot(childSession) 可行**: 只要能拿到子会话的 Session 对象(活会话或从持久化加载),即可拿到其 `sessiongraph.graph` 节点流。
3. **冷启动完全可行**: `sessionQuery.readSession(childId)` 可获取完整事件日志,SessionGraph 的 `apply` 是纯函数,可离线重放构建节点流。
4. **childId 就是 sessionId**: `subagent/start` 的 `info.id` 即子会话 id,可直接用于 `ctx.sessions.get()` / `sessionQuery.readSession()`。
5. **已有子会话导航先例**: Client 端有 `sessions.selectSubagent(address)` 机制,子会话可通过 catalog 系统被发现和切换,但不存在"内联嵌套图谱"的现有 UI 模式。
6. **跳转锚点是全局 DOM 查询**: `scrollToKey` 使用 `document.querySelector('[data-chat-anchor-key="..."]')`,子会话不在当前聊天视图时返回 null,需要降级策略。
7. **switchRuns 缺少 label 字段**: 现有委派记录只有 childId/provider/runId,缺少子会话的 label(人类可读名称)和 mode(one-shot/continuable)。
8. **可行性结论:可行,有两条数据路径**: 热路径(活会话 projection snapshot) + 冷路径(sessionQuery 读事件日志后离线 fold)。
9. **性能约束**: 冷路径需要全量读取子会话事件日志并重放 projection apply;短会话(≤50 events)开销极小,长会话(>500 events)需考虑懒加载。
10. **最大风险**: 跳转到子会话聊天视图才能正确定位锚点;纯图谱内展开模式需完全绕过 DOM 跳转,改用图谱内聚焦。

---

## 可行性结论

**可行**。数据层完全支持,两条路径互补:

| 条件 | 路径 | API | 代价 |
|---|---|---|---|
| 子会话活在内存 | 热路径 | `sp.snapshot(session)` | 同步,几乎零开销 |
| 子会话已结束/持久化 | 冷路径 | `sessionQuery.readSession()` + 离线 fold | 异步,IO + CPU(fold) |
| 子会话尚未产生事件 | 空图 | 返回空节点列表 | 零开销 |

**关键约束**:
- 冷路径需要插件持有 `sessiongraph.graph` 的 `apply` 函数(当前已内联在 register 中,可提取为共享纯函数)
- 跳转到聊天锚点需要先切换会话视图,否则 DOM 查询失败

---

## 逐条查证结论

### 1. 投影是否按会话自动维护

**结论:是的,对所有会话的事件流都 apply,不限于"当前打开的会话"。**

**源码位置**: `dsh-session-projection/lib/index.js`

```js
// 第 46-48 行:构造器订阅全局 session/event
constructor(ctx) {
    super(ctx, "sessionProjections");
    ctx.on("session/event", (session, event) => {
        this.drive(session, event);
    });
}
```

```js
// 第 255-271 行:drive 对每个注册单元执行 apply
drive(session, event) {
    for (const registration of this.registrations.values()) {
        let cell = registration.cells.get(session);
        if (cell === void 0) {
            cell = this.buildCell(registration.def, session.events.slice(0, event.seq));
            registration.cells.set(session, cell);
        }
        const next = registration.def.apply(cell.state, event);
        // ...
    }
}
```

```js
// 第 246-253 行:cellFor 按会话对象懒构建
cellFor(registration, session) {
    let cell = registration.cells.get(session); // WeakMap<Session, Cell>
    if (cell === void 0) {
        cell = this.buildCell(registration.def, session.events);
        registration.cells.set(session, cell);
    }
    return cell;
}
```

**关键机制**:
- `registrations.cells` 是 `WeakMap<Session, Cell>`,以 Session 对象为 key
- 每个会话的投影状态独立维护,互不影响
- `snapshot(session)` 对任何 Session 对象都可读取投影值
- **限制**:需要 Session 对象存在于内存中(WeakMap 不持有强引用,会话被 GC 后 cell 消失)

**对子会话的含义**:
- 子会话运行期间,其 Session 对象在内存中 → 投影自动维护 ✅
- 子会话结束后 Session 对象被 GC → cell 消失,但事件日志仍在持久化存储中 ✅
- 重新加载子会话(从持久化)后,投影从 init 重新 fold ✅

### 2. 冷启动:从日志重建节点流

**结论:完全可行。有现成 API 可获取完整事件日志,projection apply 是纯函数可离线重放。**

**数据获取 API**:

| API | 返回 | 用途 |
|---|---|---|
| `sessionQuery.readSession(childId)` | `{ session: header, events: [...] }` | 完整事件日志(含所有 seq) |
| `sessionQuery.listEvents(childId)` | `[{sessionId, seq, type, time, surface}]` | 轻量事件记录(无 content) |
| `sessionQuery.readSurface(childId)` | `{ session, capturedThroughSeq, events }` | 当前 surface 事件 |
| `sessions.get(childId)` | `Session` 对象(活会话) | 直接访问 `.events` |
| `sessionQuery.traceSession(childId)` | `{target, ancestors, descendants}` | 会话谱系 |

**SessionGraph projection 需要的事件类型与字段**:

| 事件类型 | 使用的字段 | projection 中的行号(pkg-62.host.js) |
|---|---|---|
| `turn/start` | `data.turn`, `seq`, `time` | 第 143-153 行 |
| `turn/end` | `data.turn`, `data.reason` | 第 155-163 行 |
| `user/message` | `data.id`, `data.role`, `data.content`, `data.source`, `seq`, `time` | 第 165-181 行 |
| `assistant/message` | `data.message.{id,role,content}`, `data.turn`, `data.step`, `data.usage`, `seq`, `time` | 第 183-195 行 |
| `tool/call` | `data.callId`, `data.name`, `data.step`, `seq`, `time` | 第 197-206 行 |
| `tool/result` | `data.message.content[].toolCallId`, `data.error` | 第 208-225 行 |

**冷启动重建步骤**:
```js
// 1. 读取子会话完整事件日志
const { events } = await sessionQuery.readSession(childId)

// 2. 用 SessionGraph 的 apply 函数离线 fold
let state = { nodes: [], cursor: null, currentTurn: null }
for (const event of events) {
    state = sessionGraphApply(state, event) // 提取 register 中的 apply 为纯函数
}

// 3. view 转换
const graph = { nodes: state.nodes, cursor: state.cursor }
```

**优化路径**: `dsh-session-projection` 已有 `restore(checkpoint, events, baseSeq)` 方法(第 209-235 行),可利用持久化的投影缓存避免全量重放。但 SessionGraph 插件目前未使用持久化投影缓存,首次冷启动需全量 fold。

### 3. childId → 会话映射

**结论:childId 就是可用的 sessionId。映射路径完整,但 switchRuns 缺少 label 字段。**

**subagent/start 事件结构**(`dsh-subagent/lib/index.js` 第 192-197 行):
```js
const identity = {
    runId: SubagentRunId(randomUUID()),
    provider,
    id: run.id,       // ← 这就是子会话 sessionId
    local: run.localAgent !== void 0
};
```

**switchRuns 现有记录**(pkg-62.host.js 第 36-43 行):
```js
{
    runId: String(info.runId),
    childId: String(info.id),     // ✅ 即 sessionId
    provider: String(info.provider),
    startedAt: Date.now(),
    stopReason: null,
    endedAt: null,
}
```

**获取子会话对象的路径**:

| 方法 | 条件 | 返回 |
|---|---|---|
| `ctx.sessions.get(childId)` | 子会话在内存中 | Session 对象 |
| `ctx.agents.get(childId)` | 子会话 agent 仍在运行 | Agent 对象 |
| `sessionQuery.readSession(childId)` | 子会话已持久化 | `{session: header, events}` |
| `sessionQuery.readTitle(childId)` | 任意 | 会话标题(string) |
| `sessionQuery.traceSession(childId)` | 任意 | 谱系(含 parentSession) |

**switchRuns 缺少的字段**:

| 缺失字段 | 来源 | 用途 |
|---|---|---|
| `label` | `subagent/descriptor` 事件中的 `label` 字段 | 子会话人类可读名称 |
| `mode` | `subagent/descriptor` 事件中的 `mode` 字段 | one-shot / continuable |
| `title` | `sessionQuery.readTitle(childId)` | 会话标题(可从日志 fold) |

**补充 label 的方案**:
- 方案 A:在 `subagent/start` handler 中追加 `foldSubagentDescriptor` 调用,从子会话事件中提取 label(需要子会话已 append descriptor 事件)
- 方案 B:在 Client 端通过 `sessionQuery.readTitle(childId)` 懒加载标题
- 方案 C:在 RPC `sessiongraph.get` 中附带 title(需额外 IO)

### 4. UI 展开形态参考

**结论:DSH 没有现成的"内联嵌套会话图谱"先例。现有模式是全量切换。**

**现有子会话 UI 机制**:

1. **Subagent Catalog**(Client `dsh-client-runtime/lib/client.js`):
   - `sessions.refreshSubagents(parentSessionId)` 调用 `api.subagents.list()` 获取子会话列表
   - 返回 `catalog.entries` 数组,每项含 `{kind: "child", id, mode, label, activity}`
   - 在侧边栏/会话列表中显示为子条目

2. **子会话导航**(第 7882-7891 行):
   ```js
   selectSubagent(address) {
       // address = {parentSessionId, childSessionId, mode}
       this.selected = address.childSessionId;
       // 整个聊天视图切换到子会话
   }
   ```
   - 点击子会话条目 → 整个对话视图切换到子会话
   - 面包屑(breadcrumb)允许返回父会话

3. **没有 trajectory UI 包**: `*trajectory*` glob 搜索 `node_modules/@deepseek-ai/` 无结果
4. **没有嵌套图谱/子图展开的 UI 先例**

**可参考的 UI 模式**:
- 面包屑导航(breadcrumb): 显示 `父会话 > 子会话` 路径,可点击返回
- 侧边栏子条目: catalog 系统的 `entries` 列表
- **但这些都是"全量切换"模式,不是"内联嵌套"**

### 5. 风险:跳转锚点降级

**结论:全局 DOM 查询是硬约束,子会话不在当前聊天视图时跳转必然失败。需要明确的降级策略。**

**当前跳转机制**(pkg-62.client.js 第 158-180 行):

```js
// keyOfNode 生成锚点 key
const keyOfNode = (n, items) => {
    if (n.category === 'user' || n.category === 'context') return '12:input-message' + n.id
    if (n.category === 'assistant') {
        const m = mOf(n)
        if (m.step != null) return '14:assistant-step' + m.turn + ':' + m.step
        return turnKey(m.turn, items)
    }
    if (n.category === 'tool') return '9:tool-call' + mOf(n).callId
    // ...
}

// scrollToKey 全局 DOM 查询
const scrollToKey = (key) => {
    const el = document.querySelector('[data-chat-anchor-key="' + key + '"]')
    if (!el) return  // ← 子会话不在聊天视图时,这里直接返回
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    // ...
}
```

**`data-chat-anchor-key` 的渲染位置**:
- 由 web shell 的 conversation 组件渲染(不在 `dsh-client-runtime` 中)
- 每个 user/message、assistant/message、tool-call 等 DOM 元素带有此属性
- 格式: `{kind.length}:{kind}{id}` (由 `conversationContextKey` 函数生成)

**风险场景**:

| 场景 | DOM 中存在锚点? | 行为 |
|---|---|---|
| 主会话图谱点击主会话节点 | ✅ 是 | 正常滚动+高亮 |
| 子会话图谱点击子会话节点(子会话已切换到聊天视图) | ✅ 是 | 正常滚动+高亮 |
| 子会话图谱点击子会话节点(子会话未切换,仍在主会话聊天视图) | ❌ 否 | `scrollToKey` 静默失败 |
| 子会话图谱点击子会话节点(子会话已结束,无聊天视图) | ❌ 否 | 同上 |

**降级策略选项**:

| 策略 | 描述 | 复杂度 |
|---|---|---|
| **A. 先切换再跳转** | 点击子图谱节点 → 先 `sessions.select(childId)` 切换聊天视图 → 等待渲染 → 再 `scrollToKey` | 中(需处理异步渲染时序) |
| **B. 纯图谱聚焦** | 点击子图谱节点 → 在图谱中高亮该节点(脉冲动画),不尝试跳转聊天 | 低(已有 `setSelectedId` + `sg-pulse` 动画) |
| **C. 条件降级** | 先尝试 `scrollToKey`,失败则退化到图谱聚焦 | 低(当前 `scrollToKey` 已是静默失败,只需加图谱聚焦) |
| **D. 内嵌摘要** | 点击子图谱节点 → 展开 tooltip 显示该节点的完整文本(无需跳转) | 低 |

**推荐**:策略 C(条件降级)——最符合直觉,主会话节点正常跳转,子会话节点在无法跳转时退化为图谱聚焦。

---

## 数据获取方案对比表

| 方案 | API | 冷启动支持 | 性能 | 实现复杂度 | 适用场景 |
|---|---|---|---|---|---|
| **热路径: projection snapshot** | `sp.snapshot(childSession)` | ❌ 需活 Session | 同步, <1ms | 低 | 子会话正在运行 |
| **冷路径: readSession + fold** | `sessionQuery.readSession(id)` → 手动 apply | ✅ | 异步, ~10-100ms(视事件数) | 中(需提取 apply 为纯函数) | 子会话已结束 |
| **冷路径: restore** | `sp.restore({}, events, 0)` | ✅ | 同上 | 低(直接调用框架 API) | 需同时获取所有投影值 |
| **混合路径** | 先尝试 `sessions.get(id)` → 失败则 `sessionQuery.readSession(id)` | ✅ | 视情况 | 中 | 通用场景 |

**推荐方案:混合路径**
```
1. childSession = ctx.sessions.get(childId)
2. if (childSession):
     snap = sp.snapshot(childSession)
     graph = snap.values['sessiongraph.graph']
3. else:
     {events} = await sessionQuery.readSession(childId)
     snap = sp.restore({}, events, 0)  // 或手动 fold
     graph = snap.values['sessiongraph.graph']
4. return graph  // {nodes: [...], cursor: '...'}
```

---

## 实现要点

### Host 端(RPC)

新增 RPC `sessiongraph.childGraph`:
```js
harness.handle('sessiongraph.childGraph', async (args) => {
    const childId = args?.childId
    if (!childId) return { nodes: [], cursor: null }

    // 热路径
    const sessions = ctx.get('sessions')
    const liveSession = sessions?.get(childId)
    if (liveSession && sp) {
        const snap = sp.snapshot(liveSession)
        const graph = snap.values['sessiongraph.graph']
        if (graph) return { nodes: graph.nodes, cursor: graph.cursor }
    }

    // 冷路径
    const sessionQuery = ctx.get('sessionQuery')
    if (!sessionQuery) return { nodes: [], cursor: null }
    const { events } = await sessionQuery.readSession(childId)
    if (!events || events.length === 0) return { nodes: [], cursor: null }

    // 离线 fold (需提取 apply 为共享函数)
    let state = sessionGraphInit()
    for (const event of events) state = sessionGraphApply(state, event)
    return { nodes: state.nodes, cursor: state.cursor }
})
```

### Client 端(UI)

点击 switch 节点时:
```js
// 1. 请求子会话图谱数据
const childGraph = await host.call('sessiongraph.childGraph', { childId: n.meta.childId })

// 2. 在图谱中渲染子图(作为嵌套子图或弹出面板)
setChildGraph({ parentId: n.id, graph: childGraph })

// 3. 子图节点点击:条件降级
const jumpChildNode = (node) => {
    const key = keyOfNode(node, childItems)
    scrollToKey(key)  // 如果子会话不在聊天视图,静默失败
    // 可选:检测失败后退化到图谱聚焦
}
```

### 需要提取的共享函数

当前 `sp.register` 中的 `apply` 是内联的,需要提取为可复用的纯函数:

```js
// 从 pkg-62.host.js 第 142-229 行提取
const SESSIONGRAPH_INIT = () => ({ nodes: [], cursor: null, currentTurn: null })
const SESSIONGRAPH_APPLY = (state, event) => { /* ... */ }
const SESSIONGRAPH_VIEW = (state) => ({ nodes: state.nodes, cursor: state.cursor })
```

这样 cold path 可以直接调用 `SESSIONGRAPH_APPLY` 而不需要依赖 live projection registry。

---

## 源码索引

| 主题 | 文件 | 行号 |
|---|---|---|
| SessionGraph projection 注册与 apply | `pkg-62.host.js` | 137-232 |
| SessionGraph RPC `sessiongraph.get` | `pkg-62.host.js` | 106-124 |
| switchRuns 记录逻辑 | `pkg-62.host.js` | 31-63 |
| Client switch 节点渲染 | `pkg-62.client.js` | 648-660 |
| Client 跳转逻辑(keyOfNode/scrollToKey) | `pkg-62.client.js` | 158-180 |
| projection 全局 session/event 订阅 | `dsh-session-projection/lib/index.js` | 46-48 |
| projection drive (per-session apply) | `dsh-session-projection/lib/index.js` | 255-271 |
| projection snapshot (any session) | `dsh-session-projection/lib/index.js` | 105-115 |
| projection restore (cold rebuild) | `dsh-session-projection/lib/index.js` | 209-235 |
| sessionQuery.readSession | `dsh-session-query/lib/index.js` | 811-818 |
| sessionQuery.listEvents | `dsh-session-query/lib/index.js` | 872-874 |
| sessionQuery.traceSession | `dsh-session-query/lib/index.js` | 912-916 |
| subagent/start identity 结构 | `dsh-subagent/lib/index.js` | 192-197 |
| childSessionMeta (parentSession 字段) | `dsh-subagent/lib/index.js` | 530-541 |
| Client selectSubagent | `dsh-client-runtime/lib/client.js` | 7882-7891 |
| Client refreshSubagents (catalog) | `dsh-client-runtime/lib/client.js` | 8000-8049 |
| conversationContextKey | `dsh-client-runtime/lib/client.js` | 5857-5858 |
| subagent descriptor fold | `dsh-subagent/lib/index.js` | 449-453 |
