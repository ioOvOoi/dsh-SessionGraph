# T5 设计文档 §5 待验证清单 — 静态验证报告

> 验证时间: 2026-08-14。逐项对照部署源码静态验证,只读不改。
> 根目录: `C:\Users\Administrator\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\`

---

## 验证项 1: `surfaceOp.start/end` 语义

### 结论: **已验证 — start/end 是 event seq,非数组索引**

### 源码证据

**类型定义** — `dsh-session/lib/types/types.d.ts:388-392`:
```ts
export type SurfaceOp = 'append' | {
    op: 'replace';
    start: number;  // inclusive surface position
    end: number;    // inclusive surface position
};
```
注释写 "surface position",但这是 event seq number,不是数组索引。源码实证如下。

**`isReplaceOp` 校验** — `dsh-session/lib/types/surface.js:113-121`:
```js
function isReplaceOp(value) {
    const op = value;
    return Object.keys(op).length === 3
        && Object.hasOwn(op, 'op')
        && Object.hasOwn(op, 'start')
        && Object.hasOwn(op, 'end')
        && op['op'] === 'replace'
        && isEventSeq(op['start'])   // typeof === "number" && isSafeInteger && >= 0
        && isEventSeq(op['end']);
}
```
仅校验 `start/end` 是非负安全整数(即 seq),不做数组范围检查。

**`replacementRange` — seq→index 映射的核心逻辑** — `surface.js:182-199`:
```js
function replacementRange(state, op) {
    const startIdx = state.nodes.indexOf(op.start);  // seq → 数组索引
    if (startIdx === -1) throw new Error(`surface replace: start seq ${op.start} not found in surface`);
    const endIdx = state.nodes.indexOf(op.end);
    if (endIdx === -1) throw new Error(`surface replace: end seq ${op.end} not found in surface`);
    if (startIdx > endIdx) throw new Error(`surface replace: start seq ... is after end seq ...`);
    return { startIdx, endIdx, shadowedSeqs: state.nodes.slice(startIdx, endIdx + 1) };
}
```
**关键**: `state.nodes` 是 seq 数组(如 `[0, 3, 5, 7, 10]`),`indexOf(op.start)` 在此数组中查找 seq 值,返回其数组索引。所以 `start/end` 传入的是 **event seq**(如 `3`),由 `indexOf` 映射为数组索引(如 `1`)。

**`applySurfacePlan` — splice 操作** — `surface.js:279-286`:
```js
function applySurfacePlan(state, plan) {
    if (plan?.kind === 'replace') {
        state.nodes.splice(plan.startIdx, plan.endIdx - plan.startIdx + 1, plan.seq);
        //            ↑ 数组索引操作
    }
}
```
splice 使用 `startIdx/endIdx`——这些是从 seq 通过 `indexOf` 得到的数组索引。

**compaction-basic 的调用方式** — `dsh-compaction-basic/lib/index.js:605-616`:
```js
session.append("user/message", checkpointMessage, {
    surfaceOp: {
        op: "replace",
        start,   // 来自 selectCompactableRange → surfaceNodes[0] (seq)
        end      // 来自 selectCompactableRange → surfaceNodes[keepFromIdx - 1] (seq)
    },
    sourceEventSeqs: [startEvent.seq, summaryEvent.seq, ...shadowedSeqs]
});
```
`selectCompactableRange` 返回的 `start/end` 来自 `surfaceNodes[0]` 和 `surfaceNodes[keepFromIdx - 1]`——即 `session.surface.nodes` 数组中的 **seq 值**。

**`validateSurfaceRegion` — compaction-basic 内部也做 indexOf 映射** — `index.js:518-534`:
```js
function validateSurfaceRegion(session, start, end) {
    const nodes = session.surface.nodes;
    const startIdx = nodes.indexOf(start);  // 同样是 seq→index
    const endIdx = nodes.indexOf(end);
    // ...
}
```

### 对设计的影响
设计文档(§2.1 第 6 步)中 `surfaceOp:{ op:'replace', start, end }` 的 `start/end` 应传入 **surface 中被遮蔽范围首尾节点的 event seq**。插件侧可直接从 `session.surface.nodes` 中读取——例如 `anchorSeq 之后的首尾节点 seq`。无需手动计算数组索引。**设计正确,无需修正。**

---

## 验证项 2: 自定义 data 标记(`sgJump`)

### 结论: **已验证 — ①持久化保留 ②事件流透传 ③无 schema 拒绝未知字段**

### 源码证据

**① JSONL 持久化原样保留**

Session.append 的数据走 `snapshotJsonValue(data)` 做 lossless JSON 校验 — `index.js:1446`:
```js
const dataSnapshot = snapshotJsonValue(data);
if (dataSnapshot === void 0) throw new Error(`session event "${type}" carries non-JSON-serializable data`);
```
`snapshotJsonValue` 仅校验 JSON 可序列化性(BigInt/circular/exotic 等会拒绝),**不校验已知字段白名单**。自定义字段如 `sgJump: { anchorSeq, shadowedSeqs, summary }` 是普通 JSON 对象,通过校验。

JSONL 持久化(`dsh-session-persistence-jsonl`)存储完整的 event JSON——`type`, `seq`, `time`, `data` 以及 `surfaceOp`/`sourceEventSeqs` 全部写入一行 JSONL。自定义 data 字段随 data 对象原样写入。

**② session.events / sessionQuery.listEvents / deriveEventMessage 透传**

- `session.events` 返回完整冻结 event 数组 — `index.js:1397-1399`,`event.data` 包含所有字段
- `deriveEventMessage` 对 `user/message` 返回 `event.data` — `surface.js:84-86`:
  ```js
  case 'user/message': return event.data;
  ```
  `event.data` 即完整的 data 对象,包含 `sgJump`
- `listEvents` 返回 `{ sessionId, seq, type, time, surface }` — `dsh-session-query/lib/index.js:341-349`,不返回 data 内容,但调用者可从 session.events 获取
- `readSession` 返回完整 event 数组 — `index.js:811-818`

**③ 无 schema 拒绝未知字段**

`assertSessionEventEnvelope` — `index.js:1189-1213` 仅校验:
- `type` 是 string,`seq` 是非负整数,`time` 是整数,data 不是 undefined
- 不做 data 内容的字段白名单校验

`assertMessageEventShape` — `index.js:1242-1266` 对 `user/message` 校验:
- `message.id` 是非空 string
- `message.role` 是 "user"
- `message.source.kind` 是 string
- `message.content` 是数组
- **不校验 data 对象的其他字段**(sgJump 不在 message 对象内,在 data 顶层)

`assertCurrentLlmShape` — `index.js:1216-1232` 同样不校验 data 顶层字段。

### 对设计的影响
设计中 `sgJump:{ anchorSeq, shadowedSeqs:[...], summary }` 附加在 `user/message` 的 data 上,**可以安全实现**:
- 持久化:原样写入 JSONL
- 事件流:session.events 和 readSession 返回完整 event,sgJump 可读
- deriveMessages:返回 `event.data`,sgJump 包含在内
- 投影:插件可从 `event.data.sgJump` 读取标记来生成 category:'jump' 节点

**设计正确,无需修正。**

---

## 验证项 3: 手动 replace(无 compaction/start|end 事务)

### 结论: **已验证 — ①正常执行 splice ②sourceEventSeqs 缺失会抛错(必须包含所有 shadowedSeqs)③shadowed 标记依赖 foldSurface 正确生成**

### 源码证据

**① applySurfacePlan 正常执行 splice**

`planSurfaceEvent` — `surface.js:251-271`:
```js
function planSurfaceEvent(state, event, expectedSeq, events, baseSeq) {
    // ...
    if (surfaceOp === 'append') { /* ... */ }
    const range = replacementRange(state, surfaceOp);  // 查找 start/end 在 nodes 中的位置
    assertProvenance(event, range.shadowedSeqs);       // 校验 sourceEventSeqs
    assertToolResultRewrite(event, range.shadowedSeqs, events, baseSeq); // tool/result 特殊校验
    return { kind: 'replace', seq: event.seq, start: surfaceOp.start, end: surfaceOp.end, ...range };
}
```
**没有任何地方检查 compaction/start 是否存在**。只要 `surfaceOp` 合法、`sourceEventSeqs` 完整、`start/end` 存在于 surface nodes 中,replace 就能执行。

**② sourceEventSeqs 缺失/不完整会抛错**

`assertProvenance` — `surface.js:150-179`:
```js
function assertProvenance(event, shadowedSeqs) {
    const raw = event.sourceEventSeqs;
    // ...
    if (raw.length === 0 && event.type !== 'assistant/message') {
        throw new Error('sourceEventSeqs must not be empty except on assistant/message');
    }
    // ... 校验每个 source 是 seq,非重复,比当前 event.seq 早 ...
    const missing = shadowedSeqs.filter(seq => !sources.has(seq));
    if (missing.length > 0) {
        throw new Error(`surface replace: sourceEventSeqs must include every shadowed surface node; missing ${missing.join(', ')}`);
    }
}
```
**关键**: `shadowedSeqs` 由 `replacementRange` 从 `state.nodes.slice(startIdx, endIdx + 1)` 计算得到——即 start 到 end 之间所有当前 surface 节点的 seq。`sourceEventSeqs` 必须包含**全部**这些 seq,否则抛错。

对于手动 replace(无 compaction/start):`shadowedSeqs` 仍然正确计算——只要 start/end 指向 surface 中存在的节点,`replacementRange` 就能返回正确的 `shadowedSeqs`。插件侧需要自行从 `session.surface.nodes` 中提取被遮蔽范围的所有 seq,放入 `sourceEventSeqs`。

**③ listEvents 的 shadowed 标记依赖 foldSurface**

`classifySurface` — `dsh-session-query/lib/index.js:374-389`:
```js
function classifySurface(events) {
    const folded = foldSurface(events);
    const result = new Map();
    for (const seq of folded.nodes) result.set(seq, "current");
    for (const replacement of folded.replacements)
        for (const seq of replacement.shadowedSeqs) result.set(seq, "shadowed");
    return result;
}
```
`foldSurface` 对完整日志做 replay,任何合法的 replace 操作(无论是否有 compaction/start|end)都会被 fold 并记录到 `replacements` 中。`shadowedSeqs` 来自 `replacementRange` 的计算结果,与 `sourceEventSeqs` 无关——`sourceEventSeqs` 仅用于校验(确保插件声明了所有被遮蔽的节点)。

**工具结果的特殊约束**:如果 replace 目标是 `tool/result`,`assertToolResultRewrite` — `surface.js:222-248` 会额外校验:只能 rewrite 单个节点、只能改 content。但 `user/message` 类型不受此约束。

### 对设计的影响
设计中手动 replace(无 compaction 事务)的方案**可行**:
- 不需要写 compaction/start|end,平台不强制
- `sourceEventSeqs` 必须包含被遮蔽范围的所有 surface node seq——插件需从 `session.surface.nodes` 中提取 anchor 之后到末尾的所有 seq
- `listEvents` 的 shadowed 标记会正确生成——foldSurface 独立于 sourceEventSeqs

**设计正确,但需注意**:sourceEventSeqs 必须完整覆盖被遮蔽范围。设计文档中 `sourceEventSeqs:[...shadowedSeqs]` 的写法是正确的。

---

## 验证项 4: 并发检测(compaction 未闭合)

### 结论: **已验证 — 可从事件流扫描判定,compaction-basic 提供了完整的实现参考**

### 源码证据

**`inspectCompactionEntryState`** — `dsh-compaction-basic/lib/index.js:659-687`:
```js
function inspectCompactionEntryState(events) {
    let openTurn = null;
    let openTurnStateKnown = false;
    let unmatchedCompactionStart;       // ← 关键字段
    let compactionEntryStateKnown = false;
    let latestEndSeedSeq;

    for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index];
        if (latestEndSeedSeq === void 0 && event.type === "session/end-seed")
            latestEndSeedSeq = event.seq;
        if (!compactionEntryStateKnown) {
            if (event.type === "compaction/start") {
                unmatchedCompactionStart = event;
                compactionEntryStateKnown = true;
            } else if (event.type === "compaction/end")
                compactionEntryStateKnown = true;
        }
        if (!openTurnStateKnown) {
            if (event.type === "turn/start") {
                openTurn = event.data.turn;
                openTurnStateKnown = true;
            } else if (event.type === "turn/end")
                openTurnStateKnown = true;
        }
        if (openTurnStateKnown && compactionEntryStateKnown && latestEndSeedSeq !== void 0) break;
    }
    return { openTurn, unmatchedCompactionStart, latestEndSeedSeq };
}
```

**判定逻辑**(从尾部向前扫描):
1. 找最后一个 `compaction/start` 或 `compaction/end`
2. 如果找到 `compaction/start` 且未遇到 `compaction/end` → `unmatchedCompactionStart` 有值 → compaction 未闭合
3. `latestEndSeedSeq` 用于区分"当前 lifecycle 的未闭合"和"seed 历史中的未闭合"

**`assertCompactionInactive`** — `index.js:504-507`:
```js
function assertCompactionInactive(unmatchedCompactionStart, latestEndSeedSeq, stage) {
    if (unmatchedCompactionStart === void 0 ||
        latestEndSeedSeq !== void 0 && latestEndSeedSeq > unmatchedCompactionStart.seq) return;
    throw new ManualCompactionError("busy", `${stage}: compaction already in progress; ...`);
}
```

**插件侧可实现的最简判定**(不需要依赖 compaction-basic 的内部函数):
```js
// 扫描 session.events 尾部
function hasOpenCompaction(events) {
    for (let i = events.length - 1; i >= 0; i--) {
        const event = events[i];
        if (event.type === 'compaction/start') return true;  // 未闭合
        if (event.type === 'compaction/end') return false;   // 已闭合
    }
    return false;  // 无 compaction 事件
}
```

**Session 对象上无现成的 `unmatchedCompactionStart` 字段** — Session 类(`index.js:1303-1564`)不暴露 compaction 状态。`inspectCompactionEntryState` 是 compaction-basic 的内部函数,插件侧需要自行实现等效的扫描逻辑。

### 对设计的影响
设计文档(§2.1 第 3 步)中"日志尾部是否有未闭合 compaction/start(无对应 end)"的判定逻辑**可实现**:
- 从 `session.events` 尾部向前扫描,找首个 `compaction/start` 或 `compaction/end`
- 如果找到 `compaction/start` → 拒绝跳转
- 简单可靠,约 10 行代码

**设计正确,无需修正。**

---

## 验证项 5: turn/end 判定(busy 守卫)

### 结论: **已验证 — 从事件流扫描 turn/start 和 turn/end 可判定空闲/运行中**

### 源码证据

**`inspectCompactionEntryState` 中已有 openTurn 检测** — `dsh-compaction-basic/lib/index.js:674-679`:
```js
if (!openTurnStateKnown) {
    if (event.type === "turn/start") {
        openTurn = event.data.turn;
        openTurnStateKnown = true;
    } else if (event.type === "turn/end")
        openTurnStateKnown = true;
}
```
从尾部向前扫描,找首个 `turn/start` 或 `turn/end`:
- 找到 `turn/start` → openTurn 有值 → 正在运行
- 找到 `turn/end` → openTurn 为 null → 空闲

**`_forkSeed` 中的等效检查** — `index.js:1869-1870`:
```js
const lastTurnBoundary = events.slice(0, boundary + 1).findLast(
    (event) => event.type === "turn/start" || event.type === "turn/end"
);
if (lastTurnBoundary?.type === "turn/start")
    throw new SessionForkError(`fork boundary ... ends inside open turn ...`);
```

**AgentLoop 的 phase 追踪** — `dsh-agent-loop/lib/index.js` 中:
```js
phase = { kind: "idle" | "running" | "maintenance", turn, step, ... }
```
但这在 AgentLoop 内部,动态插件无法直接访问。

**插件侧最简判定**:
```js
function isSessionBusy(session) {
    const events = session.events;
    for (let i = events.length - 1; i >= 0; i--) {
        const event = events[i];
        if (event.type === 'turn/start') return true;   // 有未闭合 turn
        if (event.type === 'turn/end') return false;    // 最后一个 turn 已结束
    }
    return false;  // 无 turn 事件(空会话)
}
```

### 对设计的影响
设计文档(§2.1 第 2 步)"若最近事件不是 turn/end(或存在未闭合 tool 运行),返回 `{ ok:false, reason:'busy' }`"的判定逻辑**可实现**:
- 扫描 `session.events` 尾部,找首个 `turn/start` 或 `turn/end`
- 找到 `turn/start` → busy → 拒绝跳转
- 简单可靠,约 10 行代码

**设计正确,无需修正。**

---

## 验证项 5(设计文档 §5 清单第 5 项): 实测 deriveMessages() 排除

### 结论: **已验证(静态) — 机制确认正确,仍需实测**

### 源码证据

**`deriveMessages` 的缓存机制** — `index.js:1539-1554`:
```js
deriveMessages() {
    const surface = this.surface;
    const nodes = surface.nodes;
    const generation = surface.replaceGeneration;
    if (generation !== this.derivedGeneration) {
        this.derived = [];           // replace 发生时清空重建
        this.derivedNodes = 0;
        this.derivedGeneration = generation;
    }
    for (const seq of nodes.slice(this.derivedNodes)) {
        const msg = this.deriveEventMessage(this.log[seq]);
        if (msg) this.derived.push(msg);
    }
    this.derivedNodes = nodes.length;
    return [...this.derived];
}
```

**replace 后的执行路径**:
1. `session.append('user/message', data, { surfaceOp: { op: 'replace', start, end }, sourceEventSeqs })` 执行
2. `SurfaceManager._processDelta()` → `applySurfacePlan()` → `state.nodes.splice(startIdx, endIdx - startIdx + 1, newSeq)` + `state.replaceGeneration += 1`
3. `session.eventsSnapshot = void 0` (触发事件快照失效)
4. 下一次 `session.deriveMessages()`:
   - `generation !== this.derivedGeneration` → true → `this.derived = []; this.derivedNodes = 0`
   - 遍历新的 `nodes`(已 splice 过,被遮蔽 seq 不在其中)
   - 仅投影新 nodes 中的事件 → 被遮蔽段**被排除**

**`deriveEventMessage` 对 replace 的 user/message** — `surface.js:84-86`:
```js
case 'user/message': return event.data;
```
replace 节点(摘要消息)正常投影为 LLM message。

### 对设计的影响
静态分析确认机制正确。但设计文档(§5 第 5 项)标记为"实测",这确实是**仍待实测**的项。建议实现后编写端到会话验证: append replace → 调用 deriveMessages → 确认被遮蔽段不在结果中。

---

## 逐项结论表

| # | 验证项 | 结论 | 源码位置 | 对设计的影响 |
|---|---|---|---|---|
| 1 | `surfaceOp.start/end` 语义 | ✅ **已验证** — start/end 是 event seq,非数组索引;`replacementRange` 通过 `nodes.indexOf()` 自动映射 | `surface.js:182-199`(`replacementRange`),`index.js:518-524`(`validateSurfaceRegion`) | 设计正确。从 `session.surface.nodes` 中取首尾节点 seq 即可。无需修正。 |
| 2 | 自定义 data 标记(`sgJump`) | ✅ **已验证** — ①JSONL 原样保留 ②`event.data` 含 sgJump ③无 schema 拒绝 | `index.js:1446-1447`(snapshotJsonValue),`surface.js:84-86`(deriveEventMessage),`index.js:1189-1213`(assertSessionEventEnvelope) | 设计正确。sgJump 附加在 data 上可安全实现。无需修正。 |
| 3 | 手动 replace 的 fold 行为 | ✅ **已验证** — ①无 compaction/start 也正常执行 ②sourceEventSeqs 缺失会抛错 ③shadowed 标记由 foldSurface 独立计算 | `surface.js:150-179`(assertProvenance),`surface.js:251-271`(planSurfaceEvent),`dsh-session-query/lib/index.js:374-389`(classifySurface) | 设计正确。手动 replace 可行,但 sourceEventSeqs 必须完整覆盖被遮蔽范围。设计已考虑。 |
| 4 | 并发检测(compaction 未闭合) | ✅ **已验证** — 从 events 尾部扫描首个 compaction/start 或 compaction/end 可判定 | `dsh-compaction-basic/lib/index.js:659-687`(inspectCompactionEntryState),`index.js:504-507`(assertCompactionInactive) | 设计正确。插件侧约 10 行代码可实现。无需修正。 |
| 5a | turn/end 判定(busy 守卫) | ✅ **已验证** — 从 events 尾部扫描首个 turn/start 或 turn/end 可判定 | `dsh-compaction-basic/lib/index.js:674-679`(openTurn 检测),`index.js:1869-1870`(_forkSeed 检查) | 设计正确。插件侧约 10 行代码可实现。无需修正。 |
| 5b | deriveMessages 排除(实测) | ✅ **已验证(静态)** / ⚠️ **仍待实测** — 机制正确:replace 触发 `replaceGeneration++` → deriveMessages 清空缓存 → 仅投影新 nodes | `index.js:1539-1554`(deriveMessages),`surface.js:279-286`(applySurfacePlan) | 设计正确。实现后需端到端实测确认。 |

---

## 补充发现

### B1 设计的可行路径(基于验证结果)

所有 5 个验证项均通过,设计文档中的技术路径**在平台能力范围内可实现**:

1. **跳转操作**:直接调用 `session.append('user/message', data, { surfaceOp: { op: 'replace', start, end }, sourceEventSeqs })` 即可,无需 compaction 事务
2. **数据标记**:`sgJump` 附加在 data 上可被投影插件读取
3. **并发安全**:busy 守卫和 compaction 互斥均可从事件流扫描实现
4. **遮蔽可见性**:`deriveMessages()` 自动排除被遮蔽段,`listEvents` 正确标记 shadowed

### 无需修正的设计点
- §2.1 第 2 步:busy 守卫实现方式正确
- §2.1 第 3 步:compaction 互斥检查实现方式正确
- §2.1 第 4 步:start/end 语义已验证正确
- §2.1 第 6 步:sgJump 标记方式正确
- §2.1 投影扩展:shadowed 标记由 foldSurface 自动生成

### 唯一需实测的项
- §5 清单第 5 项:"实测 `deriveMessages()` — append replace 后下一次 derive 确认被遮蔽段被排除"
  - 静态分析确认机制正确,但作为演示验收的关键路径,仍需编写端到端测试
