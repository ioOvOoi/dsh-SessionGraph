# SessionGraph 代码审查报告 — 动态插件 sgraph-1:pkg-36 → pkg-59

> 固定点:pkg-36(基线)→ pkg-59(当前,run-48)。代码不在 git 提交中,以动态包演化代替 git diff。
> 审查方式:双轴并行子代理(Standards / Spec),聚合时由主持方校正平台事实。

## Standards 轴

### 误报校正(子代理缺乏平台知识,已核实源码后剔除)
| 编号 | 原判 | 校正 | 依据 |
|---|---|---|---|
| C-05 / H-01 | blocker:styles/harness 未用 ctx.get() | **非问题** | `styles.insert` 与 `harness.handle/defineTool/registerTool` 是 DSH 动态插件平台注入全局(cordis-plugin-development 技能明列),非 ctx 服务;run-48 当前运行、handlers 齐全即证明解析正常 |
| C-03 / C-04 | major:直接使用 rAF / document 违反沙箱 | **非问题** | 动态 Client 沙箱明确允许 requestAnimationFrame 与 document.querySelector;仅 setTimeout/setInterval 需走 timer 服务 |

### 有效发现(按严重级)
| 级别 | 编号 | 发现 |
|---|---|---|
| major | C-01/C-02 | GraphView 约 490 行、apply 体 899 行、buildLayout 110 行混耦折叠+布局+工具簇 — 单文件动态包的结构性代价,建议按职责抽函数 |
| major | C-14/X-01 | Host `sessiongraph.get` 拍扁字段 ↔ Client `normalizeNode` 重新包装,双端各持一份字段映射,改一端易漏另一端(霰弹式修改) |
| major | H-02 | switchRuns 只增不删,长驻进程随会话累积内存泄漏;建议 subagent/end 后延迟清理或按 sessionId 上限回收 |
| minor | C-10 | `.sg-bob` class 被引用(行 657)但 CSS 无定义 — 遗留死类,应删 |
| minor | C-06 | 30+ 魔法数字(±34/±72/26/22/0.92/1.1 等)散布,布局参数无命名常量 |
| minor | C-07 | CAT 与 dotStyle 两份颜色映射重复维护 |
| minor | C-08 | switch 排序逻辑两处重复 |
| minor | C-13 | 全部 host.call 的 catch(() => {}) 静默吞错,无日志 |
| minor | H-03 | toolDescCache 永不过期 |
| minor | H-05 | projection apply 内 O(n) 反查 turn/tool |
| nit | C-09/C-12/H-04/H-06 | normalizeNode 注释与兜底行为不一致;eslint-disable;console.log 残留;textOf 位置割裂 |

**Standards 一行结论**:无 blocker、无平台违规;有效问题集中在结构性(巨型组件、双端字段映射重复、switchRuns 泄漏),属可整改项,建议按 major 清单逐条处理后再复审。

## Spec 轴

### 12 条需求逐条核对
| # | 需求 | 状态 |
|---|---|---|
| 1 | 删除 conversation.view tab,图谱入侧边栏 | ✅ 仅注册 details + shell.overlay,无 tab |
| 2 | 左对话右图谱底部输入框(融为一体) | ✅ 真实 details 列(宿主三列 grid) |
| 3 | Obsidian 式:不直上直下、拉开间距、边常显 | ✅ buildLayout lateral 横向漂移 ±34 蜿蜒 + 常显贝塞尔边 |
| 4 | 工具原子默认常显,无按钮切换 | ✅ 无 toggle 代码 |
| 5 | 双击不进全图 | ✅ 无 dblclick 绑定,fitAll 仅按钮触发 |
| 6 | × = 收起;收起后精简时间线;对话区恢复 | ✅ closeDetails() 释放列宽 + SlimOverlay 纯圆点 |
| 7 | 收掉贴最右 / 别太抽象 | ✅ fixed right:0 + 时间线 + 类别配色 |
| 8 | 全原子跳转(含工具/委派/回合) | ✅ 6 类原子全部映射 conversationContextKey 锚点 |
| 9 | 用户轮次折叠 + 消息缩略 + 可展开 | ✅ roundOf/roundSnippet/toggleFold 翻转生效态 |
| 10 | 面板壳照抄左侧栏 | ✅ sidebar-fill + 36px header + ghost 按钮 |
| 11 | 悬停抖动修复 | ✅ r+10 透明命中圈 + 过渡动画 |
| 12 | 拖拽卡顿修复 | ✅ React.memo 比较器 + ResizeObserver 150ms 节流 + 拖拽期跳帧 |

### 范围蔓延(可接受)
- `sessiongraph_debug` 调试工具、`sessiongraph.get/switches/toolinfo` RPC — 均为实现上述需求的必要支撑,非用户未要的独立功能。

### 回归风险(需关注,非阻塞)
- 折叠状态与 SlimOverlay 显隐均由 400ms/1000ms 轮询驱动,框架属性时机错位时可能短暂不同步;轮询间隔可放宽或后续改事件驱动。
- 投影 v5 与 useProjection 契约依赖宿主版本,宿主升级时需回归。
- React.memo 浅比较依赖投影 immutable 语义,当前成立。

**Spec 一行结论**:12 条需求全部满足,无缺失无违背;范围蔓延受控;主要风险是轮询驱动架构的性能与同步性,演示规模可接受。
