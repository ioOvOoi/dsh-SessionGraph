# 官方静态 Cordis 插件 Client 半体写法研究报告

> 基于部署源码 `C:\Users\Administrator\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\` 下的 `dsh-client-ui-trajectory`、`dsh-client-ui-sidebar`、`dsh-client-ui-layout`、`dsh-client-ui-slots`、`dsh-client-runtime`、`dsh-client-modules`、`dsh-client-connection` 进行的只读研究。

---

## 1. 入口形态

### 1.1 `lib/client.js` 结构

所有官方带 Client 的插件包的 `lib/client.js` 均遵循以下模式：

```js
window.__ModuleLoader__.load({
  id: "@deepseek-ai/dsh-client-ui-xxx",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    // require 依赖
    let react = require("react");
    let react_jsx_runtime = require("react/jsx-runtime");
    let runtime = require("@deepseek-ai/dsh-client-runtime/client");
    // ...

    // 业务代码 ...

    // 导出
    exports.apply = apply;     // Cordis plugin apply 函数
    exports.inject = inject;   // 依赖的 cordis service 名数组
    return module.exports;
  }
});
```

**关键点**：
- 不是 `export default`，而是通过 `window.__ModuleLoader__.load({id, factory})` 注册工厂
- 工厂接收 `require` 函数（CJS 风格的同步 require），返回 `module.exports` 对象
- `exports.apply` 是 Cordis plugin 的 `apply(ctx)` 函数
- `exports.inject` 是该插件依赖的 cordis service 名字符串数组（等价于 cordis `inject: [...]` 声明）

**源码位置**：
- `dsh-client-ui-trajectory/lib/client.js` 第 1-6 行（注册）+ 第 7364-7365 行（导出）
- `dsh-client-ui-sidebar/lib/client.js` 第 1-6 行 + 第 286-287 行
- `dsh-client-ui-layout/lib/client.js` 第 1-6 行 + 第 449-452 行

### 1.2 `package.json` 的 `dsh.client` 元数据

```json
{
  "dsh": {
    "client": {
      "inject": [
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-client-ui-layout",
        "@deepseek-ai/dsh-client-locale"
      ],
      "platform": "web"
    }
  }
}
```

**字段含义**：
- **`inject`**: 声明该 Client 插件加载前必须先加载的其他 Client 包。这是 **加载顺序依赖**（不是 cordis service 注入）。`dsh-client-modules` 的 boot manifest 用它决定加载拓扑。
- **`platform`**: 目前仅发现 `"web"` 值。表示该 Client 在浏览器 Web 平台运行。

**源码位置**：
- `dsh-client-ui-trajectory/package.json` 第 32-41 行
- `dsh-client-ui-sidebar/package.json` 第 32-40 行
- `dsh-client-ui-layout/package.json` 第 32-39 行

### 1.3 加载机制

`dsh-client-modules` 的 `ClientModuleSystem` 类负责加载：
1. 解析 `window.__DSH_BOOT__` 得到 boot manifest（模块 id + url + inject 依赖 + immediately 标志）
2. 按依赖拓扑用 `<script>` 加载 bundle URL
3. 每个 bundle 执行时调用 `window.__ModuleLoader__.load({id, factory})` 注册工厂
4. 首次 `require(id)` 时同步物化（factory(require) → exports），结果缓存在 `loadCache`

**源码位置**：`dsh-client-modules/lib/client.js` 第 47-168 行

---

## 2. 插槽注册

### 2.1 官方静态插件的插槽注册

**方式一：声明新 slot + 注册组件（如 sidebar、layout）**

```js
// sidebar/lib/client.js 第 265-283 行
ctx.effect(() => ctx.slots.register({
  name: "sidebar",
  locale: NS,
  children: {
    "sidebar.workspaces": { kind: "single", scope: "root" },
    "sidebar.settings": { kind: "single", scope: "root" },
    "sidebar.footer.action": { kind: "list", scope: "root" }
  },
  inject: injectProps
}, SidebarRoot), "ui-sidebar: slot registration");
```

```js
// layout/lib/client.js 第 405-430 行
ctx.effect(() => {
  const disposeRegistration = ctx.slots.register({
    name: "root",
    children: {
      "sidebar": { kind: "single", scope: "root" },
      "conversation": { kind: "single", scope: "session-maybe" },
      "details": { kind: "single", scope: "session" },
      "shell.overlay": { kind: "list", scope: "root" }
    },
    store: createLayoutStore,
    inject: (actions) => { layout.attachPanels(actions); return {}; }
  }, AppFrame);
  return disposeRegistration;
}, "ui-layout: service + root registration");
```

**方式二：向已声明的 slot 注入（如 trajectory）**

```js
// trajectory/lib/client.js 第 7340-7361 行
ctx.slots.inject("conversation.view", () => ctx.slots.register({
  name: "conversation.view",
  id: "trajectory",
  order: 10,
  locale: NS,
  label: () => t("view.trajectory"),
  inject: (sessionId) => { /* ... */ return { hooks, loadOlder, setActualDuration }; }
}, TrajectoryView));
```

**源码位置**：
- `SlotRegistry.inject()` 方法：`dsh-client-runtime/lib/client.js` 第 55-114 行
- `SlotRegistry.register` 原型方法：`dsh-client-runtime/lib/client.js` 第 331-334 行
- `SlotCore.register()`：`dsh-client-ui-slots/lib/index.js` 第 64-143 行
- 类型定义：`dsh-client-runtime/lib/types/client/slots.d.ts` 第 74-90 行

### 2.2 与动态等价的静态代码

**动态写法（pkg-67）**：
```js
slots.inject('details', () => slots.register(
  { name: 'details', id: 'sessiongraph-details', order: 10, label: () => '会话图谱' },
  GraphPanel,
))
```

**静态等价**：
```js
ctx.slots.inject('details', () => ctx.slots.register(
  { name: 'details', id: 'sessiongraph-details', order: 10, label: () => '会话图谱' },
  GraphPanel,
))
```

差异：动态中 `slots` 来自 `ctx.get('slots')`，静态中直接用 `ctx.slots`（cordis service 代理属性）。

---

## 3. React 来源

### 3.1 静态 Client 中 React 的获取方式

```js
// trajectory/lib/client.js 第 30-32 行
let react = require("react");
react = __toESM(react, 1);  // ESM 化（default export 包装）

// 第 30 行
let react_jsx_runtime = require("react/jsx-runtime");
```

**关键点**：
- React 通过 `require("react")` 从模块系统获取（peer dependency）
- JSX 通过 `require("react/jsx-runtime")` 获取
- 编译后的代码使用 `react_jsx_runtime.jsx()` / `react_jsx_runtime.jsxs()` 而非 `React.createElement`
- React 的 hooks（`useState`, `useEffect`, `useRef` 等）通过 `react.useState` 等调用

**源码位置**：`dsh-client-ui-trajectory/lib/client.js` 第 30-32 行；`dsh-client-ui-sidebar/lib/client.js` 第 7-8 行

### 3.2 等价关系

| 动态 | 静态 |
|------|------|
| `React.createElement(...)` (全局) | `react_jsx_runtime.jsx(...)` 或 `react.createElement(...)` |
| `React.useState(...)` | `react.useState(...)` |
| `React.useEffect(...)` | `react.useEffect(...)` |

静态中不直接 import React，而是通过 `require()` 从模块系统获取。

---

## 4. useProjection / useSessions

### 4.1 来源与签名

这两个都是 **slot owner props**，由框架在渲染 slot 组件时注入，不是从某个包 import 的。

**`useProjection`**：
```ts
// dsh-client-runtime/lib/types/client/sessions/projection-store.ts (通过 index.d.ts 第 52 行导出)
// dsh-client-runtime/lib/types/client/index.d.ts 第 74-75 行
interface SessionStandardProps {
  useProjection: UseProjection;  // key-addressed projection reader
}
```

**`useSessions`**：
```ts
// dsh-client-runtime/lib/types/client/index.d.ts 第 86-88 行
interface GlobalStandardProps {
  useSessions: SnapshotSelectorHook<SessionListState>;
}
```

**源码位置**：
- `dsh-client-runtime/lib/types/client/index.d.ts` 第 64-91 行（declaration merging）
- `dsh-client-runtime/lib/types/client/sessions/projection-store.ts`（UseProjection 类型）

### 4.2 插槽 owner props 机制在静态下完全相同

静态和动态下，slot 组件的 props 来源一致：
- **session-scoped slot**（如 `details`）：接收 `{ sessionId, useSession, useProjection, ...ownerProps, ...injectProps }`
- **root-scoped slot**（如 `shell.overlay`）：接收 `{ useSessions, useWorkspaces, ...ownerProps }`

**静态等价**：
```js
// GraphPanel 收到 { sessionId, useProjection } — 与动态完全一致
const GraphPanel = ({ sessionId, useProjection }) => {
  const graph = useProjection('sessiongraph.graph')
  // ...
}

// SlimOverlay 收到 { useSessions } — 与动态完全一致
const SlimOverlay = ({ useSessions }) => {
  const current = useSessions((s) => s?.current)
  // ...
}
```

**无需改动**：组件 props 签名在静态和动态下完全相同。

---

## 5. styles.insert 静态等价

### 5.1 官方静态插件的 CSS 注入方式

官方插件 **没有** `styles.insert` 服务。CSS 通过以下方式注入：

**方式：模块级 CSS 字符串 + `<style>` 标签注入**

```js
// sidebar/lib/client.js 第 25-57 行
const css = ".hHd-Xa_root{...}";
const tagId = "@deepseek-ai/dsh-client-ui-sidebar/SidebarRoot.module.css";
if (typeof document !== "undefined" &&
    document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
  const tag = document.createElement("style");
  tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-sidebar";
  tag.dataset.pluginCss = tagId;
  tag.textContent = css;
  document.head.appendChild(tag);
}
var SidebarRoot_module_css_default = { "root": "hHd-Xa_root", ... };
```

**关键点**：
- CSS 通过 build 工具（`tsdown` + `\0dsh-css:` plugin）编译为字符串常量
- 在 factory 物化时（不是 script 加载时）通过 `document.createElement('style')` 注入
- 通过 `data-plugin-css` 属性标记，避免重复注入
- `dsh-client-modules` 的 `claimStyles()` 函数追踪每个插件拥有的 `<style>` 标签

**源码位置**：
- `dsh-client-ui-sidebar/lib/client.js` 第 25-57 行
- `dsh-client-ui-layout/lib/client.js` 第 55-72 行
- `dsh-client-ui-trajectory/lib/client.js` 第 2993-3150 行（多个 CSS 模块）
- `dsh-client-modules/lib/client.js` 第 34-40 行（`claimStyles`）

### 5.2 动态到静态的 CSS 迁移

**动态写法（pkg-67）**：
```js
styles.insert(`
  .sg-root{display:flex;...}
  .sg-header{...}
`)
```

**静态等价**：
```js
const css = `.sg-root{display:flex;...}.sg-header{...}`;
const tagId = "@deepseek-ai/dsh-client-ui-sessiongraph/client.css";
if (typeof document !== "undefined" &&
    document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
  const tag = document.createElement("style");
  tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-sessiongraph";
  tag.dataset.pluginCss = tagId;
  tag.textContent = css;
  document.head.appendChild(tag);
}
```

**差异**：
- 动态：`styles.insert(cssString)` — 沙箱提供的全局 API
- 静态：`document.createElement('style')` + 手动插入 — 需要自行管理去重

---

## 6. host.call 静态等价

### 6.1 动态 sandbox 的 `host.call`

在动态插件沙箱中，`host.call(method, args)` 是沙箱提供的 RPC 代理，将调用转发到 Host 进程。

```js
// pkg-67 中的用法
host.call('sessiongraph.get', { sessionId: String(current) })
host.call('sessiongraph.switches', { sessionId: String(sessionId) })
host.call('sessiongraph.jump', { sessionId: String(sessionId), anchorSeq: anc })
```

### 6.2 静态世界的 RPC 机制

静态 Client 通过 `ctx.connection` 获取连接句柄，包含两个 RPC 面：

**1. `api`（命名空间方法）**：`api.sessions.*`, `api.host.*`, `api.workspace.*`, `api.subagents.*`
- 用于框架内置的 RPC 调用

**2. `rpc`（通用 RPC 调用器）**：`rpc.call(channel, endpoint, payload)`
- 用于自定义插件 RPC

```js
// dsh-client-connection/lib/client.js 第 10093-10113 行
function createWebConnectionRpc() {
  return { async call(channel, endpoint, payload, signal) {
    // POST 到 channel/endpoint，发送 JSON payload
  } };
}
```

**源码位置**：
- `dsh-client-connection/lib/client.js` 第 10085-10122 行
- 连接句柄提供：`dsh-client-connection/lib/client.js` 第 10148-10201 行（`ctx.provide("connection", handle)`）

### 6.3 动态到静态的 host.call 迁移

**动态写法**：
```js
host.call('sessiongraph.get', { sessionId: String(current) })
```

**静态等价**：
```js
const connection = ctx.get('connection')
// 通用 RPC 调用
connection.rpc.call('/api', 'sessiongraph/get', { args: { sessionId: String(current) } })
```

或者，如果插件在 Host 侧注册了命名空间 API，可以通过 `api` 对象调用。但 `sessiongraph.*` 是自定义 RPC，所以需要用 `rpc.call`。

**注意**：具体 endpoint 名称取决于 Host 侧注册的 RPC 路由。需要确认 `sessiongraph.get` 对应的 channel 和 endpoint。

---

## 7. timer 服务

### 7.1 动态中的 `ctx.get('timer')`

在动态沙箱中，`timer` 是一个服务，提供：
- `timer.timeout(fn, ms)` → 返回 dispose 函数
- `timer.interval(fn, ms)` → 返回 dispose 函数

### 7.2 静态世界的 timer

**`timer` 服务在静态 Client runtime 中不存在。** 搜索 `dsh-client-runtime/lib/client.js` 仅发现 `setTimeout`/`clearTimeout` 的直接使用，没有 `timer` 服务的 `provide`。

**静态等价**：直接使用浏览器原生定时器

```js
// 动态
const timer = ctx.get('timer')
timer.timeout(() => { /* ... */ }, 1700)

// 静态等价
const id = setTimeout(() => { /* ... */ }, 1700)
// 清理：clearTimeout(id)
```

```js
// 动态
const timer = ctx.get('timer')
const dispose = timer.interval(check, 400)
return () => { dispose() }

// 静态等价
const id = setInterval(check, 400)
return () => { clearInterval(id) }
```

**差异**：
- 动态：`timer.timeout()` 返回 dispose 函数
- 静态：`setTimeout()` 返回 timer id，需 `clearTimeout(id)` 清理
- 静态中需确保在 React effect cleanup 中正确清理定时器

---

## 8. 差异清单

| 全局名/能力 | 动态用法 | 静态等价 | 需改动点 |
|-------------|---------|---------|---------|
| **React** | `React.createElement(...)`, `React.useState(...)` 等（全局） | `require("react")` → `react.createElement(...)`, `react.useState(...)` 等 | 将所有 `React.xxx` 改为 `react.xxx`；JSX 改用 `react_jsx_runtime.jsx()` |
| **styles.insert** | `styles.insert(cssString)` | `document.createElement('style')` + `document.head.appendChild(tag)` | 重写 CSS 注入为模块级 `<style>` 标签模式 |
| **host.call** | `host.call('method', args)` | `ctx.get('connection').rpc.call('/api', 'method', { args })` | 重写所有 RPC 调用为 connection.rpc.call |
| **ctx.get('timer')** | `timer.timeout(fn, ms)` → dispose | `setTimeout(fn, ms)` → id + `clearTimeout(id)` | 替换为原生定时器，注意 cleanup |
| **ctx.get('layout')** | `layout.openDetails()`, `layout.closeDetails()` | `ctx.layout.openDetails()`, `ctx.layout.closeDetails()` | `ctx.get('layout')` → `ctx.layout` |
| **ctx.get('slots')** | `slots.inject(...)` , `slots.register(...)` | `ctx.slots.inject(...)`, `ctx.slots.register(...)` | `ctx.get('slots')` → `ctx.slots` |
| **React (JSX)** | 全局 JSX 转换 | `require("react/jsx-runtime")` | 编译输出已自动处理 |
| **useProjection** | slot owner props 传入 | 完全相同（slot owner props） | 无需改动 |
| **useSessions** | slot owner props 传入 | 完全相同（slot owner props） | 无需改动 |
| **sessionId** | slot owner props 传入 | 完全相同（slot owner props） | 无需改动 |
| **ctx.effect()** | 不直接使用（沙箱管理） | `ctx.effect(fn, label)` 管理生命周期 | slot 注册需包裹在 `ctx.effect()` 中 |
| **ctx.on()** | 不直接使用 | `ctx.on(event, handler)` 订阅事件 | 如需监听事件需改用此 API |
| **document/ResizeObserver** | 浏览器全局 | 浏览器全局 | 无需改动 |
| **requestAnimationFrame** | 浏览器全局 | 浏览器全局 | 无需改动 |

---

## 9. pkg-67 Client 代码适配点清单

以下逐行列出 pkg-67 Client 代码中需要改动的行级映射：

### 9.1 文件入口结构

**当前**（动态插件格式）：
```js
return {
  apply(ctx) {
    const slots = ctx.get('slots')
    // ...
  },
}
```

**目标**（静态插件格式）：
```js
window.__ModuleLoader__.load({
  id: "@deepseek-ai/dsh-client-ui-sessiongraph",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react = require("react");
    let react_jsx_runtime = require("react/jsx-runtime");
    // ... 业务代码 ...
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
```

### 9.2 逐行改动清单

| 行范围 | 当前代码 | 改动类型 | 目标代码 |
|--------|---------|---------|---------|
| 1-2 | `return { apply(ctx) {` | **重写入口** | `window.__ModuleLoader__.load({ id: "...", factory: (require) => { ... } })` |
| 3-4 | `const slots = ctx.get('slots')` + `if (slots === undefined) return` | **改 service 访问** | `const inject = ["slots", "connection"]; function apply(ctx) {` （去掉 undefined 守卫，静态下 service 必定存在） |
| 6-46 | `styles.insert(\`...\`)` | **重写 CSS 注入** | 改为模块级 `const css = \`...\`` + `document.createElement('style')` 模式 |
| 203 | `const timer = ctx.get('timer')` | **改 timer** | `setTimeout` / `clearTimeout` 原生调用 |
| 418-424 | `host.call('sessiongraph.switches', ...)` | **改 RPC** | `ctx.get('connection').rpc.call('/api', 'sessiongraph/switches', { args: { sessionId } })` |
| 421-423 | `host.call('sessiongraph.toolinfo', ...)` | **改 RPC** | 同上，endpoint `sessiongraph/toolinfo` |
| 555-558 | `const timer = ctx.get('timer'); timer.timeout(fire, POLL.RESIZE_MS)` | **改 timer** | `const timerId = setTimeout(fire, POLL.RESIZE_MS)` |
| 626-641 | `ctx.get('timer')` + `timer.timeout(...)` for ACT_TIMEOUT_MS | **改 timer** | `setTimeout` / `clearTimeout` |
| 685 | `host.call('sessiongraph.jump', ...)` | **改 RPC** | `connection.rpc.call('/api', 'sessiongraph/jump', { args: { sessionId, anchorSeq } })` |
| 695-696 | `timer.timeout(...)` for ACT_MSG_MS | **改 timer** | `setTimeout` / `clearTimeout` |
| 702-704 | `timer.timeout(...)` for jump failure msg | **改 timer** | `setTimeout` / `clearTimeout` |
| 1110 | `const SlimOverlay = ({ useSessions }) =>` | **无需改动** | props 签名不变 |
| 1122-1124 | `const timer = ctx.get('timer'); timer.interval(check, POLL.COLLAPSED_MS)` | **改 timer** | `const id = setInterval(check, POLL.COLLAPSED_MS)` + cleanup |
| 1132 | `host.call('sessiongraph.get', ...)` | **改 RPC** | `connection.rpc.call('/api', 'sessiongraph/get', { args: { sessionId } })` |
| 1137-1138 | `timer.interval(fetchData, POLL.DATA_MS)` | **改 timer** | `setInterval(fetchData, POLL.DATA_MS)` + cleanup |
| 1149 | `const l = ctx.get('layout')` | **改 service 访问** | `const l = ctx.layout` |
| 1175 | `const GraphPanel = ({ sessionId, useProjection }) =>` | **无需改动** | props 签名不变 |
| 1182-1183 | `const l = ctx.get('layout')` | **改 service 访问** | `const l = ctx.layout` |
| 1191-1192 | `const l = ctx.get('layout')` | **改 service 访问** | `const l = ctx.layout` |
| 1198-1205 | `slots.inject('details', ...)` / `slots.inject('shell.overlay', ...)` | **改 service 访问** | `ctx.slots.inject('details', () => ctx.slots.register(..., GraphPanel))` |
| 全局 | `React.createElement(...)` | **改 React 访问** | `react.createElement(...)` 或编译后自动用 `react_jsx_runtime.jsx(...)` |
| 全局 | `React.useState(...)` 等 hooks | **改 React 访问** | `react.useState(...)` 等 |

### 9.3 新增 `inject` 声明

静态插件需要在文件末尾导出 `inject` 数组，声明 cordis service 依赖：

```js
const inject = ["slots", "connection"];
// 如果还用到 ctx.layout：
const inject = ["slots", "connection", "layout"];
```

**注意**：`layout` 是 ui-layout 通过 `ctx.reflect.provide("layout", layout)` 提供的 service，静态插件通过 `inject` 声明依赖后可直接用 `ctx.layout`。

### 9.4 新增 package.json

```json
{
  "name": "@deepseek-ai/dsh-client-ui-sessiongraph",
  "version": "0.1.0",
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": { "default": "./lib/index.js" },
    "./client": { "default": "./lib/client.js" }
  },
  "dsh": {
    "client": {
      "inject": [
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-client-ui-layout",
        "@deepseek-ai/dsh-client-ui-slots"
      ],
      "platform": "web"
    }
  },
  "peerDependencies": {
    "react": "^18.2.0",
    "@deepseek-ai/dsh-client-runtime": "^0.1.0-rc.6",
    "@deepseek-ai/dsh-client-ui-slots": "^0.1.0-rc.6",
    "@deepseek-ai/cordis": "^4.0.1"
  }
}
```

---

## 10. 关键源码位置索引

| 文件 | 关键内容 |
|------|---------|
| `dsh-client-ui-layout/lib/client.js:401-447` | `apply(ctx)` — 声明 root slot + 提供 layout service |
| `dsh-client-ui-layout/lib/client.js:313-341` | `LayoutController` class — `toggleSidebar()`, `openDetails()`, `closeDetails()` |
| `dsh-client-ui-sidebar/lib/client.js:252-284` | `apply(ctx)` — 注册 sidebar slot + children |
| `dsh-client-ui-trajectory/lib/client.js:7327-7361` | `apply(ctx)` — inject conversation.view + 注册 trajectory |
| `dsh-client-ui-slots/lib/index.js:64-143` | `SlotCore.register()` — 注册核心逻辑 |
| `dsh-client-runtime/lib/client.js:55-114` | `SlotRegistry.inject()` — 声明依赖注入 |
| `dsh-client-runtime/lib/client.js:331-334` | `SlotRegistry.prototype.register` — ctx.effect 包裹 |
| `dsh-client-runtime/lib/types/client/index.d.ts:64-91` | SlotMap declaration merging — useProjection/useSessions 类型 |
| `dsh-client-runtime/lib/types/client/slots.d.ts` | SlotRegistry 完整类型 |
| `dsh-client-modules/lib/client.js:47-168` | ClientModuleSystem — 加载/物化/缓存 |
| `dsh-client-connection/lib/client.js:10085-10122` | `createWebConnectionRpc()` — 通用 RPC 调用器 |
| `dsh-client-connection/lib/client.js:10148-10201` | `apply(ctx)` — 提供 `ctx.connection` |
