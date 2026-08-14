return {
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return

    styles.insert(`
/* 面板壳 = 左侧栏同款 */
.sg-root{display:flex;flex-direction:column;height:100%;padding:6px 8px 10px;gap:4px;box-sizing:border-box;user-select:none;-webkit-user-select:none;background:var(--dsw-specific-sidebar-fill);}
.sg-header{height:36px;flex:none;display:flex;align-items:center;gap:4px;color:var(--dsw-alias-label-tertiary);padding-left:4px;box-sizing:border-box;}
.sg-title{font-size:14px;line-height:20px;font-weight:500;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.sg-count{font-size:12px;line-height:17px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;}
.sg-header .sg-spacer{flex:1;}
.sg-btn{height:24px;color:var(--dsw-alias-label-secondary);background:0 0;border:none;border-radius:8px;padding:0 8px;font-size:12px;line-height:16px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;}
.sg-btn:hover{background:var(--dsw-alias-interactive-bg-hover);}
.sg-close{width:28px;height:28px;border-radius:50%;padding:0;font-size:14px;}
.sg-canvas{flex:1;min-height:0;background:transparent;}
.sg-graph{display:block;width:100%;height:100%;cursor:grab;user-select:none;-webkit-user-select:none;background:transparent;}
.sg-graph.sg-panning{cursor:grabbing;}
.sg-node{animation:sgGrow .45s ease-out;transform-box:fill-box;transform-origin:center;cursor:pointer;transition:opacity .18s ease, transform .18s ease;}
.sg-node.sg-hover{transform:scale(1.08);}
.sg-node.sg-dim{opacity:.32;}
@keyframes sgGrow{from{transform:scale(.1);opacity:0}to{transform:scale(1);opacity:1}}
.sg-pulse{animation:sgPulse .55s ease-out forwards;transform-box:fill-box;transform-origin:center;pointer-events:none;}
@keyframes sgPulse{0%{transform:scale(.5);opacity:.9}100%{transform:scale(2.6);opacity:0}}
.sg-cursor-ring{animation:sgCursorPulse 2.2s ease-in-out infinite;transform-box:fill-box;transform-origin:center;pointer-events:none;}
@keyframes sgCursorPulse{0%,100%{opacity:.25;transform:scale(.92)}50%{opacity:.85;transform:scale(1.1)}}
.sg-label{font-family:ui-monospace,Consolas,monospace;font-size:9px;letter-spacing:.08em;fill:#8a8378;pointer-events:none;}
.sg-label-text{font-family:ui-monospace,Consolas,monospace;font-size:8px;letter-spacing:.02em;fill:#6f6a62;pointer-events:none;}
/* 跳转高亮:简洁淡出金环 */
.sg-jump-flash{animation:sgJumpFlash 1.6s ease-out both;}
@keyframes sgJumpFlash{0%{box-shadow:0 0 0 2px rgba(178,147,74,.55), inset 0 0 0 1px rgba(178,147,74,.12)}100%{box-shadow:0 0 0 0 rgba(178,147,74,0), inset 0 0 0 0 rgba(178,147,74,0)}}
/* 收起态:右侧精简时间线窄条(浮层,不占布局) */
.sg-ov-wrap{position:fixed;top:44px;right:0;bottom:44px;width:64px;z-index:990;display:flex;justify-content:flex-end;cursor:pointer;pointer-events:auto;}
.sg-slim{position:relative;width:52px;height:100%;display:flex;flex-direction:column;align-items:center;background:var(--dsw-specific-sidebar-fill);border-left:1px solid var(--dsw-alias-border-l1);box-sizing:border-box;cursor:default;}
.sg-slim-top{height:36px;flex:none;display:flex;align-items:center;justify-content:center;}
.sg-slim-btn{width:28px;height:28px;border-radius:50%;border:none;background:0 0;color:var(--dsw-alias-label-secondary);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font-size:13px;line-height:1;}
.sg-slim-btn:hover{background:var(--dsw-alias-interactive-bg-hover);}
.sg-slim-track{position:relative;flex:1;min-height:0;width:100%;display:flex;flex-direction:column;align-items:center;gap:8px;padding:6px 0 12px;overflow-y:auto;overflow-x:hidden;}
.sg-slim-track::before{content:'';position:absolute;top:0;bottom:0;left:50%;width:1px;background:var(--dsw-alias-border-l2);pointer-events:none;}
.sg-slim-dot{position:relative;z-index:1;flex:none;border-radius:50%;cursor:pointer;transition:transform .12s ease;box-sizing:border-box;}
.sg-slim-dot:hover{transform:scale(1.6);}
.sg-slim-dot.sg-cur{box-shadow:0 0 0 2px var(--dsw-specific-sidebar-fill), 0 0 0 3px #b2954a;}
`)

    const reasonText = (reason) => {
      if (reason == null) return '?'
      if (typeof reason === 'object') return reason.kind != null ? String(reason.kind) : JSON.stringify(reason)
      return String(reason)
    }

    // T5: jump 失败 reason → 中文提示文案
    const jumpFailText = (reason) => {
      if (reason === 'busy') return '当前回合进行中，稍后重试'
      if (reason === 'nothing-to-shadow') return '被放弃内容太少，无需切换'
      if (reason === 'surface-stale') return '会话状态同步中，稍后重试'
      if (reason === 'anchor-not-found') return '目标节点不可用'
      if (reason === 'surface-empty') return '会话图谱为空，无法切换'
      if (reason === 'session-not-found') return '会话不存在'
      if (reason && typeof reason === 'string' && reason.startsWith('append-failed')) return '写入失败: ' + reason
      return reasonText(reason)
    }

    const CAT = {
      user: { label: 'USER', fill: '#8f8f8f', r: 16 },
      context: { label: 'CTX', fill: '#d6d6d6', r: 6, stroke: '#b8b8b8' },
      assistant: { label: 'ASST', fill: '#232323', r: 9 },
      tool: { label: 'TOOL', fill: '#c9c9c9', r: 5 },
      turn: { label: 'TURN', fill: 'none', r: 3 },
      switch: { label: '委派', fill: '#e5ddd0', r: 7, stroke: '#a89f8f' },
      // pkg-63: jump 摘要节点样式
      jump: { label: 'JUMP', fill: '#d8d0c0', r: 8, stroke: '#a89f8f' },
    }
    const radiusOf = (n) => {
      switch (n.category) {
        case 'user': return 16
        case 'context': return 6
        case 'tool': return 5
        case 'turn': return 3
        case 'switch': return 7
        case 'jump': return 8
        case 'assistant': {
          const t = n.meta && n.meta.usage ? (n.meta.usage.inputTokens || 0) + (n.meta.usage.outputTokens || 0) : 0
          const len = n.text ? n.text.length : 0
          const imp = t > 0 ? Math.min(2, Math.round(Math.log2(1 + t) * 0.4)) : Math.min(2, Math.round(len / 300))
          return 9 + imp
        }
        default:
          return 7
      }
    }
    const snippet = (s, n) => {
      const t = (s || '').replace(/\s+/g, ' ').trim()
      return t.length > n ? t.slice(0, n) + '…' : t
    }
    const labelOf = (n, toolInfo) => {
      if (n.category === 'user') return snippet(n.text, 18) || 'USER'
      if (n.category === 'context') {
        const p = n.meta && n.meta.plugin ? String(n.meta.plugin) : ''
        return '上下文注入' + (p ? '·' + p.slice(0, 14) : '')
      }
      if (n.category === 'assistant') return (n.meta && n.meta.think ? '思考 ' : '') + (snippet(n.text, 18) || 'ASST')
      if (n.category === 'tool') {
        const desc = toolInfo && toolInfo[n.meta.name] ? toolInfo[n.meta.name] : null
        const base = desc || n.meta.name || 'TOOL'
        const st = n.meta.result ? (n.meta.error ? ' ✗' : '') : ' 运行中…'
        return snippet(base, 16) + st
      }
      // pkg-63: jump 节点标签显示摘要缩略 + 禁止符号
      if (n.category === 'jump') return '分支切换 ' + snippet(n.meta.summary || n.text, 16) + ' ⛔'
      return CAT[n.category] ? CAT[n.category].label : ''
    }

    // RPC 与投影共用同一节点形状(本体自带 meta);此处仅兜底:极端缺 meta 时补空对象
    const normalizeNode = (n) => (n && n.meta ? n : { ...n, meta: {} })

    // items 构建(含委派节点插入),完整图与精简时间线共用
    const buildItems = (normBase, runs) => {
      let runIdx = 0
      const items = []
      for (const n of normBase) {
        items.push(n)
        if (n.category === 'tool' && n.meta && n.meta.name === 'subagent' && runs[runIdx]) {
          const r = runs[runIdx]
          runIdx += 1
          items.push({
            id: 'sw-' + r.runId,
            category: 'switch',
            seq: n.seq + 0.5,
            time: r.startedAt,
            text: '',
            meta: { childId: r.childId, provider: r.provider, stopReason: r.stopReason, runId: r.runId, callId: n.meta.callId },
          })
        }
      }
      return items
    }

    // ===== 布局与交互常量(Obsidian 式蜿蜒 / 工具扇形 / 轮询节流) =====
    const LAYOUT = {
      LATERAL_STEP: 34,   // 相邻节点横向漂移上限(蜿蜒感)
      LATERAL_MAX: 72,    // 相对主轴的最大横向偏移
      NODE_GAP: 26,       // 相邻节点纵向间距基数
      TURN_MARKER_X: -30, // 未折叠回合标记的横向位置
      EDGE_CURVE: 14,     // 主线贝塞尔弯曲幅度
      FAN_X0: 26,         // 工具簇起始距助手距离
      FAN_DX: 22,         // 工具簇逐节点左移增量
      FAN_DY: 18,         // 工具簇纵向展开间距
      SWITCH_DX: 6,       // 委派节点相对工具簇额外左移
      SWITCH_DY: 8,       // 委派节点相对工具簇额外下移
      FOLD_KEEP: 2,       // 最近 N 轮用户消息默认不折叠
      HIT_PAD: 10,        // 节点透明命中圈外扩半径(防悬停抖动)
    }
    const POLL = { COLLAPSED_MS: 400, DATA_MS: 1000, RESIZE_MS: 150 }
    // T5: 交互原子超时常量
    const ACT_TIMEOUT_MS = 3000  // 交互原子 3 秒无操作自动消失
    const ACT_MSG_MS = 2500      // jump 失败提示 2.5 秒后消失

    // 委派记录按开始时间升序(完整图与精简条共用)
    const sortRuns = (arr) => (arr || []).slice().sort((a, b) => a.startedAt - b.startedAt)

    // ===== 跳转:全部原子 → 聊天锚点(公共) =====
    const mOf = (n) => (n && n.meta ? n.meta : n)
    const turnKey = (t, items) => {
      if (t == null) return null
      const tail = '9:turn-tail' + t
      if (document.querySelector('[data-chat-anchor-key="' + tail + '"]')) return tail
      const first = items.find((it) => {
        if (it.category === 'turn') return false
        const tm = mOf(it)
        return tm.turn === t && (it.category === 'user' || it.category === 'context' || it.category === 'assistant')
      })
      if (first) {
        const k = keyOfNode(first, items)
        return k || tail
      }
      return tail
    }
    const keyOfNode = (n, items) => {
      if (n.category === 'user' || n.category === 'context') return '12:input-message' + n.id
      if (n.category === 'assistant') {
        const m = mOf(n)
        if (m.step != null) return '14:assistant-step' + m.turn + ':' + m.step
        return turnKey(m.turn, items)
      }
      if (n.category === 'tool') return '9:tool-call' + mOf(n).callId
      if (n.category === 'switch') return mOf(n).callId ? '9:tool-call' + mOf(n).callId : null
      if (n.category === 'turn') return turnKey(mOf(n).turn, items)
      // pkg-63: jump 节点跳转到对应 anchor 的聊天位置
      if (n.category === 'jump') return turnKey(mOf(n).turn, items)
      return null
    }
    const scrollToKey = (key) => {
      if (!key) return
      const el = document.querySelector('[data-chat-anchor-key="' + key + '"]')
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.remove('sg-jump-flash')
      void el.offsetWidth
      el.classList.add('sg-jump-flash')
      const timer = ctx.get('timer')
      if (timer) timer.timeout(() => el.classList.remove('sg-jump-flash'), 1700)
    }
    const jumpNode = (n, items) => scrollToKey(keyOfNode(n, items))

    // ===== Obsidian 式布局:时间顺序(新在下)+ 引力漂移(横向蜿蜒)+ 常显弯曲边 =====
    const hashOf = (s) => {
      let h = 0
      for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
      return Math.abs(h)
    }
    // 工具簇扇形展开:围绕所属助手向左侧散开(纵向拉开展),返回子簇映射与栈序号
    const fanOut = (items, restPos) => {
      const childMap = {}
      const byId = {}
      let lastAsst = null
      for (const n of items) {
        byId[n.id] = n
        if (n.category === 'assistant') lastAsst = n.id
        else if ((n.category === 'tool' || n.category === 'switch') && lastAsst) {
          const s = childMap[lastAsst] || (childMap[lastAsst] = [])
          s.push(n.id)
        }
      }
      const stackIdx = {}
      for (const aid of Object.keys(childMap)) {
        const bp = restPos[aid]
        if (!bp) continue
        const arr = childMap[aid]
        const n = arr.length
        arr.forEach((tid, k) => {
          stackIdx[tid] = k
          const t = byId[tid]
          const fanY = n === 1 ? 0 : (k - (n - 1) / 2) * LAYOUT.FAN_DY
          restPos[tid] = {
            x: bp.x - (LAYOUT.FAN_X0 + k * LAYOUT.FAN_DX + (t && t.category === 'switch' ? LAYOUT.SWITCH_DX : 0)),
            y: bp.y + fanY + (t && t.category === 'switch' ? LAYOUT.SWITCH_DY : 0),
          }
        })
      }
      return { childMap, stackIdx }
    }
    // 折叠单位 = 用户对话轮次:roundKey = 该轮用户消息 id
    const buildLayout = (items, roundOf, turnRound, roundSnippet, effFoldKey) => {
      // T5: segCount 只统计非遮蔽节点(折叠摘要的"N 条"不含不可见节点)
      const segCount = {}
      for (const it of items) {
        if (it.meta && it.meta.shadowed) continue
        const k = roundOf[it.id]
        if (k) segCount[k] = (segCount[k] || 0) + 1
      }

      const chain = []
      for (const it of items) {
        // T5: 遮蔽节点不参与布局链(被 jump 摘要节点替代)
        if (it.meta && it.meta.shadowed) continue
        if (it.category === 'tool' || it.category === 'switch') continue
        if (it.category === 'turn') {
          const rk = turnRound[it.id]
          if (rk && effFoldKey(rk)) {
            chain.push({
              id: it.id,
              category: 'turn-summary',
              meta: { turn: it.meta.turn, roundKey: rk, snippet: roundSnippet[rk] || '' },
              seq: it.seq,
              time: it.time,
            })
          }
          continue
        }
        const rk = roundOf[it.id]
        if (rk && effFoldKey(rk)) continue
        chain.push(it)
      }

      // 引力漂移:按节点 id 散列向两侧漂移,幅度随半径增大 → 蜿蜒而非直线
      const lateralOf = (n, r) => ((hashOf(n.id) % 1000) / 1000 - 0.5) * (r + 8) * 3
      const spineIdx = {}
      const restPos = {}
      let cy = 0
      const rOfChain = (n) => (n.category === 'turn-summary' ? 16 : radiusOf(n))
      const nodeH = (n) => 2 * rOfChain(n) + LAYOUT.NODE_GAP
      let prevX = 0
      chain.forEach((n, i) => {
        const r = rOfChain(n)
        let x = i === 0 ? lateralOf(n, r) : Math.max(prevX - LAYOUT.LATERAL_STEP, Math.min(prevX + LAYOUT.LATERAL_STEP, lateralOf(n, r)))
        x = Math.max(-LAYOUT.LATERAL_MAX, Math.min(LAYOUT.LATERAL_MAX, x))
        prevX = x
        spineIdx[n.id] = i
        restPos[n.id] = { x, y: cy }
        const h1 = nodeH(n)
        const h2 = i + 1 < chain.length ? nodeH(chain[i + 1]) : h1
        cy += (h1 + h2) / 2
      })

      const chainIds = new Set(chain.map((c) => c.id))
      const turnMarkerY = {}
      const turnHead = {}
      for (let i = 0; i < items.length; i++) {
        const it = items[i]
        if (it.category !== 'turn' || !turnRound[it.id] || effFoldKey(turnRound[it.id])) continue
        let after = null
        for (let j = i + 1; j < items.length; j++) {
          if (chainIds.has(items[j].id)) { after = items[j]; break }
        }
        const y = after ? restPos[after.id].y : (chain.length ? cy : 0)
        turnMarkerY[it.id] = y
        turnHead[it.id] = after
        restPos[it.id] = { x: LAYOUT.TURN_MARKER_X, y }
      }

      // 工具簇扇形展开(独立纯函数):围绕所属助手向左侧散开,纵向拉开展
      const { childMap, stackIdx } = fanOut(items, restPos)

      const edges = []
      for (let i = 1; i < chain.length; i++) {
        edges.push({ a: chain[i - 1].id, b: chain[i].id, curve: (i % 2 === 0 ? 1 : -1) * LAYOUT.EDGE_CURVE })
      }
      for (const id of Object.keys(turnHead)) {
        const h = turnHead[id]
        if (h) edges.push({ a: id, b: h.id, dash: true })
      }
      for (const aid of Object.keys(childMap)) {
        for (const tid of childMap[aid]) edges.push({ a: aid, b: tid })
      }

      return { spineIdx, restPos, segCount, turnMarkerY, childMap, stackIdx, edges }
    }

    // ===== pkg-67: 公共渲染函数 — tool/switch/操作原子共用 =====
    //   封装 tool 风格原子的完整渲染(circle + text),所有原子类型复用此函数
    //   关键:onClick 内 stopPropagation,防止事件冒泡到父级节点的 onClick
    const renderToolAtom = (x, y, r, fill, stroke, dash, iconText, title, onClick, disabled, key) => {
      const elems = []
      // 透明命中圈(扩大可点击区域,与节点 HIT_PAD 同理)
      elems.push(React.createElement('circle', {
        key: key + '-hit', cx: x, cy: y, r: r + LAYOUT.HIT_PAD, fill: 'transparent',
        // 禁用态:pointer-events:none 内联,不新增 CSS class
        style: disabled ? { pointerEvents: 'none' } : undefined,
        onClick: (e) => { e.stopPropagation(); if (!disabled && onClick) onClick(e) },
        title: title,
      }))
      // 主体圆(复用 tool 或 switch 视觉)
      elems.push(React.createElement('circle', {
        key: key + '-c', cx: x, cy: y, r: r,
        fill: fill,
        stroke: stroke || 'none', strokeWidth: stroke ? 1.5 : 0,
        strokeDasharray: dash || undefined,
        // 禁用态:opacity .35 + pointer-events:none
        style: disabled ? { opacity: 0.35, pointerEvents: 'none' } : undefined,
        onClick: (e) => { e.stopPropagation(); if (!disabled && onClick) onClick(e) },
      }))
      // 图标文字(SVG text, pointer-events:none,复用 sg-label-text 样式)
      elems.push(React.createElement('text', {
        key: key + '-t', x: x, y: y + 3,
        textAnchor: 'middle',
        className: 'sg-label-text',
        style: { pointerEvents: 'none', fontSize: '9px', fill: disabled ? '#b0a89a' : '#6f6a62' },
      }, iconText))
      return elems
    }

    // ===== 完整图谱组件(数据注入:base/cursor 来自 props;所有原子点击跳转对话) =====
    const GraphView = ({ sessionId, base, cursor, onCollapse }) => {
      const [switches, setSwitches] = React.useState([])
      const [toolInfo, setToolInfo] = React.useState(null)
      const [selectedId, setSelectedId] = React.useState(null)
      const [hoverId, setHoverId] = React.useState(null)
      const [folded, setFolded] = React.useState({})
      const [view, setView] = React.useState(null)
      const [size, setSize] = React.useState({ w: 400, h: 500 })
      const [panning, setPanning] = React.useState(false)
      const [dragId, setDragId] = React.useState(null)
      const [live, setLive] = React.useState(null)
      const [pulseKey, setPulseKey] = React.useState(0)
      // T5: 交互原子状态
      const [pendingJump, setPendingJump] = React.useState(null)
      const [jumpMsg, setJumpMsg] = React.useState(null)
      const svgRef = React.useRef(null)
      const panRef = React.useRef(null)
      const pendRef = React.useRef(null)
      const memoRef = React.useRef(null)
      const interactRef = React.useRef(0)
      const viewRef = React.useRef(null)
      const sizeRef = React.useRef({ w: 400, h: 500 })
      // T5: 超时清理引用
      const pendingJumpTimerRef = React.useRef(null)
      const jumpMsgTimerRef = React.useRef(null)

      React.useEffect(() => {
        viewRef.current = view
      }, [view])

      // 投影节点自带 meta;扁平 RPC 节点兜底归一化
      const normBase = base.map((n) => (n && n.meta ? n : normalizeNode(n)))

      // 会话切换:重置视图状态
      React.useEffect(() => {
        setView(null)
        setLive(null)
        setFolded({})
        setSelectedId(null)
        // T5: 切换会话时清除交互原子
        setPendingJump(null)
        setJumpMsg(null)
        if (pendingJumpTimerRef.current) { pendingJumpTimerRef.current(); pendingJumpTimerRef.current = null }
        if (jumpMsgTimerRef.current) { jumpMsgTimerRef.current(); jumpMsgTimerRef.current = null }
      }, [sessionId])

      React.useEffect(() => {
        let alive = true
        host.call('sessiongraph.switches', { sessionId: String(sessionId) })
          .then((res) => { if (alive && res && Array.isArray(res.switches)) setSwitches(res.switches) })
          .catch(() => {})
        host.call('sessiongraph.toolinfo', { sessionId: String(sessionId) })
          .then((res) => { if (alive && res && typeof res.tools === 'object') setToolInfo(res.tools) })
          .catch(() => {})
        return () => { alive = false }
      }, [base, sessionId])

      const runs = sortRuns(switches)
      const items = buildItems(normBase, runs)

      let maxTurn = 0
      for (const it of items) if (it.category === 'turn' && it.meta.turn > maxTurn) maxTurn = it.meta.turn

      // T5: 运行中判定 — tool 节点初始 result:false 即运行中,完成才 true
      const running = items.some((it) => it.category === 'tool' && !(it.meta && it.meta.result))

      // ===== 用户轮次模型:每次用户消息 = 一个可折叠轮次 =====
      const userIdx = []
      for (let i = 0; i < items.length; i++) if (items[i].category === 'user') userIdx.push(i)
      const roundsInOrder = userIdx.map((i) => items[i].id)
      const roundOf = {}
      for (let i = 0; i < items.length; i++) {
        const it = items[i]
        if (it.category === 'turn') continue
        let pick = -1
        for (const u of userIdx) {
          if (u <= i) pick = u
          else break
        }
        if (pick === -1 && userIdx.length) pick = userIdx[0]
        roundOf[it.id] = pick === -1 ? null : items[pick].id
      }
      const turnRound = {}
      const roundSnippet = {}
      for (const it of items) {
        if (it.category === 'turn') {
          const first = items.find((x) => x.category === 'user' && x.meta && x.meta.turn === it.meta.turn)
          turnRound[it.id] = first ? first.id : 'turn-' + it.meta.turn
        }
        if (it.category === 'user') {
          roundSnippet[it.id] = snippet(it.text, 14) || '用户消息'
        }
      }

      const defaultFoldForKey = (k) => {
        if (!k) return false
        if (k.slice(0, 5) === 'turn-') {
          const n = parseInt(k.slice(5), 10)
          return !isNaN(n) && n < maxTurn - 1
        }
        const idx = roundsInOrder.indexOf(k)
        return !isNaN(idx) && idx >= 0 ? idx < roundsInOrder.length - LAYOUT.FOLD_KEEP : false
      }
      const effFoldKey = (k) => (k != null && folded[k] !== undefined ? folded[k] : defaultFoldForKey(k))
      const toggleFold = (key) => {
        setFolded((f) => {
          const cur = f[key] !== undefined ? f[key] : defaultFoldForKey(key)
          const nf = { ...f }
          nf[key] = !cur
          return nf
        })
      }

      const foldKey = roundsInOrder.map((k) => (effFoldKey(k) ? '1' : '0')).join('')
        + ':' + items.filter((t) => t.category === 'turn' && turnRound[t.id] && turnRound[t.id].slice(0, 5) === 'turn-')
          .map((t) => (effFoldKey(turnRound[t.id]) ? '1' : '0')).join('')
      const sig = base.length + ':' + (cursor || '') + ':' + runs.length + ':' + (runs.length ? runs[runs.length - 1].runId : '') + ':' + foldKey
      if (!memoRef.current || memoRef.current.sig !== sig) {
        memoRef.current = { sig, ...buildLayout(items, roundOf, turnRound, roundSnippet, effFoldKey) }
      }
      const L = memoRef.current

      const cursorIdx = L.spineIdx[cursor] != null ? L.spineIdx[cursor] : -1
      const visible = items.filter((n) => {
        // T5: 遮蔽节点不渲染在主轴(由 jump 摘要节点替代)
        if (n.meta && n.meta.shadowed) return false
        if (n.category === 'turn') return true
        if (n.category === 'switch') return folded['sw-' + n.meta.runId] !== true
        const rk = roundOf[n.id]
        return rk == null || effFoldKey(rk) !== true
      })
      const shown = new Set(visible.map((n) => n.id))
      const neighborOf = (id) => {
        const set = new Set()
        for (const e of L.edges) {
          if (e.a === id) set.add(e.b)
          if (e.b === id) set.add(e.a)
        }
        return Array.from(set).filter((x) => shown.has(x))
      }
      const eff = (id) => (live && live[id]) || L.restPos[id]

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const n of visible) {
        const p = eff(n.id)
        if (!p) continue
        const r = radiusOf(n) + 26
        if (p.x - r < minX) minX = p.x - r
        if (p.y - r < minY) minY = p.y - r
        if (p.x + r > maxX) maxX = p.x + r
        if (p.y + r > maxY) maxY = p.y + r
      }
      if (!isFinite(minX)) { minX = -90; minY = -40; maxX = 160; maxY = 40 }
      const bw = maxX - minX
      const bh = maxY - minY

      // 尺寸测量:ResizeObserver + 150ms 节流,拖拽期间不重渲染
      React.useEffect(() => {
        const el = svgRef.current
        if (!el) return
        let alive = true
        let ro = null
        let pending = false
        const measure = () => {
          const cw = el.clientWidth
          const ch = el.clientHeight
          if (!cw || !ch) return
          sizeRef.current = { w: cw, h: ch }
          setSize({ w: cw, h: ch })
          if (viewRef.current == null) {
            const fitZ = Math.min(cw / bw, ch / bh) * 0.92
            const z = Math.max(fitZ, 1.1)
            const cp = cursor ? L.restPos[cursor] : null
            const tcx = cp ? cp.x : 0
            const tcy = cp ? cp.y : 0
            const nv = { z, tx: cw / 2 - tcx * z, ty: ch * 0.78 - tcy * z }
            viewRef.current = nv
            setView(nv)
          }
        }
        measure()
        if (typeof ResizeObserver !== 'undefined') {
          ro = new ResizeObserver(() => {
            if (pending) return
            pending = true
            const timer = ctx.get('timer')
            const fire = () => { pending = false; if (alive) measure() }
            if (timer) timer.timeout(fire, POLL.RESIZE_MS)
            else fire()
          })
          ro.observe(el)
        }
        return () => { alive = false; if (ro) ro.disconnect() }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [bw, bh])

      React.useEffect(() => {
        if (!view || !cursor || !L.restPos[cursor]) return
        if (Date.now() - interactRef.current < 800) return
        const cp = L.restPos[cursor]
        const sx = cp.x * view.z + view.tx
        const needX = sx < size.w * 0.1 || sx > size.w * 0.9
        setView((v) => v ? {
          ...v,
          tx: needX ? size.w / 2 - cp.x * v.z : v.tx,
          ty: size.h * 0.78 - cp.y * v.z,
        } : v)
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [base])

      React.useEffect(() => {
        const el = svgRef.current
        if (!el) return
        const onWheel = (e) => {
          e.preventDefault()
          interactRef.current = Date.now()
          setView((v) => {
            if (!v) return v
            const factor = Math.pow(1.1, -e.deltaY / 100)
            const z = Math.min(4, Math.max(0.02, v.z * factor))
            const k = z / v.z
            const cxp = (size.w / 2 - v.tx) / v.z
            const cyp = (size.h / 2 - v.ty) / v.z
            return { z, tx: size.w / 2 - cxp * z, ty: size.h / 2 - cyp * z }
          })
        }
        el.addEventListener('wheel', onWheel, { passive: false })
        return () => el.removeEventListener('wheel', onWheel)
      }, [size])

      React.useEffect(() => {
        if (dragId != null || live == null) return
        let raf = 0
        const tick = () => {
          setLive((lv) => {
            if (!lv) return null
            const next = {}
            let moved = false
            for (const id of Object.keys(lv)) {
              const cur = lv[id]
              const rest = L.restPos[id]
              if (!rest) { next[id] = cur; continue }
              const nx = cur.x + (rest.x - cur.x) * 0.1
              const ny = cur.y + (rest.y - cur.y) * 0.1
              next[id] = { x: nx, y: ny }
              if (Math.abs(nx - rest.x) > 0.4 || Math.abs(ny - rest.y) > 0.4) moved = true
            }
            return moved ? next : null
          })
          raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(raf)
      }, [dragId, live, bw, bh])

      // T5: 交互原子超时自动消失(组件卸载或 pendingJump 变化时清理旧定时器)
      //   使用 ctx.get('timer').timeout 替代全局 setTimeout,返回 dispose 函数
      React.useEffect(() => {
        if (pendingJumpTimerRef.current) { pendingJumpTimerRef.current(); pendingJumpTimerRef.current = null }
        if (jumpMsgTimerRef.current) { jumpMsgTimerRef.current(); jumpMsgTimerRef.current = null }
        setJumpMsg(null)
        if (pendingJump) {
          const timer = ctx.get('timer')
          if (timer) {
            pendingJumpTimerRef.current = timer.timeout(() => { setPendingJump(null); pendingJumpTimerRef.current = null }, ACT_TIMEOUT_MS)
          }
        }
        return () => {
          if (pendingJumpTimerRef.current) { pendingJumpTimerRef.current(); pendingJumpTimerRef.current = null }
          if (jumpMsgTimerRef.current) { jumpMsgTimerRef.current(); jumpMsgTimerRef.current = null }
        }
      }, [pendingJump])

      const tf = view ? 'translate(' + view.tx + 'px, ' + view.ty + 'px) scale(' + view.z + ')' : ''
      const z = view ? view.z : 1
      const showLabels = z > 0.38
      const focusId = hoverId || selectedId
      const neighborSet = new Set()
      if (focusId != null && L.restPos[focusId]) {
        for (const nb of neighborOf(focusId)) neighborSet.add(nb)
      }

      const inView = (p, id) => {
        if (!p) return false
        if (id === cursor || id === focusId) return true
        const sx = p.x * z + (view ? view.tx : 0)
        const sy = p.y * z + (view ? view.ty : 0)
        return sx > -160 && sx < size.w + 160 && sy > -160 && sy < size.h + 160
      }

      const focusCursor = () => {
        interactRef.current = Date.now()
        const cp = cursor ? L.restPos[cursor] : null
        if (!view) return
        const fitZ = Math.min(size.w / bw, size.h / bh) * 0.92
        const nz = Math.max(fitZ, 1.1)
        const tcx = cp ? cp.x : 0
        const tcy = cp ? cp.y : 0
        setView({ z: nz, tx: size.w / 2 - tcx * nz, ty: size.h * 0.78 - tcy * nz })
      }
      const fitAll = () => {
        interactRef.current = Date.now()
        const nz = Math.min(size.w / bw, size.h / bh) * 0.92
        setView({ z: nz, tx: (size.w - bw * nz) / 2, ty: (size.h - bh * nz) / 2 })
      }

      // T5: 确认切枝 → host.call sessiongraph.jump
      const confirmJump = (e) => {
        e.stopPropagation()
        if (!pendingJump) return
        if (running) return
        const anc = pendingJump.anchorSeq
        const timer = ctx.get('timer')
        setJumpMsg(null)
        if (jumpMsgTimerRef.current) { jumpMsgTimerRef.current(); jumpMsgTimerRef.current = null }
        host.call('sessiongraph.jump', { sessionId: String(sessionId), anchorSeq: anc })
          .then((res) => {
            if (res && res.ok) {
              setPendingJump(null)
              if (pendingJumpTimerRef.current) { pendingJumpTimerRef.current(); pendingJumpTimerRef.current = null }
            } else {
              const reason = res ? res.reason : null
              const msg = jumpFailText(reason)
              setJumpMsg(msg)
              // 失败提示定时消失;timer 缺失时降级为不设超时(文案需手动关闭,可接受)
              if (timer) {
                jumpMsgTimerRef.current = timer.timeout(() => { setJumpMsg(null); jumpMsgTimerRef.current = null }, ACT_MSG_MS)
              }
            }
          })
          .catch(() => {
            setJumpMsg('跳转失败')
            if (timer) {
              jumpMsgTimerRef.current = timer.timeout(() => { setJumpMsg(null); jumpMsgTimerRef.current = null }, ACT_MSG_MS)
            }
          })
      }
      // T5: 取消切枝
      const cancelJump = (e) => {
        e.stopPropagation()
        setPendingJump(null)
        if (pendingJumpTimerRef.current) { pendingJumpTimerRef.current(); pendingJumpTimerRef.current = null }
      }

      const children = []

      // 常显边(Obsidian 式):主线弯曲贝塞尔,回合/工具连线直连;悬停/选中时增强
      for (const e of L.edges) {
        const pa = eff(e.a)
        const pb = eff(e.b)
        if (!pa || !pb) continue
        const onF = focusId != null && (e.a === focusId || e.b === focusId)
        if (e.curve) {
          const mx = (pa.x + pb.x) / 2 + e.curve
          const my = (pa.y + pb.y) / 2
          children.push(React.createElement('path', {
            key: 'be-' + e.a + '-' + e.b,
            d: 'M' + pa.x + ' ' + pa.y + ' Q' + mx + ' ' + my + ' ' + pb.x + ' ' + pb.y,
            fill: 'none', stroke: '#c9c2b6', strokeWidth: 1.2,
            opacity: onF ? 0.95 : 0.42,
          }))
        } else {
          children.push(React.createElement('line', {
            key: 'e-' + e.a + '-' + e.b, x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y,
            stroke: '#c9c2b6', strokeWidth: 1,
            strokeDasharray: e.dash ? '3 4' : undefined,
            opacity: onF ? 0.95 : 0.35,
          }))
        }
      }

      for (const n of visible) {
        const p = eff(n.id)
        if (!p) continue
        if (!inView(p, n.id)) continue
        const cat = CAT[n.category] || CAT.user
        const r = radiusOf(n)
        const spineIdx = L.spineIdx[n.id] != null ? L.spineIdx[n.id] : -1
        const onPath = spineIdx < 0 || cursorIdx < 0 || spineIdx <= cursorIdx
        const dim = focusId != null && n.id !== focusId && !neighborSet.has(n.id)
        const hov = hoverId === n.id
        const sel = selectedId === n.id
        const isCursor = n.id === cursor
        const cls = 'sg-node' + (hov ? ' sg-hover' : '') + (dim ? ' sg-dim' : '')

        // pkg-63: shadowed 节点样式（透明度 0.55 + 虚线 + 灰填充）
        const isShadowed = n.meta && n.meta.shadowed
        const nodeFill = isShadowed ? '#b9b4ab' : (neighborSet.has(n.id) && !sel ? '#6f6a62' : cat.fill)
        const nodeOpacity = isShadowed ? 0.55 : (onPath ? 1 : 0.32)
        const nodeDash = isShadowed ? '3 2' : undefined

        if (n.category === 'turn') {
          const rk = turnRound[n.id] || 'turn-' + n.meta.turn
          const f = effFoldKey(rk)
          const snip = roundSnippet[rk] || ''
          if (f) {
            children.push(React.createElement('g', {
              key: n.id, className: cls, opacity: onPath ? 1 : 0.5,
              onClick: () => { toggleFold(rk); jumpNode(n, items); setPendingJump(null) },
              onMouseEnter: () => setHoverId(n.id),
              onMouseLeave: () => setHoverId(null),
              title: '点击展开「' + snip + '」',
            },
              React.createElement('circle', { cx: 0, cy: p.y, r: 26, fill: 'transparent' }),
              React.createElement('circle', { cx: 0, cy: p.y, r: 16, fill: '#d9d9d9', stroke: '#b0b0b0', strokeWidth: 1 }),
              React.createElement('text', { x: 0, y: p.y - 22, className: 'sg-label', textAnchor: 'middle' },
                (snip || 'TURN ' + n.meta.turn) + ' · ' + ((L.segCount[rk] || 0)) + ' 条'),
            ))
          } else {
            children.push(React.createElement('g', {
              key: n.id, className: cls, opacity: onPath ? 1 : 0.5,
              onClick: () => { toggleFold(rk); jumpNode(n, items); setPendingJump(null) },
              onMouseEnter: () => setHoverId(n.id),
              onMouseLeave: () => setHoverId(null),
              title: '点击折叠「' + snip + '」',
            },
              React.createElement('circle', { cx: p.x, cy: p.y, r: 22, fill: 'transparent' }),
              React.createElement('circle', { cx: p.x, cy: p.y, r: 4, fill: 'none', stroke: '#b0b0b0', strokeWidth: 1 }),
              showLabels ? React.createElement('text', { x: p.x - 8, y: p.y + 4, className: 'sg-label', textAnchor: 'end' },
                'T' + n.meta.turn) : null,
            ))
          }
        } else if (n.category === 'switch') {
          // pkg-67: switch 原子复用 renderToolAtom(公共函数:命中圈 + switch 风格圆 + 禁用态)
          children.push(React.createElement('g', {
            key: n.id, className: cls, opacity: onPath ? 1 : 0.32,
            onClick: () => { setSelectedId(n.id); jumpNode(n, items); setPendingJump(null) },
            onMouseEnter: () => setHoverId(n.id),
            onMouseLeave: () => setHoverId(null),
            title: '委派 → ' + n.meta.childId + ' · ' + n.meta.provider + (n.meta.stopReason ? ' · ' + reasonText(n.meta.stopReason) : ' · 运行中'),
          },
            ...renderToolAtom(
              p.x, p.y, r,
              cat.fill,                    // switch 风格 fill:#e5ddd0
              cat.stroke, '3 2',           // switch 风格 stroke:#a89f8f dashed
              '委派→' + String(n.meta.childId).slice(0, 6),
              '委派 → ' + n.meta.childId + ' · ' + n.meta.provider + (n.meta.stopReason ? ' · ' + reasonText(n.meta.stopReason) : ' · 运行中'),
              () => { setSelectedId(n.id); jumpNode(n, items); setPendingJump(null) },
              false,                        // switch 节点永不 disabled
              'sw-' + n.id,
            ),
          ))
        } else if (n.category === 'tool') {
          // pkg-67: tool 原子复用 renderToolAtom(公共函数:命中圈 + tool 风格圆 + neighborSet 高亮)
          children.push(React.createElement('g', {
            key: n.id, className: cls, style: { animationDelay: ((L.stackIdx[n.id] || 0) % 5) * 0.25 + 's' },
            opacity: onPath ? 1 : 0.32,
            onMouseEnter: () => setHoverId(n.id),
            onMouseLeave: () => setHoverId(null),
            title: cat.label + ' ' + (n.meta.name || '') + ' #' + n.seq + (n.meta.result ? (n.meta.error ? ' ✗失败' : ' ✓完成') : ' …运行中'),
          },
            ...renderToolAtom(
              p.x, p.y, r,
              neighborSet.has(n.id) || sel ? '#a9a49c' : cat.fill,  // tool 风格:neighborSet 高亮
              sel ? '#4a4a4a' : undefined,   // 选中时 stroke
              undefined,                     // tool 风格无 dash
              labelOf(n, toolInfo),          // 图标文本=工具名称
              cat.label + ' ' + (n.meta.name || '') + ' #' + n.seq + (n.meta.result ? (n.meta.error ? ' ✗失败' : ' ✓完成') : ' …运行中'),
              () => { setSelectedId(n.id); jumpNode(n, items) },
              false,                         // tool 节点永不 disabled
              'tl-' + n.id,
            ),
          ))
        } else {
          // pkg-64: user/context/assistant/jump 节点统一渲染
          //   shadowed 节点: opacity 0.55 + strokeDasharray '3 2' + 灰填充 '#b9b4ab'(不应出现在 visible,防御性保留)
          //   jump 节点: 普通节点样式（title 显示摘要全文）
          //   非 turn/switch 节点单击 → 设置 pendingJump(交互原子组)
          children.push(React.createElement('g', {
            key: n.id, className: cls, opacity: nodeOpacity,
            onMouseDown: (e) => {
              e.preventDefault()
              e.stopPropagation()
              pendRef.current = { id: n.id, x: e.clientX, y: e.clientY, moved: false }
            },
            onClick: (e) => {
              e.stopPropagation()
              // T5: 拖拽结束不弹原子(pendRef.moved 表示已进入拖拽,由 onMouseUp 清空)
              if (pendRef.current && pendRef.current.moved) return
              if (pendingJump && pendingJump.id === n.id) {
                // 同一节点重复点击不重置
                setSelectedId(n.id)
                setPulseKey((k) => k + 1)
                jumpNode(n, items)
                return
              }
              // 清除旧交互原子,设置新交互原子
              setPendingJump(null)
              if (pendingJumpTimerRef.current) { pendingJumpTimerRef.current(); pendingJumpTimerRef.current = null }
              setJumpMsg(null)
              if (jumpMsgTimerRef.current) { jumpMsgTimerRef.current(); jumpMsgTimerRef.current = null }
              interactRef.current = Date.now()
              // pkg-67: pendingJump 只存 {id, anchorSeq},不存坐标(红线 3)
              setPendingJump({ id: n.id, anchorSeq: n.seq })
              setSelectedId(n.id)
              setPulseKey((k) => k + 1)
              jumpNode(n, items)
            },
            onMouseEnter: () => setHoverId(n.id),
            onMouseLeave: () => setHoverId(null),
            title: n.category === 'jump' ? (n.meta.summary || n.text || '分支切换') : (cat.label + ' #' + n.seq + ' ' + (n.text || '').slice(0, 80)),
          },
            React.createElement('circle', { cx: p.x, cy: p.y, r: r + LAYOUT.HIT_PAD, fill: 'transparent' }),
            sel ? React.createElement('circle', { key: 'h' + pulseKey, cx: p.x, cy: p.y, r: r + 6, className: 'sg-pulse', fill: 'none', stroke: '#8f887e', strokeWidth: 3 }) : null,
            isCursor ? React.createElement('circle', { cx: p.x, cy: p.y, r: r + 5, className: 'sg-cursor-ring', fill: 'none', stroke: '#7c7468', strokeWidth: 2 }) : null,
            React.createElement('circle', {
              cx: p.x, cy: p.y, r: r,
              fill: nodeFill,
              stroke: n.category === 'context' ? cat.stroke : sel ? '#4a4a4a' : 'none',
              strokeWidth: sel ? 1.5 : 1,
              strokeDasharray: nodeDash,
            }),
            showLabels ? React.createElement('text', { x: p.x + r + 6, y: p.y + 3, className: 'sg-label-text', textAnchor: 'start' },
              labelOf(n, toolInfo)) : null,
          ))
        }
      }

      // ===== pkg-67: 操作原子组渲染(核心重构) =====
      //   1. 坐标实时读取:从 eff(pendingJump.id) 获取(红线 3)
      //   2. fanOut 偏移:baseK = 真实工具簇数量,防重叠(红队 3.2)
      //   3. 复用 renderToolAtom 公共函数渲染三个操作原子
      //   4. 操作原子组追加在节点循环之后(children 末尾,红线 4)
      if (pendingJump) {
        const p = eff(pendingJump.id)
        if (p) {
          // 真实工具簇数量(assistant 且有 childMap 时取长度,否则 0)
          //   用于 fanOut 偏移,防止操作原子与真实工具原子重叠
          const targetNode = items.find((it) => it.id === pendingJump.id)
          const isAsst = targetNode && targetNode.category === 'assistant'
          const baseK = isAsst && L.childMap[pendingJump.id] ? L.childMap[pendingJump.id].length : 0

          // fanOut 同款几何公式(与 LAYOUT.FAN_X0/DX/DY 一致):
          //   k 从 baseK 开始(baseK, baseK+1, baseK+2)
          //   纵向相对扇形居中:与 fanOut 的 (k - (n-1)/2) 同构
          const actPos = (k) => ({
            x: p.x - (LAYOUT.FAN_X0 + k * LAYOUT.FAN_DX),
            y: p.y + (k - baseK - 1) * LAYOUT.FAN_DY,
          })

          // 「⇄ 切到这里继续」— switch 风格(重要操作,可见性更好)
          //   running 时 disabled, title「当前回合进行中」
          children.push(React.createElement('g', { key: 'act-jump' },
            ...renderToolAtom(
              actPos(baseK).x, actPos(baseK).y,
              7,                          // switch 风格 r=7
              '#e5ddd0',                  // switch 风格 fill
              '#a89f8f', '3 2',           // switch 风格 stroke + dashed
              '⇄',
              running ? '当前回合进行中' : '切到这里继续',
              confirmJump, running,
              'act-j',
            ),
          ))

          // 「± 折叠/展开该轮」— tool 风格(#c9c9c9, r=5, 无 stroke)
          //   jump 节点禁用(disabled,title「遮蔽摘要不可折叠」)
          //   动态 title:折叠态→展开该轮,展开态→折叠该轮
          const actRK = roundOf[pendingJump.id]
          const isJumpNode = targetNode && targetNode.category === 'jump'
          const foldDisabled = isJumpNode || !actRK
          const foldTitle = isJumpNode ? '遮蔽摘要不可折叠'
            : !actRK ? '无法确定所属轮次'
            : (effFoldKey(actRK) ? '展开该轮' : '折叠该轮')
          const foldIcon = actRK && effFoldKey(actRK) ? '+' : '−'
          children.push(React.createElement('g', { key: 'act-fold' },
            ...renderToolAtom(
              actPos(baseK + 1).x, actPos(baseK + 1).y,
              5,                          // tool 风格 r=5
              foldDisabled ? '#d9d9d9' : '#c9c9c9', // disabled 时降灰
              undefined, undefined,         // tool 风格无 stroke
              foldIcon,
              foldTitle,
              // 红线 1:先 setPendingJump(null),再 toggleFold
              (e) => {
                e.stopPropagation()
                if (foldDisabled) return
                setPendingJump(null)
                if (pendingJumpTimerRef.current) { pendingJumpTimerRef.current(); pendingJumpTimerRef.current = null }
                setJumpMsg(null)
                if (jumpMsgTimerRef.current) { jumpMsgTimerRef.current(); jumpMsgTimerRef.current = null }
                toggleFold(actRK)
              },
              foldDisabled,
              'act-f',
            ),
          ))

          // 「✕ 关闭」— tool 风格(#c9c9c9, r=5, 无 stroke)
          children.push(React.createElement('g', { key: 'act-close' },
            ...renderToolAtom(
              actPos(baseK + 2).x, actPos(baseK + 2).y,
              5,                          // tool 风格 r=5
              '#c9c9c9',                  // tool 风格 fill
              undefined, undefined,         // 无 stroke
              '✕',
              '取消',
              cancelJump, false,
              'act-c',
            ),
          ))
        }
      }

      // T5: jump 失败提示文案 — 操作原子组下方短暂显示(复用 .sg-label 样式,不新增 class)
      //   位置跟随操作原子组:在 ✕ 原子下方 y+16
      if (jumpMsg && pendingJump) {
        const p = eff(pendingJump.id)
        if (p) {
          const targetNode = items.find((it) => it.id === pendingJump.id)
          const isAsst = targetNode && targetNode.category === 'assistant'
          const baseK = isAsst && L.childMap[pendingJump.id] ? L.childMap[pendingJump.id].length : 0
          const closeX = p.x - (LAYOUT.FAN_X0 + (baseK + 2) * LAYOUT.FAN_DX)
          const closeY = p.y + ((baseK + 2) - baseK - 1) * LAYOUT.FAN_DY
          children.push(React.createElement('text', {
            key: 'act-msg',
            className: 'sg-label',
            x: closeX, y: closeY + 16,
            textAnchor: 'start',
            fill: '#a0522d',
          }, jumpMsg))
        }
      }

      const onMouseDown = (e) => {
        if (e.target !== e.currentTarget) return
        if (!view) return
        interactRef.current = Date.now()
        panRef.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty }
        setPanning(true)
      }
      const onMouseMove = (e) => {
        const pan = panRef.current
        if (pan) {
          const dx = e.clientX - pan.x
          const dy = e.clientY - pan.y
          setView((v) => v ? ({ ...v, tx: pan.tx + dx / v.z, ty: pan.ty + dy / v.z }) : v)
          return
        }
        const pend = pendRef.current
        if (pend) {
          const dist = Math.hypot(e.clientX - pend.x, e.clientY - pend.y)
          if (!pend.moved && dist > 4) {
            pend.moved = true
            setDragId(pend.id)
          }
          if (pend.moved && dragId != null && view) {
            const rect = svgRef.current.getBoundingClientRect()
            const lx = (e.clientX - rect.left - view.tx) / view.z
            const ly = (e.clientY - rect.top - view.ty) / view.z
            const rp = L.restPos[dragId]
            setLive((lv) => {
              const next = { ...(lv || {}) }
              next[dragId] = { x: lx, y: ly }
              for (const cid of L.childMap[dragId] || []) {
                const ro = L.restPos[cid]
                if (!ro || !rp) continue
                const offX = ro.x - rp.x
                const offY = ro.y - rp.y
                const cur = (lv && lv[cid]) || ro
                next[cid] = { x: cur.x + (lx + offX - cur.x) * 0.4, y: cur.y + (ly + offY - cur.y) * 0.4 }
              }
              return next
            })
          }
        }
      }
      const onMouseUp = () => {
        panRef.current = null
        setPanning(false)
        pendRef.current = null
        setDragId(null)
      }
      // T5: 点击空白区域清除交互原子 + 失败提示
      const onClickBg = (e) => {
        if (e.target === e.currentTarget) {
          setSelectedId(null)
          setPendingJump(null)
          if (pendingJumpTimerRef.current) { pendingJumpTimerRef.current(); pendingJumpTimerRef.current = null }
          setJumpMsg(null)
          if (jumpMsgTimerRef.current) { jumpMsgTimerRef.current(); jumpMsgTimerRef.current = null }
        }
      }

      return React.createElement('div', { className: 'sg-root' },
        React.createElement('div', { className: 'sg-header' },
          React.createElement('span', { className: 'sg-title' }, '会话图谱'),
          React.createElement('span', { className: 'sg-count' }, items.length + ' 节点' + (runs.length ? ' · ' + runs.length + ' 委派' : '')),
          React.createElement('span', { className: 'sg-spacer' }),
          React.createElement('button', { className: 'sg-btn', onClick: focusCursor }, '定位'),
          React.createElement('button', { className: 'sg-btn', onClick: fitAll }, '全图'),
          onCollapse ? React.createElement('button', { className: 'sg-btn sg-close', onClick: onCollapse, title: '收起为精简时间线' }, '⟩') : null,
        ),
        React.createElement('div', { className: 'sg-canvas' },
          React.createElement('svg', {
            ref: svgRef,
            className: 'sg-graph' + (panning ? ' sg-panning' : ''),
            viewBox: '0 0 ' + size.w + ' ' + size.h,
            onMouseDown: onMouseDown,
            onMouseMove: onMouseMove,
            onMouseUp: onMouseUp,
            onMouseLeave: onMouseUp,
            onClick: onClickBg,
          },
            items.length === 0
              ? React.createElement('text', { x: size.w / 2, y: size.h / 2, className: 'sg-label', textAnchor: 'middle' }, '暂无节点——发条消息试试')
              : React.createElement('g', {
                  style: {
                    transform: tf,
                    transition: (panning || dragId != null) ? 'none' : 'transform .18s ease-out',
                    transformBox: 'view-box',
                    transformOrigin: '0 0',
                  },
                }, children),
          ),
        ),
      )
    }

    // 拖拽/父级重渲染期间跳过重渲染(props 未变)
    const GraphViewMemo = React.memo(GraphView, (a, b) => a.sessionId === b.sessionId && a.base === b.base && a.cursor === b.cursor)

    // ===== 收起态:精简时间线窄条(浮层,由框架 data-details-collapsed 状态驱动,不依赖事件) =====
    const dotStyle = (n) => {
      switch (n.category) {
        case 'user': return { s: 12, c: '#8f8f8f' }
        case 'context': return { s: 7, c: '#d6d6d6', b: '1px solid #b8b8b8' }
        case 'assistant': return { s: 9, c: '#232323' }
        case 'tool': return { s: 7, c: '#c9c9c9' }
        case 'switch': return { s: 9, c: '#c9a24b' }
        // pkg-63: jump 节点在精简条中显示为暖灰色圆点
        case 'jump': return { s: 9, c: '#d8d0c0', b: '1px solid #a89f8f' }
        default: return { s: 5, c: '#cfc9bf' }
      }
    }
    const SlimOverlay = ({ useSessions }) => {
      const current = useSessions((s) => (s ? s.current : undefined))
      const [collapsed, setCollapsed] = React.useState(false)
      const [data, setData] = React.useState(null)

      // 检测框架 details 列是否收起(data-details-collapsed),与列状态完全同步
      React.useEffect(() => {
        const check = () => {
          const el = document.querySelector('[data-details-collapsed]')
          setCollapsed(!!el)
        }
        check()
        const timer = ctx.get('timer')
        const dispose = timer ? timer.interval(check, POLL.COLLAPSED_MS) : null
        return () => { if (dispose) dispose() }
      }, [])

      // 收起时轮询全量数据(含 callId 供工具点跳转)
      React.useEffect(() => {
        if (!collapsed || !current) { setData(null); return }
        let alive = true
        const fetchData = () => {
          host.call('sessiongraph.get', { sessionId: String(current) })
            .then((res) => { if (alive && res) setData(res) })
            .catch(() => {})
        }
        fetchData()
        const timer = ctx.get('timer')
        const dispose = timer ? timer.interval(fetchData, POLL.DATA_MS) : null
        return () => { alive = false; if (dispose) dispose() }
      }, [collapsed, current])

      if (!collapsed) return null

      const runs = sortRuns(data && data.switches)
      const items = buildItems((data ? data.nodes : []).map(normalizeNode), runs)
      const cursor = data ? data.cursor : null

      const expand = () => {
        const l = ctx.get('layout')
        if (l) l.openDetails()
      }

      return React.createElement('div', { className: 'sg-ov-wrap', onClick: expand, title: '点击展开完整图谱' },
        React.createElement('div', { className: 'sg-slim' },
          React.createElement('div', { className: 'sg-slim-top' },
            React.createElement('button', { className: 'sg-slim-btn', onClick: expand, title: '展开完整图谱' }, '⟨'),
          ),
          React.createElement('div', { className: 'sg-slim-track' },
            items.map((n) => {
              const d = dotStyle(n)
              return React.createElement('div', {
                key: n.id,
                className: 'sg-slim-dot' + (n.id === cursor ? ' sg-cur' : ''),
                style: { width: d.s, height: d.s, background: d.c, border: d.b || 'none' },
                onClick: (e) => { e.stopPropagation(); jumpNode(n, items) },
                title: (n.category === 'tool' ? (n.meta.name || '工具') : n.category === 'jump' ? '分支切换' : CAT[n.category] ? CAT[n.category].label : n.category) + ' ' + snippet(n.text, 20),
              })
            }),
          ),
        ),
      )
    }

    // ===== details 列(真实布局列,完全融入对话) =====
    const GraphPanel = ({ sessionId, useProjection }) => {
      const graph = useProjection('sessiongraph.graph')
      const base = graph && Array.isArray(graph.nodes) ? graph.nodes : []
      const cursor = graph ? graph.cursor : null

      // 会话切换:自动打开 details 列(框架会随切换关闭,这里重新打开)
      React.useEffect(() => {
        const l = ctx.get('layout')
        if (l && sessionId != null) l.openDetails()
      }, [sessionId])

      return React.createElement(GraphViewMemo, {
        sessionId: String(sessionId == null ? '' : sessionId),
        base: base,
        cursor: cursor,
        onCollapse: () => {
          const l = ctx.get('layout')
          if (l) l.closeDetails()
        },
      })
    }

    // 弹出式侧边栏已删除;图谱注册到 details 真实布局列 + 收起窄条浮层(由列状态驱动)
    slots.inject('details', () => slots.register(
      { name: 'details', id: 'sessiongraph-details', order: 10, label: () => '会话图谱' },
      GraphPanel,
    ))
    slots.inject('shell.overlay', () => slots.register(
      { name: 'shell.overlay', id: 'sessiongraph-slim-overlay', order: 20, label: () => '会话图谱精简条' },
      SlimOverlay,
    ))
  },
}
