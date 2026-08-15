# 官方静态 Cordis 插件 Host 半体写法研究报告

## 研究目标
研究官方静态 Cordis 插件的 Host 半体写法，为 SessionGraph 动态插件(pkg-67)移植成官方静态插件包提供精确依据。

## 研究范围
- 部署目录：`C:\Users\Administrator\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\`
- 用户级副本：`C:\Users\Administrator\.dsh\profiles\node_modules\@deepseek-ai\`
- 研究对象：官方静态插件包(Host 逻辑部分)

---

## 1. 静态插件入口形态

### 1.1 package.json 结构
官方静态插件包的 `package.json` 具有统一结构：

```json
{
  "name": "@deepseek-ai/dsh-tool-web",
  "description": "Model-facing web tools over the DeepSeek Harness web capability seam",
  "version": "0.1.0-rc.6",
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": {
      "types": "./lib/types/index.d.ts",
      "default": "./lib/index.js"
    }
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.1",
    // ... 其他依赖
  }
}
```

**关键特征**：
- `type: "module"` — 使用 ESM 模块系统
- `main: "lib/index.js"` — 入口文件
- `exports` — 标准 ES 模块导出

### 1.2 lib/index.js 导出形态

#### 形态 A：导出函数式插件（如 `dsh-tool-web`）
```javascript
// lib/index.js
const name = "tool-web";
const inject = ["tools", "web", "systemPrompt"];

function apply(ctx, config) {
  // 插件逻辑
}

export { Config, apply, inject, name };
```

#### 形态 B：导出对象式插件（如 `dsh-command-compact`）
```javascript
// lib/index.js
const name = "command-compact";
const inject = ["commands", "compaction"];

function apply(ctx) {
  // 插件逻辑
}

export { apply, inject, name };
```

#### 形态 C：导出类服务（如 `dsh-jobs-local`）
```javascript
// lib/index.js
import { Service } from "@deepseek-ai/cordis";

class LocalJobRegistry extends Service {
  constructor(ctx, config) {
    super(ctx, "jobs");
    // 服务逻辑
  }
}

export { LocalJobRegistry, LocalJobRegistry as default };
```

### 1.3 官方插件定义模式

所有官方静态插件都遵循 **Cordis 插件定义模式**：

```javascript
// 标准静态插件结构
const name = "plugin-name";
const inject = ["service1", "service2"];

function apply(ctx, config) {
  // 插件实现
}

export { name, inject, apply };
```

**关键差异**：
- **静态插件**：`apply(ctx, config)` 直接接收 Cordis 上下文
- **动态插件**：通过沙箱包装，`apply(sandboxCtx, config)` 接收受限上下文

---

## 2. harness 的静态等价

### 2.1 harness 服务定义

`dsh-cordis-host-runner` 中定义的 `harness` 服务：

```javascript
// dsh-cordis-host-runner/lib/index.js
const sandbox = {
  harness: {
    defineTool: sandboxDefineTool,
    registerTool: sandboxRegisterTool,
    handle: (method, fn) => { /* ... */ }  // 通过 harnessExtras 注入
  }
};
```

### 2.2 静态插件中的 Client→Host RPC

**静态插件没有 `harness.handle`**。官方静态插件使用以下方式暴露 RPC：

#### 方式 A：通过 `ctx.provide` 注册服务
```javascript
// 静态插件注册服务
function apply(ctx) {
  ctx.provide('sessiongraphService', {
    async getSessionGraph(args) {
      // RPC 逻辑
    }
  });
}
```

#### 方式 B：通过 Typert 协议（推荐）
```javascript
// dsh-cordis-host-runner 中的 Remote 服务
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";

class DynamicCordisRunnerService extends TypertRemoteService {
  static inject = ["tools"];
  
  // 使用 Remote 装饰器暴露方法
  @Remote("invoke")
  async invoke(pluginId, pluginRunId, method, args) {
    // RPC 逻辑
  }
}
```

#### 方式 C：通过事件总线
```javascript
// 静态插件监听事件
ctx.on('sessiongraph/rpc', async (args) => {
  // 处理 RPC 请求
  return result;
});
```

### 2.3 关键结论

**`harness.handle` 是动态插件特有的沙箱机制**，静态插件不使用它。静态插件的等价方案：

1. **注册为 Cordis 服务**（推荐）
2. **使用 Typert 协议暴露远程方法**
3. **通过事件总线通信**

---

## 3. defineTool 的静态等价

### 3.1 动态插件中的 harness.defineTool

```javascript
// 动态插件中使用
const tool = harness.defineTool({
  name: 'sessiongraph_debug',
  description: '...',
  parameters: {},
  output: {
    schema: { type: 'object', additionalProperties: true },
    render: (args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  },
  async execute(args, exec) {
    // 工具逻辑
  },
});
ctx.effect(() => harness.registerTool(ctx, tool));
```

### 3.2 静态插件中的 defineTool

**静态插件直接使用 `@deepseek-ai/dsh-tools` 包的 `defineTool`**：

```javascript
// 静态插件中使用
import { defineTool } from "@deepseek-ai/dsh-tools";

function apply(ctx, config) {
  const tool = defineTool({
    name: 'sessiongraph_debug',
    description: '...',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      // 工具逻辑
    },
  });
  
  // 直接注册到 ctx.tools
  ctx.tools.register(tool);
}
```

### 3.3 关键差异

| 特性 | 动态插件 | 静态插件 |
|------|----------|----------|
| 定义工具 | `harness.defineTool()` | `defineTool()` from `@deepseek-ai/dsh-tools` |
| 注册工具 | `harness.registerTool(ctx, tool)` | `ctx.tools.register(tool)` |
| 参数验证 | 沙箱边界验证 | 直接调用 |
| 输出克隆 | `cloneJson()` 克隆输出 | 直接返回 |

### 3.4 官方静态插件示例

```javascript
// dsh-tool-web/lib/index.js
import { defineTool } from "@deepseek-ai/dsh-tools";

function applyWebSearchTool(ctx, maxResults, timeoutMs, fetchEnabled) {
  ctx.tools.register(defineTool({
    name: "web_search",
    description: "Search the web for current information.",
    parameters: { query: { type: "string", required: true, description: "The search query." } },
    output: {
      schema: { /* ... */ },
      render: (args, value) => [{ type: "text", text: formatSearchOutput(value) }],
      presentationMeta: (args, value) => searchMetaFromValue(value)
    },
    timeoutMs,
    async execute(args, exec) {
      // 工具逻辑
    }
  }));
}
```

---

## 4. 投影注册

### 4.1 动态插件中的投影注册

```javascript
// 动态插件中使用
const sp = ctx.get('sessionProjections');
if (sp === undefined) return;

sp.register({
  key: 'sessiongraph.graph',
  schema: { parse: (value) => value },
  stateVersion: 6,
  init: () => ({ nodes: [], cursor: null, currentTurn: null }),
  apply: (state, event) => { /* ... */ },
  view: (state) => ({ nodes: state.nodes, cursor: state.cursor }),
});
```

### 4.2 静态插件中的投影注册

**静态插件使用完全相同的 API**，但通过依赖注入获取服务：

```javascript
// 静态插件中使用
function apply(ctx) {
  // 方式 A：直接注入（推荐）
  ctx.inject(["sessionProjections"], (projectionCtx) => {
    projectionCtx.sessionProjections.register({
      key: 'sessiongraph.graph',
      schema: sessionGraphSchema,
      stateVersion: 6,
      init: () => ({ nodes: [], cursor: null, currentTurn: null }),
      apply: applySessionGraphProjection,
      view: (state) => ({ nodes: state.nodes, cursor: state.cursor }),
    });
  });
  
  // 方式 B：运行时检查（如动态插件）
  const sp = ctx.get('sessionProjections');
  if (sp === undefined) return;
  // ...
}
```

### 4.3 官方静态插件示例

```javascript
// dsh-goal/lib/index.js
function apply(ctx) {
  ctx.inject(["sessionProjections"], (projectionCtx) => {
    projectionCtx.sessionProjections.register({
      key: "goal",
      schema: goalProjectionSchema,
      init: () => null,
      apply: applyGoalProjection,
      view: (state) => state,
      stateVersion: 4
    });
  });
}
```

### 4.4 关键结论

**投影注册 API 完全相同**，静态插件可以：
1. 使用 `ctx.inject(["sessionProjections"], ...)` 声明依赖
2. 使用 `projectionCtx.sessionProjections.register(...)` 注册投影
3. 与动态插件保持完全兼容

---

## 5. 事件监听

### 5.1 动态插件中的事件监听

```javascript
// 动态插件中使用
ctx.on('subagent/start', (info) => {
  // 处理 subagent 启动事件
});

ctx.on('subagent/end', (info) => {
  // 处理 subagent 结束事件
});
```

### 5.2 静态插件中的事件监听

**静态插件使用完全相同的事件监听 API**：

```javascript
// 静态插件中使用
function apply(ctx) {
  ctx.on('subagent/start', (info) => {
    // 处理 subagent 启动事件
  }, { global: true });  // 可选：全局事件
  
  ctx.on('subagent/end', (info) => {
    // 处理 subagent 结束事件
  }, { global: true });
}
```

### 5.3 官方静态插件示例

```javascript
// dsh-subagent/lib/types/invariant.js
ctx.on('subagent/start', (info) => {
  if (!stagedStarts.delete(info)) return;
  runs.set(info.runId, info);
}, { global: true });

ctx.on('subagent/end', (info) => {
  if (!stagedEnds.delete(info)) return;
  runs.delete(info.runId);
}, { global: true });
```

### 5.4 关键结论

**事件监听 API 完全相同**，静态插件可以：
1. 使用 `ctx.on(eventName, handler, options?)` 监听事件
2. 使用 `{ global: true }` 监听全局事件
3. 与动态插件保持完全兼容

---

## 6. sessiongraph_debug 工具

### 6.1 动态插件中的实现

```javascript
const tool = harness.defineTool({
  name: 'sessiongraph_debug',
  description: 'SessionGraph 验证工具:读取当前会话的图投影快照(分类节点流/游标)与切换记录。',
  parameters: {},
  output: {
    schema: { type: 'object', additionalProperties: true },
    render: (args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  },
  async execute(args, exec) {
    const agent = exec.agent;
    // ... 工具逻辑
  },
});
ctx.effect(() => harness.registerTool(ctx, tool));
```

### 6.2 静态插件中的等价实现

```javascript
import { defineTool } from "@deepseek-ai/dsh-tools";

function apply(ctx) {
  const tool = defineTool({
    name: 'sessiongraph_debug',
    description: 'SessionGraph 验证工具:读取当前会话的图投影快照(分类节点流/游标)与切换记录。',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      const agent = exec.agent;
      // ... 工具逻辑（完全相同）
    },
  });
  
  ctx.tools.register(tool);
}
```

### 6.3 关键差异

| 特性 | 动态插件 | 静态插件 |
|------|----------|----------|
| 定义 | `harness.defineTool()` | `defineTool()` |
| 注册 | `ctx.effect(() => harness.registerTool(ctx, tool))` | `ctx.tools.register(tool)` |
| 生命周期 | 自动清理（effect） | 需手动管理（或使用 effect） |

---

## 7. 差异清单

### 动态沙箱全局 vs 静态等价物

| 全局名 | 动态用法 | 静态等价 | 需改动点 |
|--------|----------|----------|----------|
| `harness` | `harness.handle()`, `harness.defineTool()`, `harness.registerTool()` | **无等价** — 静态插件不使用 | 1. RPC：注册为 Cordis 服务或使用 Typert<br>2. 工具：直接使用 `defineTool()` + `ctx.tools.register()` |
| `ctx` | 沙箱包装的受限上下文 | **完全等价** — 直接使用 Cordis 上下文 | 无需改动 |
| `console` | 带标签的沙箱 console | **完全等价** — 直接使用 `console` | 可选：添加插件名标签 |
| `styles` | Client 侧样式注入 | **无等价** — Host 侧不使用 | Client 侧需使用 Slot 系统 |
| `host` | Client 侧 RPC 调用 | **无等价** — Host 侧不使用 | Client 侧使用 `host.call()` |
| `btoa/atob` | 沙箱提供的编码函数 | **完全等价** — 直接使用 `Buffer` | 无需改动 |
| `TextEncoder/TextDecoder` | 沙箱提供的编码类 | **完全等价** — 直接使用全局类 | 无需改动 |
| `setTimeout/setInterval` | 沙箱禁止，需使用 timer 服务 | **完全等价** — 直接使用 timer 服务 | 无需改动 |

### 服务访问差异

| 服务 | 动态用法 | 静态等价 | 需改动点 |
|------|----------|----------|----------|
| `sessionProjections` | `ctx.get('sessionProjections')` | `ctx.inject(["sessionProjections"], ...)` | 建议使用依赖注入 |
| `tools` | `ctx.get('tools')` | `ctx.tools` 或 `ctx.inject(["tools"], ...)` | 直接访问或依赖注入 |
| `sessions` | `ctx.get('sessions')` | `ctx.inject(["sessions"], ...)` | 建议使用依赖注入 |
| `agents` | `ctx.get('agents')` | `ctx.inject(["agents"], ...)` | 建议使用依赖注入 |

### 工具注册差异

| 步骤 | 动态插件 | 静态插件 |
|------|----------|----------|
| 定义工具 | `harness.defineTool({...})` | `defineTool({...})` from `@deepseek-ai/dsh-tools` |
| 注册工具 | `ctx.effect(() => harness.registerTool(ctx, tool))` | `ctx.tools.register(tool)` |
| 参数验证 | 沙箱边界验证 | 直接调用（框架自动验证） |
| 输出处理 | `cloneJson()` 克隆 | 直接返回 |

### RPC 注册差异

| 场景 | 动态插件 | 静态插件 |
|------|----------|----------|
| Client→Host RPC | `harness.handle('method', handler)` | **无等价** — 需要新机制 |
| 解决方案 | — | 1. 注册为 Cordis 服务<br>2. 使用 Typert 协议<br>3. 通过事件总线 |

---

## 8. 移植建议

### 8.1 Host 半体结构

```javascript
// 静态插件 Host 半体结构
import { defineTool } from "@deepseek-ai/dsh-tools";

const name = "sessiongraph";
const inject = ["sessionProjections", "sessions", "agents", "tools"];

function apply(ctx, config) {
  // 1. 服务访问（使用依赖注入）
  ctx.inject(["sessionProjections"], (projectionCtx) => {
    // 2. 投影注册
    projectionCtx.sessionProjections.register({
      key: 'sessiongraph.graph',
      schema: sessionGraphSchema,
      stateVersion: 6,
      init: () => ({ nodes: [], cursor: null, currentTurn: null }),
      apply: applySessionGraphProjection,
      view: (state) => ({ nodes: state.nodes, cursor: state.cursor }),
    });
  });
  
  // 3. 事件监听
  ctx.on('subagent/start', (info) => {
    // ...
  }, { global: true });
  
  ctx.on('subagent/end', (info) => {
    // ...
  }, { global: true });
  
  // 4. 工具注册
  const tool = defineTool({
    name: 'sessiongraph_debug',
    description: '...',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      // ... 工具逻辑
    },
  });
  ctx.tools.register(tool);
  
  // 5. RPC 注册（需新机制）
  // 方案 A：注册为 Cordis 服务
  ctx.provide('sessiongraphService', {
    async getSessionGraph(args) { /* ... */ },
    async switchSession(args) { /* ... */ },
  });
}

export { name, inject, apply };
```

### 8.2 Client 半体结构

```javascript
// 静态插件 Client 半体结构
function apply(ctx) {
  // Client 侧使用 Slot 系统注册 UI
  ctx.slot('sidebar', () => {
    // ... 侧边栏 UI
  });
}

export { apply };
```

### 8.3 关键改动点

1. **RPC 注册**：从 `harness.handle()` 改为注册 Cordis 服务或使用 Typert
2. **工具注册**：从 `harness.defineTool()` + `harness.registerTool()` 改为 `defineTool()` + `ctx.tools.register()`
3. **服务访问**：建议使用 `ctx.inject()` 声明依赖
4. **生命周期**：手动管理 effect 清理或使用 `ctx.effect()`

---

## 9. 源码证据

### 9.1 入口形态证据

- `dsh-tool-web/package.json`：`"main": "lib/index.js"`
- `dsh-tool-web/lib/index.js`：`export { Config, apply, inject, name }`
- `dsh-command-compact/lib/index.js`：`export { apply, inject, name }`

### 9.2 defineTool 证据

- `dsh-tools/lib/index.js:836`：`function defineTool(options)`
- `dsh-tool-web/lib/index.js:179`：`ctx.tools.register(defineTool({...}))`

### 9.3 投影注册证据

- `dsh-session-projection/lib/index.js:58`：`register(definition)`
- `dsh-goal/lib/index.js:522`：`ctx.inject(["sessionProjections"], (projectionCtx) => { projectionCtx.sessionProjections.register({...}) })`

### 9.4 事件监听证据

- `dsh-subagent/lib/types/invariant.js:72`：`ctx.on('subagent/start', (info) => {...}, { global: true })`

### 9.5 harness 定义证据

- `dsh-cordis-host-runner/lib/index.js:1220`：`createSandbox(id, harnessExtras)`
- `dsh-cordis-host-runner/lib/index.js:1224`：`harness: { defineTool: sandboxDefineTool, registerTool: sandboxRegisterTool, ...harnessExtras }`

---

## 10. 结论

### 10.1 核心发现

1. **静态插件与动态插件 API 高度兼容**：投影注册、事件监听、工具定义 API 基本相同
2. **harness 是动态插件特有的**：静态插件不使用 `harness.handle()`，需要新机制暴露 RPC
3. **工具注册路径不同**：动态插件通过沙箱注册，静态插件直接使用 `ctx.tools.register()`
4. **服务访问方式相同**：都可以使用 `ctx.get()` 或 `ctx.inject()` 访问服务

### 10.2 移植可行性

**高可行性**：
- 投影注册：直接移植
- 事件监听：直接移植
- 工具注册：替换 API 调用即可

**中等可行性**：
- RPC 注册：需要新机制（推荐注册为 Cordis 服务）

**低风险**：
- 生命周期管理：静态插件可以使用 `ctx.effect()` 自动管理

### 10.3 推荐移植策略

1. **保持投影注册逻辑不变**
2. **保持事件监听逻辑不变**
3. **替换 `harness.defineTool()` 为 `defineTool()` from `@deepseek-ai/dsh-tools`**
4. **替换 `harness.registerTool()` 为 `ctx.tools.register()`**
5. **将 RPC 方法注册为 Cordis 服务**
6. **使用 `ctx.inject()` 声明服务依赖**
