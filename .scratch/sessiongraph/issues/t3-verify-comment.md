# T3 验证结论(2026-08-14)— 已细化并关闭

> 对应 GitHub issue #3。HITL 方向修订:用户推翻"横向时间线 + aihero 灰阶纸张"方向,
> 改为 **Obsidian 式横向编织图谱**(见 #6 地图 Notes 决策定型)。本票按修订后方向验收,随 #6 地图实现(pkg-1 → pkg-62,当前 pkg-62/run-51)。

## 验收核对(修订后标准,全部达成)

- [x] 多轮会话渲染为横向编织图谱,不直上直下:伪随机引力横向漂移(`lateralOf`,相邻受限 ±34、上限 ±72)+ 主线弯曲贝塞尔边常显(Obsidian 式,非默认无连线)
- [x] 按用户轮次折叠:每次用户消息 = 一个可折叠轮次,旧轮默认折叠,折叠态显示用户消息缩略 + 条数,点击展开/再点收起(`toggleFold` 翻转生效态);switch 节点(委派,T2 数据)独立渲染可跳转
- [x] 视觉:灰阶圆节点(类别配色,user/context/assistant/tool/switch/turn)、等宽标签(ui-monospace)、跟随 DSH 主题;面板壳照抄左侧栏(sidebar-fill 背景、36px header、ghost 按钮)
- [x] 新节点生长动画(`sgGrow`);滚轮缩放(0.02–4x)/拖拽平移/节点拖拽(子簇跟随)/定位/全图按钮
- [x] 性能与健壮性:React.memo(GraphView) + ResizeObserver 150ms 节流 + 拖拽期跳帧;透明命中圈修复原子边缘悬停抖动;`LAYOUT`/`POLL` 命名常量;`fanOut`/`lateralOf`/`sortRuns` 纯函数拆分

## 遗留(移入 #6 地图 Not yet specified)

- 长会话性能/虚拟化(fog)— 依赖原型实测
- 分支会话上下展开 — 当前单会话线性

## Blocked by

- #1、#2 均已关闭(已满足)
