# SessionGraph 静态版插件包 — 红队对抗性审查报告

> 审查日期: 2025-07-16
> 审查对象: `package.json`、`lib/index.js` (Host)、`lib/client.js` (Client)
> 对照: 动态版 pkg-67、官方静态插件模板 (dsh-tool-web / dsh-goal / dsh-client-ui-sidebar / dsh-client-ui-trajectory)、迁移方案 A/B/C

---

## 一、问题清单

| # | 级别 | 位置 | 一句话描述 |
|---|------|------|-----------|
| 1 | **P1-回归** | `lib/index.js:269` | `sessiongraph.meta` 的 `view(state, session)` 第二参数永远 `undefined`，`toolInfo` 始终为空 `{}`，工具节点标签失去描述 |
| 2 | **P1-回归** | `lib/client.js:1022-1028` | `GraphViewMemo` 比较器引入 `metaSwitches`/`metaToolInfo`，但投影 view 每次返回新对象引用，比较器形同虚设，图谱在任何投影更新时全量重渲染 |
| 3 | **P2-风险** | `package.json:16` | `dsh.client.inject` 缺少 `@deepseek-ai/dsh-client-ui-slots`；sidebar 官方包声明了它，缺失可能导致 slots 服务在 client 物化时尚未就绪 |
| 4 | **P2-冗余** | `package.json:15` | `dsh.client.inject` 包含 `@deepseek-ai/dsh-client-ui-conversation`，Client 代码未使用任何 conversation API，属无用加载顺序依赖 |
| 5 | **P2-泄漏** | `lib/client.js:240-243` | `scrollToKey` 返回 `() => clearTimeout(t)` 但 `jumpNode` 丢弃返回值，闪光清理函数永不执行（1.7s 定时器泄漏） |
| 6 | **P3-风格** | `lib/client.js:66-73` | CSS `tagId` 用裸字符串 `'dsh-sessiongraph/client.css'` 而非官方 `'@scope/pkg/path'` 格式，与 `dsh-client-modules` 的 `claimStyles()` 命名约定不一致 |
| 7 | **P3-风格** | `lib/client.js:16` | `__ModuleLoader__.load` 的 `id` 用 `'dsh-sessiongraph'` 而非 scoped 包名，若未来有同名包会冲突 |

---

## 二、逐项详细分析

### 问题 1 — `sessiongraph.meta` view 永远拿不到 `session` 参数 (P1-回归)

**位置**: `lib/index.js:269-280`

```js
view: (state, session) => {
    let graph = null;
    if (session && session.projections) {
        graph = session.projections['sessiongraph.graph'];
    }
    return {
        switches: state.switches,
        toolInfo: toolInfoOf(graph),
    };
},
```

**根因**: `dsh-session-projection` 的投影注册契约中，`view` 函数签名是 `view(state) -> value`。源码 `dsh-session-projection/lib/types/index.js:116`：

```js
values[registration.def.key] = registration.def.schema.parse(registration.def.view(cell.state));
```

只传一个参数 `state`。`session` 永远是 `undefined`，因此 `graph` 永远是 `null`，`toolInfoOf(null)` 返回 `{}`。

**影响**: 所有工具节点的标签将显示原始 `n.meta.name`（如 `subagent`），不会显示人类可读的 description（如 "Delegate a self-contained task..."）。动态版通过 `host.call('sessiongraph.toolinfo')` RPC 正确获取。

**修复方向**: 将 `toolDescCache` 的内容直接存入 `sessiongraph.meta` 投影 state（apply 里每次事件时重算 toolInfo 并写入 state），view 直接返回 `state.toolInfo`，不再依赖跨投影访问。

---

### 问题 2 — GraphViewMemo 比较器无效 (P1-回归)

**位置**: `lib/client.js:1022-1028`

```js
const GraphViewMemo = React.memo(GraphView, (a, b) =>
    a.sessionId === b.sessionId &&
    a.base === b.base &&
    a.cursor === b.cursor &&
    a.metaSwitches === b.metaSwitches &&
    a.metaToolInfo === b.metaToolInfo
)
```

**根因**: `metaSwitches` 和 `metaToolInfo` 来自 `useProjection('sessiongraph.meta')` 的解构：

```js
const meta = useProjection('sessiongraph.meta')
const metaSwitches = meta && Array.isArray(meta.switches) ? meta.switches : []
const metaToolInfo = meta && typeof meta.toolInfo === 'object' ? meta.toolInfo : null
```

投影的 `view` 函数每次返回 `{ switches: state.switches, toolInfo: toolInfoOf(graph) }`，即使内容不变也是新对象引用。投影系统的 schema.parse (`(v) => v`) 透传，不做深比较。因此 `metaSwitches`（从 `meta.switches` 取出的数组引用）和 `metaToolInfo`（每次都是新对象）在任何投影更新时都可能变化，导致 memo 失效，GraphView 在每次投影更新时全量重渲染。

**影响**: 图谱在委派事件/tool 结果/任何会话事件时全量重渲染，性能退化。动态版通过 RPC 轮询（1s 间隔），不依赖投影推送，不存在此问题。

**修复方向**: 方案 A — 在投影 view 中对 switches/toolInfo 做引用稳定化（用 Object.is 缓存上一次输出）。方案 B — 在 GraphPanel 中用 `useMemo` 对 metaSwitches/metaToolInfo 做深比较后稳定化。方案 C — 去掉这两个属性的比较，回到动态版的简单三字段比较（但可能过度渲染）。

---

### 问题 3 — `dsh.client.inject` 缺少 `dsh-client-ui-slots` (P2-风险)

**位置**: `package.json:13-18`

```json
"inject": [
    "@deepseek-ai/dsh-client-runtime",
    "@deepseek-ai/dsh-client-ui-conversation",
    "@deepseek-ai/dsh-client-ui-layout"
]
```

**对照**: `dsh-client-ui-sidebar/package.json` 的 inject 包含 `@deepseek-ai/dsh-client-ui-slots`。Client 代码使用 `ctx.slots.inject()` 和 `ctx.slots.register()`，其中 `SlotRegistry.inject()` 内部可能依赖 `dsh-client-ui-slots` 提供的 `SlotCore`。

**影响**: 如果 `dsh-client-ui-slots` 未被其他依赖间接加载，slot 注册可能在 slots 服务未就绪时执行，导致静默失败或报错。

**建议**: 添加 `"@deepseek-ai/dsh-client-ui-slots"` 到 inject 列表。

---

### 问题 4 — `dsh-client-ui-conversation` 冗余 (P2-冗余)

**位置**: `package.json:15`

Client 代码未使用任何 conversation 相关 API（无 `ctx.conversationEvents`、无 `ctx.conversationViews` 等）。该依赖仅增加不必要的加载顺序开销。

**建议**: 移除。

---

### 问题 5 — `scrollToKey` 定时器泄漏 (P2-泄漏)

**位置**: `lib/client.js:231-243`

```js
const scrollToKey = (key) => {
    // ...
    const t = setTimeout(() => el.classList.remove('sg-jump-flash'), 1700)
    return () => clearTimeout(t)  // 返回清理函数
}
const jumpNode = (n, items) => scrollToKey(keyOfNode(n, items))  // 丢弃返回值
```

`scrollToKey` 返回清理函数但 `jumpNode` 不使用它。每次点击节点都会创建一个 1.7s 的 setTimeout，永远不被清理。频繁点击会累积多个未清理定时器。

**影响**: 轻微内存/性能泄漏。动态版使用 `ctx.get('timer').timeout()` 同样未捕获 dispose，属相同问题，非回归。

---

### 问题 6 — CSS tagId 命名不规范 (P3-风格)

**位置**: `lib/client.js:66-73`

```js
const tagId = 'dsh-sessiongraph/client.css';
```

官方模式使用 scoped 路径：`'@deepseek-ai/dsh-client-ui-sidebar/SidebarRoot.module.css'`。

**影响**: 不影响功能，但 `dsh-client-modules` 的 `claimStyles()` 可能使用 `data-plugin` 属性做归属追踪，裸字符串可能与归属逻辑不匹配。

---

### 问题 7 — Client factory id 非 scoped (P3-风格)

**位置**: `lib/client.js:16`

```js
id: 'dsh-sessiongraph',
```

官方使用 `'@deepseek-ai/dsh-client-ui-sidebar'` 等 scoped 名。id 用于 ModuleLoader 的 require 解析缓存。

**影响**: 不影响功能（单插件场景），但若有同名第三方包会冲突。

---

## 三、残留检查

| 检查项 | 结果 |
|--------|------|
| `harness.` 引用 | ✅ 仅注释 (index.js:8) |
| `sessiongraph.jump` | ✅ 零匹配 |
| `MIN_SHADOW` | ✅ 零匹配 |
| `checkBusy` | ✅ 零匹配 |
| `append-failed` | ✅ 零匹配 |
| `pendingJump` | ✅ 仅注释 (client.js:395) |
| `confirmJump` | ✅ 仅注释 (client.js:395) |
| `ACT_MSG_MS` | ✅ 仅注释 (client.js:395) |
| `host.call` | ✅ 仅注释 (client.js:10,77,396,437,1032) |
| `styles.insert` | ✅ 仅注释 (client.js:24) |
| `ctx.get('timer')` | ✅ 仅注释 (client.js:239,397) |

**结论**: jump 相关逻辑已彻底移除，仅注释中保留说明文字。✅

---

## 四、官方形态正确性对照

### Host (lib/index.js) vs 官方模板

| 检查项 | 官方 | 本包 | 结果 |
|--------|------|------|------|
| `export const name` | `dsh-tool-web`: `const name = "tool-web"` | `export const name = 'dsh-sessiongraph'` | ✅ 匹配 |
| `export const inject` | `dsh-tool-web`: `const inject = ["tools", "web", "systemPrompt"]` | `export const inject = ['sessionProjections', 'tools', 'sessions', 'agents']` | ✅ 匹配 |
| `export function apply(ctx)` | `dsh-tool-web`: `function apply(ctx, config)` | `export function apply(ctx)` | ✅ config 可选 |
| `ctx.inject` 模式 | `dsh-goal`: `ctx.inject(["sessionProjections"], (pctx) => {...})` | 同 | ✅ 匹配 |
| `defineTool` import | `dsh-tool-web`: `import { defineTool } from "@deepseek-ai/dsh-tools"` | 同 | ✅ 匹配 |
| `ctx.tools.register` | `dsh-tool-web`: `ctx.tools.register(defineTool({...}))` | `ctx.tools.register(tool)` | ✅ 匹配 |
| `ctx.on` 事件 | `dsh-subagent`: `ctx.on('subagent/start', ..., { global: true })` | 同 | ✅ 匹配 |

### Client (lib/client.js) vs 官方模板

| 检查项 | 官方 | 本包 | 结果 |
|--------|------|------|------|
| `__ModuleLoader__.load` | sidebar: `window.__ModuleLoader__.load({id, factory})` | 同 | ✅ 匹配 |
| factory 签名 | `factory: (require) => { ... return module.exports }` | 同 | ✅ 匹配 |
| module/exports 声明 | `var module = { exports: {} }; var exports = module.exports;` | 同 | ✅ 匹配 |
| Symbol.toStringTag | `Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" })` | 同 | ✅ 匹配 |
| React require | `let react = require("react")` | `const React = require('react')` | ✅ 等价 |
| CSS 注入 | `document.createElement("style")` + `data-plugin-css` 去重 | 同 | ✅ 匹配 |
| `exports.apply/exports.inject` | sidebar: `exports.apply = apply; exports.inject = inject;` | 同 | ✅ 匹配 |
| `return module.exports` | sidebar: `return module.exports;` | 同 | ✅ 匹配 |

---

## 五、安装链路检查

| 检查项 | 结果 |
|--------|------|
| `exports["./client"]` 指向 `./lib/client.js` | ✅ |
| `dsh.client.platform: "web"` | ✅ |
| Client 用 `__ModuleLoader__.load` 注册 | ✅ |
| `type: "module"` + ESM `import/export` in Host | ✅ |
| 无 `prepare` 脚本 → git 安装无需 pnpm allowBuilds | ✅ |
| `peerDependencies` 版本匹配部署 (cordis ^4.0.1, dsh-tools ^0.1.0-rc.6) | ✅ |
| 无 `dsh.bundle` 声明 → 非 bundle 类型，仅靠 cordis.patch.yml insert 行挂载 | ✅ |

---

## 六、回归差异 (vs 动态版 pkg-67)

| 功能 | 动态版 | 静态版 | 差异性质 |
|------|--------|--------|---------|
| jump 切枝 | ✅ RPC 触发 | ❌ 完全移除 | ✅ 预期(用户决定) |
| switches 数据 | RPC | 投影 sessiongraph.meta | ✅ 等价(但 view 有 P1 bug) |
| toolInfo 数据 | RPC | 投影 view 输出 | ❌ **P1 回归**: view 永远空 |
| 操作原子组 | ⇄/±/✕ 三键 | ±/✕ 两键 | ✅ 预期(jump 移除) |
| SlimOverlay 数据 | RPC 轮询 | _sharedGraphData 共享 | ✅ 等价 |
| 聊天跳转定位 | ✅ | ✅ | ✅ 保留 |
| 缩放/平移/拖拽 | ✅ | ✅ | ✅ 保留 |
| 轮次折叠 | ✅ | ✅ | ✅ 保留 |
| 遮蔽渲染 | ✅ | ✅ (只读兼容) | ✅ 保留 |
| debug 工具 | harness.defineTool | defineTool + ctx.tools.register | ✅ 等价 |

---

## 七、结论

**总体状态**: **需修改后方可发布** — 有 1 个功能回归(P1)需修复。

### 必须修的 Top 3

1. **P1 #1: `sessiongraph.meta` view 的 `toolInfo` 永远为空**
   - 原因: 投影 view 函数签名 `(state, session)` 中 `session` 参数不被框架传递
   - 修复: 将 toolInfo 计算从 view 移到 apply（每次事件时将 toolDescCache 内容写入 state），view 直接返回 `state.toolInfo`

2. **P1 #2: GraphViewMemo 比较器因投影引用不稳定而失效**
   - 原因: 投影 view 每次返回新对象，导致 metaSwitches/metaToolInfo 每次变化
   - 修复: 在投影 view 中做引用稳定化，或在 GraphPanel 中用 useMemo 做浅比较

3. **P2 #3: `dsh.client.inject` 缺少 `dsh-client-ui-slots`**
   - 原因: 官方 sidebar 声明了此依赖，SessionGraph 也使用 slots 服务
   - 修复: 在 `dsh.client.inject` 数组中添加 `"@deepseek-ai/dsh-client-ui-slots"`
