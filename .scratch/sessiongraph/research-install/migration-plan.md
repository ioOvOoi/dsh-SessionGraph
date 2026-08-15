# SessionGraph 静态化移植方案(适配 `dsh plugin` git 安装)

> 2026-08-14。基于三路研究(A 静态 Host 写法 / B 静态 Client 写法 / C 安装链路,详见 `research-install/`)综合。
> 红队研究(D)中途卡死已中断,移植风险由本文档自评补齐。

## 0. 结论先行

**可行,但有一个功能裁剪**:平台没有开放给第三方 UI 插件的自定义 Client→Host RPC 通道
(harness.handle 是动态沙箱专属;`connection.rpc.call('/api', ...)` 端点集为网关内置;typert 面向官方远程客户端)。

| 功能 | 动态版(pkg-67) | 静态版 | 迁移方式 |
|---|---|---|---|
| 图谱展示/缩放/平移/拖拽 | ✅ | ✅ 全保留 | Client 代码平移 |
| 点击原子跳转聊天 | ✅ | ✅ 全保留 | Client 代码平移 |
| 轮次折叠/展开(含操作原子 ±) | ✅ | ✅ 全保留 | Client 代码平移 |
| 委派/工具/遮蔽段渲染 | ✅ | ✅ 全保留 | 投影数据平移 |
| switches/toolinfo RPC | ✅ | ✅ 改走投影 | view 输出并入 `switches`/`toolInfo` |
| **jump 切枝(遮蔽+继续)** | ✅ | ⚠️ **静态版裁剪** | 无官方 RPC 通道;待 typert 开放或官方支持后补 |

## 1. 包结构(仓库根 = 插件包)

```
dsh-SessionGraph/
├── package.json
├── lib/
│   ├── index.js      # Host 半体(静态 Cordis 插件)
│   └── client.js     # Client 半体(__ModuleLoader__ 注册)
├── .scratch/ docs/   # 现有内容照旧(附带文件,不影响安装)
```

### package.json 要点(依据 C 研究)
```json
{
  "name": "dsh-sessiongraph",
  "version": "0.1.0",
  "type": "module",
  "main": "lib/index.js",
  "exports": { ".": "./lib/index.js", "./client": "./lib/client.js" },
  "dsh": {
    "client": {
      "inject": ["@deepseek-ai/dsh-client-runtime", "@deepseek-ai/dsh-client-ui-conversation"],
      "platform": "web"
    }
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.1",
    "@deepseek-ai/dsh-tools": "^0.1.0-rc.6",
    "react": "^18.2.0"
  }
}
```
- `exports["./client"]` + `dsh.client.platform:"web"` → ClientModuleRegistry 自动收集(无需手动加列表)
- `dsh.client.inject` 是加载顺序依赖(client 半体实际依赖用 require() 解析)
- 纯 JS 无构建脚本(免 pnpm onlyBuiltDependencies 问题)

## 2. Host 半体移植(lib/index.js,依据 A 研究)

pkg-67.host.js → 静态形态,改动:
1. **入口**:`export const name = 'dsh-sessiongraph'`;`export const inject = ['sessionProjections', 'tools', 'sessions', 'agents']`;`export function apply(ctx) {...}`
2. **RPC 全部移除**(switches/toolinfo/get/jump)——数据改走投影(见 §4),jump 裁剪
3. **投影注册**:`ctx.inject(['sessionProjections'], (pctx) => pctx.sessionProjections.register({...}))`(apply 内 `ctx.inject` 或顶部 inject 声明二选一;沿用动态 apply 逻辑原样)
   - view 输出扩展:`{ nodes, cursor, switches, toolInfo }`(switch 记录与工具描述由 host 在 view 时注入——投影 view 可访问 ctx?不行,view 是纯函数。改为:Host 另注册一个**同 key 的轻量投影**或把 switches/toolInfo 作为投影 state 的一部分,由 Host 在 apply 时合并?更简单:Host 提供**第二个投影单元** `sessiongraph.meta`,view 输出 { switches, toolInfo };Client 用 useProjection('sessiongraph.meta'))
4. **事件监听**:`ctx.on('subagent/start', ...)` 原样(需 `{ global: true }`?A 报告示例带 global:true——确认:动态版没带也工作,静态版按 A 示例带)
5. **debug 工具**:`import { defineTool } from '@deepseek-ai/dsh-tools'` + `ctx.tools.register(tool)`(替代 harness.defineTool/registerTool)
6. switchRuns/toolDescCache/MIN_SHADOW 等逻辑原样保留(仅 jump RPC 段删除)

## 3. Client 半体移植(lib/client.js,依据 B 研究)

pkg-67.client.js → 静态形态,行级改动:
1. **入口**:`window.__ModuleLoader__.load({ id: 'dsh-sessiongraph', factory(require) { ... return { inject: ['slots','connection','layout'], apply(ctx) {...} } } })`
2. **React**:`const react = require('react')`,全文 `React.` → `react.`(或 `const React = require('react')` 最小改动)
3. **CSS**:`styles.insert(...)` → 模块级 `document.createElement('style')` + `head.appendChild`
4. **timer**:`ctx.get('timer').timeout(fn, ms)` → 原生 `setTimeout`(静态允许);dispose 引用改为 timeout id,清理用 `clearTimeout`(pendingJumpTimerRef/jumpMsgTimerRef/scrollToKey 定时)
5. **host.call** → 不适用(无自定义 RPC):switches/toolInfo 改从 `useProjection('sessiongraph.meta')` 读;jump 相关(confirmJump/交互原子 ⇄)静态版移除(± 折叠与 ✕ 保留)
6. **layout/slots**:`ctx.get('layout')` → `ctx.layout`;`slots.inject` → `ctx.slots.inject`
7. **owner props**:useProjection/useSessions/sessionId **零改动**
8. 其余(布局/渲染/跳转锚点/折叠/遮蔽/窄条)原样平移

## 4. 数据通道重设计(替代被移除的 RPC)

| 数据 | 动态版来源 | 静态版来源 |
|---|---|---|
| 节点流/cursor | sessiongraph.graph 投影 | 同(不变) |
| switches(委派记录) | sessiongraph.switches RPC | 新投影单元 `sessiongraph.meta`(view 输出 switches) |
| toolInfo(工具描述) | sessiongraph.toolinfo RPC | 同上(toolInfo 字段) |
| jump 遮蔽 | sessiongraph.jump RPC | 裁剪(不可用) |

`sessiongraph.meta` 投影:Host apply 对 `subagent/start|end`、`session/event` 维护 switch 记录镜像 + 按需构建 toolInfo(view 时经 tools 服务注入——view 需访问 ctx,可在投影注册的 apply 里把 toolDescCache 存进 state,view 读出)。

## 5. 安装与验证(对方机器)

```bash
# 1) 安装(从 GitHub git 仓库;可锁定 tag/branch/commit)
dsh plugin --profile web add git+https://github.com/ioOvOoi/dsh-SessionGraph.git#v0.1.0

# 2) 挂载(profile 的 cordis.patch.yml)
# - insert:
#     - id: sessiongraph
#       name: 'dsh-sessiongraph'

# 3) 重启 dsh(bundle 变更需重启;patch 行热重载)
```
本地预验证:`dsh plugin --profile web add file:../dsh-SessionGraph` 或 `link:../dsh-SessionGraph`,然后重启观察图谱出现。

## 6. 移植成功验收清单

- [ ] `dsh plugin add` 后重启,details 列出现会话图谱(Client 加载成功)
- [ ] 节点流/跳转/折叠/缩放/拖拽与动态版一致
- [ ] 委派节点显示(childId/运行态)与工具标签显示(toolInfo)
- [ ] 窄条(SlimOverlay)正常
- [ ] `sessiongraph_debug` 工具可用(tools.register)
- [ ] 卸载测试:`dsh plugin --profile web remove dsh-sessiongraph` 干净恢复
- [ ] jump 切枝在静态版明确不可用(UI 不出现 ⇄ 原子,仅 ±/✕)

## 7. 风险自评(替代卡死的红队 D)

| 风险 | 级别 | 规避 |
|---|---|---|
| `__ModuleLoader__.load`/exports 细节与部署版本不一致 | 🟡 | 实现前对照 `dsh-client-ui-trajectory/client.js` 逐行仿写 |
| `ctx.inject` 与 `inject` 数组两种注入方式的语义 | 🟡 | 先实现后实测(投影注册失败会立刻暴露) |
| view 输出扩展导致 useProjection 消费端形状变化 | 🟡 | meta 用独立投影单元,graph 形状不变 |
| peerDependencies 版本对齐(rc.6) | 🟢 | 以部署 package.json 版本为准 |
| git 安装的 pnpm prepare 限制 | 🟢 | 纯 JS 无 prepare 脚本 |
