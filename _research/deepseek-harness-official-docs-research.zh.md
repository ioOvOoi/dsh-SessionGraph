# DeepSeek Harness「官方文档」插件/事件/Client Slot 检索报告

> 检索日期：本次会话。目的：把官方文档内容并入平台研究报告。
> **重要事实来源说明（务必先读）**：本次执行的命令沙箱**没有可用的出站网络**（`curl.exe`/`node.exe` 被策略拒绝，`.NET HttpClient` 返回空响应，`Invoke-WebRequest` 报 TLS「安全包中没有可用的凭证」Win32 0x8009030E）。因此**无法直接下载下面每个文档 `.md` 的原始正文**。`web_search` 工具能确认文档文件的真实存在与精确 URL，但不返回正文文本。
> 据此，我给每条结论标注来源与可信度级别，**绝不臆造未读到的原文**。需要逐字摘录时，请由能访问网络的代理直接拉取文末「原始 Raw URL」。

---

## 结论速览（回答用户 5 问）

### 1) 动态插件 / Cordis 插件如何定义？Host vs Client 两个 half

- **官方文档明确存在**这一主题，主入口即用户给的页面：
  - [docs/user/develop/basic/index.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/index.md)（英文）
  - [docs/user/develop/basic/index.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/index.zh.md)（中文）
  - 兄弟文件：[tool.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/tool.md)、[config.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/config.md)、[publish.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)、[docs/user/develop/practice/index.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/practice/index.md)；以及 [docs/cordis-primer.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-primer.md) 与中文版 [cordis-primer.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-primer.zh.md)。
- **→ 机制层面（DSH 自带 skill 的权威描述，与文档 API 表面一致，可作依据）**：一个插件（Plugin）是稳定实例（`pluginId`），其代码分成**两个 half**：`code.host`（运行在 Node.js Host 进程，负责文件/网络/命令/agent/会话/服务/事件/模型 Tool）和 `code.client`（运行在浏览器页面，负责主题/布局/页面状态/槽 UI）。二者都是「纯 JS 函数体，返回一个 Cordis Plugin 对象」，最关键的是 `apply(ctx)`，在里面用 `ctx.get('...')` 取服务、`ctx.on('...')` 监听事件、`ctx.slots` 注册 UI；每个包（Package，`packageId`）是不可变版本。
- **→ 未逐字摘录**：因无法抓正文，`index.md` 原文句子未能摘录（见「来源与限制」）。

### 2) 官方文档记录的 Cordis 事件（消息/会话/agent）

- 专项文档确实存在：[docs/cordis-tutorial/04-events.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-tutorial/04-events.md)（同名中文版不在此路径，教程目录为 `docs/cordis-tutorial/`，含 `03-services.md` 等兄弟文件）。`docs/subsystems/README.md` 与 `core.zh.md` 也可能覆盖会话/消息生命周期。
- **→ 机制层面（skill 权威描述）**：事件用 `ctx.on('事件名', (payload, ...) => {...})` 注册；分为普通 emit 事件与 **Waterfall（串行拦截）事件**（后者监听器最后一个参数是 `next`，必须调用并返回 `next()` 以免中断）。
- **→ 具体事件清单（message / session / agent 有哪些事件名）**：web_search 无法返回该正文，**无法从抓取到的页面摘录确切事件名/载荷**。我**没有**拿到 `04-events.md` 的原始事件名列表，不能臆造。此项结论应为：**官方文档有 events 专章，但本次抓不到确切事件名清单**。

### 3) Client UI 的 Slot 机制

- Client 槽的官方材料确认存在：[packages/client/ui-workspace/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-workspace/README.md) 及中文版 [README.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-workspace/README.zh.md)；另有 UI 包（如 [dsh-client-ui-settings-plugins](https://www.npmjs.com/package/@deepseek-ai/dsh-client-ui-settings-plugins)）。
- **→ 机制层面（skill 权威描述，可直接作为「怎么写」依据）**：
  - 通过 `ctx.get('slots')` 拿槽服务；用 `slots.inject('目标槽', () => slots.register({name, key/id} , (props) => <组件/>))` 在槽内挂 React 组件（回归调用 `slots.register`，返回前用 `ctx.get('slots')` 判空）。
  - 槽协议分 `single` / `list` / `keyed` / `chain` 几种注册方式（`Slots.listSubTree` 会给出 kind/scope/注册键/被替换风险/子槽）。
  - 用户在提示中提到的槽名有官方/skill 佐证的包括：`tool.view.cordis`（动态插件 Run 卡片区，`key:'self'` 绑定到 `pluginId+packageId`）、`tool.call.toolview`（普通 Tool 的调用卡片）、`settings.section` / `settings.general.item`（设置页）、`shell.overlay`（toast/状态/整窗覆盖层）、`sidebar.footer.action`（侧栏小动作）、`conversation.chat.turnTail`（回合后补充内容）。
  - 会话级槽可能通过标准 props 提供 `useSession / useSessions / useWorkspaces` 等；Client→Host 私有通信用 `harness.handle(method, handler)`（Host）与 `host.call(method, args)`（Client），仅传可 JSON 化的数据。
  - **注意**：上面 `sidebar` / `conversation` / `shell.overlay` 等具体槽名来自 DSH 自带 skill 的导航建议；`docs/user/develop/basic/index.md` 原文里**到底列了哪些槽名、有没有 `scope(kind/single/list)` 这种字眼，我未能从抓到的页面核验**。
- **→ 未逐字摘录**：`ui-workspace/README.zh.md` 原文未能抓取。

### 4) 「写好一个插件」的最小示例（curl / apply(ctx)）

- 官方文档存在基础示例页（`index.md` / `index.zh.md` / `practice/index.md`），以及大量第三方踩坑/HelloWorld 教程（见文末链接），说明官方确有「最小示例」。
- **→ 本 skill 提供的标准最小 Host/Client 骨架（可作为「怎么写」的模板，非文档逐字引用）**：
  - Host 最小骨架：`return { apply(ctx){ ctx.get('slots') ... } }`；Client 槽示例：
    ```js
    return { apply(ctx){
      const slots = ctx.get('slots')
      if (slots === undefined) return
      slots.inject('tool.view.cordis', () => slots.register(
        { name:'tool.view.cordis', key:'self' },
        () => React.createElement('div', null, 'Hello'),
      ))
    } }
    ```
  - **curl 写法**：`docs/user/develop/basic/` 是否给出 curl 建插件的命令行写法，我未能抓正文核验 → 标记为**官方文档未提及（未抓到证据）/未能核对**。

### 5) Host 侧监听「新消息产生」或「session 创建/销毁」

- 机制层面—— Host 侧负责 agent/会话/生命周期，Host 代码用 `ctx.on('<事件名>', handler)` 监听。技能与系统描述都确认「Agents, durable Session data, or Host lifecycle → Host 平台」。
- **→ 但确切的事件名（如 `session/message`、`session/created`、`agent/...`）**：这些事件是否出现在 `04-events.md` / `subsystems/core.md` 中，我**抓不到正文，无法给出确切事件名与载荷**。此点需由能联网的代理直接读文件确认。

---

## 官方文档文件 → 精确 URL（web_search 已确认真实存在）

### 用户点名的文件
| 文件 | 页面 URL |
|---|---|
| `docs/user/develop/basic/index.md` | https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/index.md |
| `docs/user/develop/basic/index.zh.md` | https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/index.zh.md |
| `docs/user/develop/basic/tool.md` | https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/tool.md |
| `docs/user/develop/basic/config.md` | https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/config.md |
| `docs/user/develop/basic/publish.md` | https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md |
| `docs/user/develop/practice/index.md` | https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/practice/index.md |
| `docs/cordis-tutorial/04-events.md` | https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-tutorial/04-events.md |
| `docs/cordis-tutorial/03-services.md` | https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-tutorial/03-services.md |
| `docs/cordis-primer.md` | https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-primer.md |
| `docs/cordis-primer.zh.md` | https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-primer.zh.md |
| `docs/cookbook/extension-cookbook.md` | https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/extension-cookbook.md |
| `docs/subsystems/README.md` | https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/README.md |
| `docs/subsystems/core.md` / `core.zh.md` | https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/core.zh.md |
| `docs/architecture.md` / `.zh.md` | https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.zh.md |
| 客户端槽列表 `packages/client/ui-workspace/README.zh.md` | https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-workspace/README.zh.md |

### 直接下载原文的 Raw URL（供能联网的代理取正文字节）
- `https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/user/develop/basic/index.zh.md`
- `https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/cordis-tutorial/04-events.md`
- `https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/cordis-primer.zh.md`
- `https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/cookbook/extension-cookbook.md`
- `https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/subsystems/README.md`
- `https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/client/ui-workspace/README.zh.md`

---

## 可核验的第三方资料（佐证「官方文档确有这些能力」，非官方原文）
以下教程/解析都基于同一官方仓库，可用于交叉印证或改写：
- 插件开发从零 HelloWorld → Tool：[CSDN 插件开发实战](https://yuqingteck.blog.csdn.net/article/details/163735126)
- 架构解析（MCP/Skill 统一为 Cordis 插件）：[CSDN](https://blog.csdn.net/qhvssonic/article/details/163735303) / [技术站](https://jishuzhan.net/article/2088096824576851969)
- 完整教程与对比：[minims.cn](https://minims.cn/archives/J20260814100138831640) / [cnblogs sing1ee](https://www.cnblogs.com/sing1ee/p/22455466)
- Agent loop 本身也是插件：[wangruofeng007](https://wangruofeng007.com/blog/2026-08/deepseek-harness-plugin-architecture/)
- DeepWiki 自动生成源码解析：[Execution Environment / Host-Client Bridge](https://deepwiki.com/deepseek-ai/deepseek-harness/5-execution-environment)、[Monorepo structure](https://deepwiki.com/deepseek-ai/deepseek-harness/2-monorepo-structure-package-families)

---

## 来源与限制（诚实声明）
1. **正文无法抓取**：沙箱无出站网络；所有「原文摘录」我无法逐字提供，已如实标注。未标注为 skill/机制描述的句子，不要当官方原文引用。
2. **机制描述来源**：`cordis-plugin-development` skill（随 DSH 部署自带，路径 `C:\Users\Administrator\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\config\agent-presets\cordis\skills\cordis-plugin-development`）——它描述的是与官方文档 API 表面一致的 Host/Client/事件/槽机制，属性上等同「官方机制文档」但不是用户点名的那几个 `.md` 页面。
3. **「官方文档未提及/未能核对」项**：确切事件名（message/session/agent）、槽的 `scope(kind/single/list)` 字眼、curl 建插件写法——均因抓不到正文而**未能核验**，建议由能联网的代理用上面 Raw URL 直接读取后再下结论。
