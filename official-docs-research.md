# DeepSeek Harness 官方文档调研报告(并入平台研究报告用)

> 任务:抓取 DeepSeek Harness 官方文档页面内容,逐条收录并标注来源 URL,区分「官方文档有提及」与「官方文档未提及」。
> 方法说明:子系统类官方文档(`docs/subsystems/*.md`:session、persistence、compaction、subagent、core)的正文即是随 npm 包分发的 `**/README.zh.md`(官方 README 引用 `../../../docs/subsystems/*.md` 指向同一份源,二者同源、都由 GitHub 仓库 docs 目录渲染到 deepseek-harness.github.io)。英文 README 与中文 README 同目录并存。
> 由于本会话沙箱屏蔽了 pwsh 直连外网(SSL 被拒),正文取自随包分发的官方 README.zh.md 实文件(其 URL 即对应 GitHub blob / github.io 页);guide(quickstart / develop/basic)页面无法直接抓全文,见第 1、2 节的诚实说明。

---

## 0. 文档与 URL 对照表(官方来源)

| 官方文档 md 源(GitHub blob) | 英文原文 | 中文版 | 对应 github.io 页 |
|---|---|---|---|
| `docs/user/guide/quickstart.md` | https://github.com/deepseek-ai/DeepSeek-Harness/blob/master/docs/user/guide/quickstart.md | https://github.com/deepseek-ai/DeepSeek-Harness/blob/HEAD/docs/user/guide/index.zh.md | http://deepseek-harness.github.io/deepseek-harness/guide/quickstart |
| `docs/user/guide/index.md` / `index.zh.md` | https://github.com/deepseek-ai/DeepSeek-Harness/blob/master/docs/user/guide/index.md?plain=1 | https://github.com/deepseek-ai/DeepSeek-Harness/blob/master/docs/user/guide/index.zh.md | (guide 首页) |
| `docs/user/develop/basic/index.md` | https://github.com/deepseek-ai/DeepSeek-Harness/blob/master/docs/user/develop/basic/index.md | https://github.com/deepseek-ai/DeepSeek-Harness/blob/master/docs/user/develop/basic/index.zh.md | http://deepseek-harness.github.io/deepseek-harness/develop/basic/ |
| `docs/subsystems/session.md` | https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/session.md | https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/subsystems/session.md | github.io `/subsystems/session` |
| `docs/subsystems/persistence.md` | https://github.com/deepseek-ai/DeepSeek-Harness/blob/master/docs/subsystems/persistence.zh.md | 同上 | github.io `/subsystems/persistence` |
| `docs/subsystems/compaction.md` | https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/compaction.zh.md | 同上 | github.io `/subsystems/compaction` |
| `docs/subsystems/subagent.md` | https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/subagent.md | https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/subagent.zh.md | github.io `/subsystems/subagent` |
| `docs/subsystems/core.md` | https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/core.md | .zh.md | github.io `/subsystems/core` |

正文核对依据(随包官方 README.zh.md 实文件,内容与上述 blob 同源):
- `dsh-session/README.zh.md`(会话模型/事件)
- `dsh-session-persistence-jsonl/README.zh.md`(JSONL 磁盘布局/编码)
- `dsh-compaction-basic/README.zh.md`(压缩后端)
- `dsh-subagent/README.zh.md`(子代理)
- `dsh-agent/README.zh.md`(agent 事件,对应 core.md)

---

## 1. 官方 quickstart 页面讲了什么

**诚实说明(重要):** 本会话沙箱屏蔽了直连外网,而 `docs/user/guide/quickstart.md` 未随 npm 包分发本地副本;web_search 对 GitHub blob/github.io 只返回 URL 与第三方解读博客,**未返回 quickstart 页正文**。因此以下仅列出官方 quickstart 的存在与入口,并区分「我可确认」与「无法从官方文档正文确认」。凡是 quickstart 正文里的具体命令/端口/目录,本轮**无法从官方正文逐字核实**,不作臆造。

- 官方存在 `docs/user/guide/quickstart.md` 源:
  - https://github.com/deepseek-ai/DeepSeek-Harness/blob/master/docs/user/guide/quickstart.md
- 官方 guide 目录还有 `index.md` / `index.zh.md` / `python-sdk.md` / `providers.md`(均为官方 guide 入口/配置页):
  - https://github.com/deepseek-ai/DeepSeek-Harness/blob/master/docs/user/guide/index.md?plain=1
  - https://github.com/deepseek-ai/DeepSeek-Harness/blob/master/docs/user/guide/index.zh.md
  - https://github.com/deepseek-ai/DeepSeek-Harness/blob/master/docs/user/guide/python-sdk.md
  - https://github.com/deepseek-ai/DeepSeek-Harness/blob/master/docs/user/guide/providers.md
- 官方 CLI 使用指南(apps/cli/README):
  - https://github.com/deepseek-ai/DeepSeek-Harness/blob/master/apps/cli/README.md
  - https://github.com/deepseek-ai/DeepSeek-Harness/blob/master/apps/cli/README.zh.md
- 「启动」/「会话」/「数据存放」这几个点在 quickstart 正文里具体怎么写,**本轮未能从官方正文核实**,故标注:**官方 quickstart 正文(启动命令、端口、数据目录)本轮无法核实 → 不臆造**(来源:上述官方来源 URL 存在,但正文不可得)。

> 请在开放网络环境时重新抓取 https://deepseek-harness.github.io/deepseek-harness/guide/quickstart 正文,以补全 1 节的启动/会话/数据目录逐字内容。

---

## 2. 官方 develop/basic 页面讲了什么?是否含「动态插件开发」?

**同样诚实说明:** `docs/user/develop/basic/index.md` / `.zh.md` 存在官方 blob 源,但本会话无法抓全文:
- https://github.com/deepseek-ai/DeepSeek-Harness/blob/master/docs/user/develop/basic/index.md
- https://github.com/deepseek-ai/DeepSeek-Harness/blob/master/docs/user/develop/basic/index.zh.md

**但「动态插件开发」主题在官方文档内确有正文可核实**,只是落在 `subsystems/core.md`(host agent 事件)、`cordis-primer.md`(Cordis 插件基础)、`cordis-tutorial/04-events.md`(事件监听)、`cookbook/extension-cookbook.md`(扩展示例)上(均为官方文档,非 quickstart/develop-basic 页):

- **官方 cordis-primer.md**(Cordis 插件入门):https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-primer.md ;中文版 https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-primer.zh.md
- **官方 cordis-tutorial/04-events.md**(事件监听教程):https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-tutorial/04-events.md
- **官方 cookbook/extension-cookbook.md**(扩展 cookbook,含 Host/Client、slot):https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/extension-cookbook.md

**关于 develop/basic 是否含 Host vs Client / 监听事件 / Slot / 写 plugin:** develop/basic 页自身正文本轮未能核实全文。但官方 subsystems 与 cordis 系列文档确实覆盖这些主题(见 §5 的 host 事件),其中:

**Host vs Client、Slot(客户端 UI 插槽)、写 plugin 这三个点,官方文档网络里有对应来源**(deepwiki 对仓库 5-execution-environment 的索引 + cordis-primer/cookbook):
- https://deepwiki.com/deepseek-ai/deepseek-harness/5-execution-environment (API Layer & Host-Client Bridge 的仓库派生索引,非官方托管页面,慎用)
- 官方 cookbook(extension-cookbook.md,见上)覆盖插件编写与扩展挂载点。

> develop/basic 页的确切正文(它到底写了哪些小节)本轮**无法从官方正文逐字核实**。若要写「develop/basic 讲了什么」的逐条细节,需在开放网络下抓 https://deepseek-harness.github.io/deepseek-harness/develop/basic/ 全文后再补。

---

## 3. 会话存储格式 / 会话目录位置 / 消息记录字段 / compaction / subagent —— 官方文档全部有正文(可核实)

以下为随包官方 README.zh.md(= 官方 `docs/subsystems/*.md` 同源正文)摘录,是最可靠、可逐字引用的官方内容。

### 3.1 会话存储格式:JSONL + zstd(官方确凿)

> JSONL 持久会话存储后端……每个会话有一个仅追加的逻辑 JSONL 日志,默认存储为 `.jsonl.zstd`;禁用压缩时使用原始 `.jsonl`。
> — `dsh-session-persistence-jsonl/README.zh.md`(官方);对应 blob: https://github.com/deepseek-ai/DeepSeek-Harness/blob/master/docs/subsystems/persistence.zh.md

磁盘布局(官方原文):
```
<root>/
  --<normalized-cwd>--/          # readable project directory (or _no-cwd/)
    <encoded-id>/                # session-owned directory
      session.jsonl.zstd         # default: checksummed header frame + append frames
      session.jsonl              # only with compression: 'none'
```
> 第一个逻辑行是不可变的 `SessionHeader`,标记为 `{ type: 'session', version, id, cwd?, createdAt, parentSession?, seedLength?, origin?, delegationDepth, agentPreset? }`。`delegationDepth` 在磁盘上必需,顶层会话为 `0`…… 后续每个逻辑行是一条存储记录;`assistant/chunk` 事件绝不丢弃,且 `seq` 在解码日志中保持连续(`events[i].seq === i`)。
> 配置表:`compression` 默认 `'zstd'`、`packChunks` 默认 `true`(约省 60%)、`writeBatchMaxDelayMs` 默认 `200`ms;`root` 必需、**无默认值**。
> 「不删除会话文件」:日志在 `root` 下累积,直到外部移除(seam 无删除接口)。
> — 同上 `dsh-session-persistence-jsonl/README.zh.md`
> 来源 URL: https://github.com/deepseek-ai/DeepSeek-Harness/blob/master/docs/subsystems/persistence.zh.md ;英文 https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/persistence.md

### 3.2 会话目录位置

> 配置根仍由部署控制:可以是项目本地、共享、临时或集中式。…… <root>/--<normalized-cwd>--/<encoded-id>/session.jsonl.zstd
> — `dsh-session-persistence-jsonl/README.zh.md`
> 由此推断默认根为 `~/.dsh/sessions`(README 本身未写死该默认;它写「root 无默认值,由部署提供」)。**「默认即 ~/.dsh/sessions」是运行实例配置证据,非本则官方正文**;官方正文只说 root 由部署控制。
> 来源 URL: https://github.com/deepseek-ai/DeepSeek-Harness/blob/master/docs/subsystems/persistence.zh.md

### 3.3 会话事件模型(消息记录字段:id / seq / time / parentId)

> `Session` 是 agent(智能体)全部交互历史的仅追加真源,LLM 消息历史由它*派生*。原始日志之上维护一个 **surface** 层(产生消息事件的有序投影)。
> — `dsh-session/README.zh.md`(官方);对应 blob: https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/session.md

- 每条 `SessionEvent` 三个可选顶层结构字段:`sourceEventSeqs?: number[]`、`surfaceOp?: SurfaceOp`、`ignorable?: true`(`dsh-session/README.zh.md`)
- `user/message` 存储完整 `UserMessage`(带收件箱/进入步骤前创建的标识);`assistant/message` 与 `tool/result` 也存完整消息值;`turn/start`/`turn/end` 包围轮次(`dsh-session/README.zh.md`)
- `SessionHeader`:**`{ version, id, createdAt, cwd?, parentSession?, seedLength?, delegationDepth? }`** → 官方确凿存在 **parentSession**(树/子会话边)字段(`dsh-session/README.zh.md`)
- **官方明文「暂缓会话分支/树结构」与 fork 能力**:
  > 已知限制:会话分支/树结构(pi 风格条目树):除非需要超越基于边界的 `fork()` 能力,否则暂缓。`fork()` 仅在实时会话的稳定边界处切分。
  > `ctx.sessions.fork(source, boundary?, childSessionId?): Session` 创建带谱系元数据的实时子会话。
  > — `dsh-session/README.zh.md`
  > 来源 URL: https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/session.md

- 关于「消息级全局唯一 id」:`dsh-session/README.zh.md` 提到 `MessageId` 是 inbox「唯一的入队项标识」、`tool/result` 持久化「带标识、user-role 的工具结果消息」;**但官方子系统 md 本身没有把「每条 Message 的 UUID id 字段」作为独立小节**——那是语言层 `Message.id`,`dsh-agent/README.zh.md`(core.md)提 `MessageId 是唯一的入队项标识,在消息待处理期间必须保持唯一`:` https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/core.md

### 3.4 Compaction / 压缩机制(官方确凿)

> 「基础压缩(compaction)后端」:`BasicCompactionEngine`…使用可复用的 `ctx.tokenMeter` 压力、token 预算保留与摘要。…… 当 `auto: true`(默认)时,它会在 token 压力下自动压缩。同级 `dsh-command-compact` 调用 `ctx.compaction.compactNow(...)`。
> 触发比率:`thresholdRatio` 默认 `0.8`(在 `floor(routedContextWindow × ratio)` 处压缩);`retainRatio` 默认 `0.16`;摘要 `maxTokens` 默认 `8192`;`compactionRetries` 默认 `1`;`auto` 默认 `true`。
> 替换消息用 `<compacted-summary>` 标签标记已建立的检查点上下文;原始摘要保留在 `compaction/summary` 事件上。
> — `dsh-compaction-basic/README.zh.md`(官方);对应 blob: https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/compaction.zh.md

**「压缩不删原文」官方明文**(最关键的一条):
> 追加的 surface 条目会在后续步骤中重新发送。`replace` surface 操作会从未来输入中移除被遮蔽条目,**但不删除其原始日志记录**。
> — `dsh-session/README.zh.md`(官方,会话模型的一节)
> 来源 URL: https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/session.md

> `compactRegion` 要求存在未结束的轮次:在完全关闭的会话上手动调用会抛出异常(「no open turn」)。
> — `dsh-compaction-basic/README.zh.md`
> 来源 URL: https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/compaction.zh.md

### 3.5 Subagent / 子代理会话组织(官方确凿)

> subagent seam 允许一个 agent 通过具名提供方把工作委派给子 agent。调用方统一使用 `ctx.subagents` 服务 API;…… 本地运行会在 `start()` 兑现前发布普通的子 agent/会话,把该共享会话 id 作为 `SubagentRun.id` 返回…… 把 `request.parent.session.id` 记录到子 agent 的 `parentSession` header,并在其初始轮次内追加已解析的描述符。
> **父/子关系持久化字段**:`SessionHeader.delegationDepth` 具有权威性且单调……持久化的 `parentSession`。子代理会话与父会话一样用同一会话持久存活。
> **树枚举**:`listChildren(parentSessionId)`(直接子代)、`listDescendants(rootSessionId)`(整棵树,带持久 `parentId` 与 `depth`,pre-order 展平)。
> **描述符事件**:`subagent/descriptor` 会话事件(`mode: 'one-shot'|'continuable'`,存子代理身份/可续性),「该事件只进入日志:不含 `surfaceOp`,不进入模型历史,并由仅追加日志跨压缩(compaction)保留」。
> **生命周期事件**:`subagent/start` / `subagent/end`(一对,共享 `runId`)、`subagent/provider-added` / `provider-removed`。
> — `dsh-subagent/README.zh.md`(官方);对应 blob: https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/subagent.md ;中文 https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/subagent.zh.md

> `inheritsParentContext` 只用于描述,不能强制执行。它仅说明子 agent 是否能看到父级已完成的对话历史(`fork` 可以;`spawn` 和各进程外一次性提供方不可以)。
> — 同上 `dsh-subagent/README.zh.md`

---

## 4. 官方文档中对「Session 事件 / 消息事件 / agent 事件」的记载

全部有官方正文(可核实),来源为 `dsh-session/README.zh.md`、`dsh-agent/README.zh.md` 对应 `docs/subsystems/session.md` / `docs/subsystems/core.md`:

**会话事件(Cordis 实时事件,host 插件可监听)**(官方 `dsh-session/README.zh.md`):
> 会话存储会将已通知的创建与释放配对,在提交后发布追加通知……「持有创建与释放配对」并提供「受等待的持久性检查点」。会话生命周期事件为 **session/created / session/disposed / session/event / session/flush**(后者即持久化检查点,`ctx.sessions.flush(session)`「分发一个需等待完成的并行持久性检查点」)。
> 插件通过订阅 `session/event` 延后写入,在 `session/flush` 时刷新,并镜像 `session/created`/`session/disposed` 生命周期。
> — 来源: https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/session.md

**agent 事件(core.md 篇幅最大,官方 `dsh-agent/README.zh.md`)**:
> `dsh-agent` 声明实时 `agent/*` 协调词汇……确切签名、分发 mode、作用域筛选规则与 payload 约定位于 `docs/subsystems/core.md` 的生成区块。
> - `agent/created`、`agent/disposed`(生命周期边)
> - `agent/session-start`(第一个受支持的启动注入点;同步、不可 veto)
> - `agent/pre-step`(waterfall:接收 agent、已领取 `UserMessage[]`、turn、step、signal,返回 `PreStepDecision = reject | enter`)
> - `agent/request`、`agent/request-error`(失败模型请求的恢复 waterfall)、`agent/turn-stopping`、`agent/error`
> - inbox 通知:`agent/inbox/inserted { message }`、`agent/inbox/claimed { message, turn }`、`agent/inbox/discarded { message }`
> 官方强调:「轮次和步骤边界以及模型 token 流是持久 `session/event` 事实,而不是镜像的 `agent/*` 通知。消费方从会话事件流读取 `turn/*`、`step/*` 和 `assistant/chunk`。」
> — 来源: https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/core.md

**持久消息事件(会话日志事件)`SessionEvent`(官方 `dsh-session/README.zh.md`)**:
> `turn/start`、`turn/end`(带 `TurnEndReasonMap` 可合并扩展的结束原因)、`user/message`、`assistant/message`、`assistant/chunk`(`type:'usage'` 记录)、`tool/call`、`tool/result` 等,统一为会话仅追加日志的事件;`SessionEventMap` 可由插件用声明合并扩展新事件类型。
> 每条 `assistant/message` 都会记录提供方、模型和可选回放状态。
> — 来源: https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/session.md

**注意(重要、防误导):** 官方文档没有名为 `user/message` / `assistant/message` / `message` 的「Cordis 实时事件」——它们都是**会话日志事件类型**,统一通过**单个 `session/event`** 实时事件在每条 append 后推送;这一结论与 `research-dsh-platform.md` 源码分析一致。

---

## 5. 「官方文档未提及」/「需要开放网络再核实」清单(诚实标注)

| 主题 | 官方文档状态 |
|---|---|
| quickstart 页具体启动命令 / 端口 / 「数据默认在 ~/.dsh/sessions」逐字写法 | **本轮无法从官方正文核实**(页面存在: https://github.com/deepseek-ai/DeepSeek-Harness/blob/master/docs/user/guide/quickstart.md ;正文需开放网络再抓) |
| develop/basic 页的确切小节结构与示例代码 | **本轮无法从官方正文核实**(页面存在: https://github.com/deepseek-ai/DeepSeek-Harness/blob/master/docs/user/develop/basic/index.md) |
| 每条 Message 的「UUID id」作为独立文档字段(语言层 `Message.id`) | 官方 subsystems md **未作为独立小节写明**;仅 core.md 提 `MessageId` 为 inbox 入队标识(来源: https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/core.md ) |
| 默认会话根目录=`~/.dsh/sessions` | **官方正文未写死默认**;官方 persistence.md 只写「root 无默认,由部署控制」。`~/.dsh/sessions` 是本机配置实证,非官方正文 |
| Client UI Slot / Host-Client 编写插件在 develop/basic 页的具体写法 | develop/basic 正文不可得;官方 cookbook( https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/extension-cookbook.md )与 cordis-primer( https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-primer.md )覆盖插件/扩展主题(本轮未逐字核其内文) |

---

## 6. 给报告整合者的建议

1. **可放心引用(有官方正文)**:会话 JSONL`.jsonl.zstd` 存储与 `--<cwd>--/<id>/session.jsonl.zstd` 布局、`SessionHeader{...delegationDepth}` 与 `parentSession`、会话日志事件(`turn/*`、`user/message`、`assistant/message`、`assistant/chunk`、`tool/*`)、`session/event|created|disposed|flush` 事件、agent 事件族(`agent/*` + `agent/inbox/*`)、compaction 的 `thresholdRatio 0.8` / `<compacted-summary>` / **不删原文**、subagent 的 `parentSession`/`delegationDepth`/`subagent/descriptor`/`subagent/start|end`。
2. **引用时优先用 GitHub blob URL**(如 https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/session.md ),因正文与我核对的 README.zh.md 同源。
3. **勿把本项目源码实证出的缺省/实现细节写进「官方文档」**:`~/.dsh/sessions`、`Message` 级 UUID、各 `SessionEventMap` 扩展类型等属源码/运行证据,不属于官方 docs 正文(这些在 `research-dsh-platform.md` 已按源码标注)。
4. 若要补全 quickstart / develop/basic 逐字内容,请在开放网络环境重新抓 https://deepseek-harness.github.io/deepseek-harness/guide/quickstart 与 …/develop/basic/ 后再并入。
