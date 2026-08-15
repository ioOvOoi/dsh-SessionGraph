# dsh-sessiongraph

SessionGraph:DSH 实时会话图谱插件。把当前会话渲染成 **Obsidian 式横向编织图谱**,常驻右侧 `details` 布局列——节点 = 每条消息 + 每次 agent 切换,支持点击原子跳转聊天对应消息、用户轮次折叠、缩放/平移/拖拽、委派(子 agent)标记、收起为右侧精简时间线窄条。

## 安装

要求:DSH 0.1.0-rc.6 或更高(web profile)。

```bash
# 在 DSH 所在的机器上,安装到你的 profile(以 web 为例)
dsh plugin --profile web add github:ioOvOoi/dsh-SessionGraph#v0.1.4
```

安装完成后 **重启 dsh**(本包声明 `dsh.bundle`,安装器会自动把它加入 profile 的 bundles 并挂载插件行,**无需手动编辑任何配置**)。

### 手动挂载(若你的 DSH 版本未自动调和 bundles)

在 `~/.dsh/profiles/<name>/cordis.patch.yml` 中追加:

```yaml
- insert:
    - id: sessiongraph
      name: 'dsh-sessiongraph'
```

然后重启 dsh。

## 功能

- **完整图谱**:消息/上下文/助手/工具/回合/委派/跳转摘要 7 类节点,Obsidian 式横向编织布局,常显弯曲边,新节点生长动画
- **全原子跳转**:点击任意节点定位到聊天对应消息(锚点 + 金环闪烁)
- **用户轮次折叠**:每次用户消息 = 一个可折叠轮次,旧轮默认折叠,点击展开/收起
- **操作原子**:点击节点弹出「± 折叠/展开该轮」「✕ 关闭」小原子(与工具原子同款视觉与扇形排列)
- **交互**:滚轮缩放、拖拽平移、节点拖拽(子簇跟随)、定位/全图按钮
- **收起**:点「⟩」收起为右侧精简时间线(纯圆点,点击跳转),对话区宽度恢复
- **委派标记**:subagent 切换显示为独立节点(委派→childId)
- **遮蔽展示**:历史 jump 摘要(分支切换)只读展示

## 已知边界

- **无 jump(切枝)功能**:本静态版不含"切到这里继续"(B1 遮蔽+继续)功能——动态插件版本才有,该功能整体暂停,后续另行讨论
- 精简时间线数据经模块级共享对象桥接(官方 `shell.overlay` 槽位不提供投影 hooks),会话切换时以图谱面板数据为准

## 开发

纯 JavaScript,无构建步骤;仓库根即插件包(`lib/index.js` Host 半体 + `lib/client.js` Client 半体)。

## 卸载

```bash
dsh plugin --profile web remove dsh-sessiongraph
```

## License

MIT
