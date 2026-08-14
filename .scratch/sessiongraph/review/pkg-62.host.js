return {
  apply(ctx) {
    const sp = ctx.get('sessionProjections')
    if (sp === undefined) return

    const switchRuns = {}
    // 委派记录保留窗口:结束后 30 分钟自动回收,防长驻进程内存泄漏
    const SWITCH_RETENTION_MS = 30 * 60 * 1000
    const sweepRuns = () => {
      const now = Date.now()
      for (const key of Object.keys(switchRuns)) {
        const kept = switchRuns[key].filter((r) => r.endedAt === null || now - r.endedAt < SWITCH_RETENTION_MS)
        if (kept.length) switchRuns[key] = kept
        else delete switchRuns[key]
      }
    }
    const agents = ctx.get('agents')
    const initiatorId = () => {
      if (!agents) return undefined
      const a = agents.currentInitiator()
      return a ? String(a.id) : undefined
    }
    const findRun = (runId) => {
      for (const key of Object.keys(switchRuns)) {
        const r = switchRuns[key].find((x) => x.runId === runId)
        if (r) return { key, run: r }
      }
      return undefined
    }

    ctx.on('subagent/start', (info) => {
      if (!info) return
      sweepRuns()
      const pid = initiatorId() || 'unknown'
      const list = switchRuns[pid] || (switchRuns[pid] = [])
      list.push({
        runId: String(info.runId),
        childId: String(info.id),
        provider: String(info.provider),
        startedAt: Date.now(),
        stopReason: null,
        endedAt: null,
      })
    })

    ctx.on('subagent/end', (info) => {
      if (!info) return
      const runId = String(info.runId)
      let hit = findRun(runId)
      if (!hit) {
        const pid = initiatorId()
        if (pid) {
          const list = switchRuns[pid] || []
          const r = list.find((x) => x.runId === runId)
          if (r) hit = { key: pid, run: r }
        }
      }
      if (!hit) return
      hit.run.stopReason = info.stopReason ? { kind: info.stopReason.kind != null ? info.stopReason.kind : info.stopReason } : null
      hit.run.endedAt = Date.now()
      // 结束即进入保留期,立即回收已过期记录
      sweepRuns()
    })

    const toolDescCache = {}
    const toolInfoOf = (graph) => {
      const tools = ctx.get('tools')
      const out = {}
      if (!graph) return out
      for (const n of graph.nodes) {
        if (n.category !== 'tool' || !n.meta || !n.meta.name) continue
        const name = n.meta.name
        if (toolDescCache[name] !== undefined) {
          if (toolDescCache[name]) out[name] = toolDescCache[name]
          continue
        }
        const def = tools ? tools.get(name) : undefined
        const desc = def && typeof def.description === 'string' && def.description.length > 0 ? def.description : ''
        toolDescCache[name] = desc || null
        if (desc) out[name] = desc
      }
      return out
    }

    harness.handle('sessiongraph.switches', async (args) => {
      const pid = args && args.sessionId != null ? String(args.sessionId) : ''
      return { switches: (switchRuns[pid] || []).map((r) => ({
        runId: r.runId,
        childId: r.childId,
        provider: r.provider,
        startedAt: r.startedAt,
        stopReason: r.stopReason,
        endedAt: r.endedAt,
      })) }
    })

    harness.handle('sessiongraph.toolinfo', async (args) => {
      const pid = args && args.sessionId != null ? String(args.sessionId) : ''
      const sessions = ctx.get('sessions')
      const session = sessions ? sessions.get(pid) : undefined
      const snap = session && sp ? sp.snapshot(session) : null
      return { tools: toolInfoOf(snap ? snap.values['sessiongraph.graph'] : null) }
    })

    // 侧边栏数据 RPC:直返投影节点本体(与 useProjection 形状一致,消除双端字段映射),文本截断 60
    harness.handle('sessiongraph.get', async (args) => {
      const pid = args && args.sessionId != null ? String(args.sessionId) : ''
      const sessions = ctx.get('sessions')
      const session = sessions ? sessions.get(pid) : undefined
      if (!session || !sp) return { nodes: [], cursor: null, switches: [], toolInfo: {} }
      const snap = sp.snapshot(session)
      const graph = snap.values['sessiongraph.graph']
      if (!graph) return { nodes: [], cursor: null, switches: [], toolInfo: {} }
      const nodes = graph.nodes.map((n) => ({ ...n, text: (n.text || '').slice(0, 60) }))
      return {
        nodes,
        cursor: graph.cursor,
        switches: (switchRuns[pid] || []).map((r) => ({
          runId: r.runId, childId: r.childId, provider: r.provider,
          startedAt: r.startedAt, stopReason: r.stopReason, endedAt: r.endedAt,
        })),
        toolInfo: toolInfoOf(graph),
      }
    })

    const textOf = (blocks) => {
      if (!Array.isArray(blocks)) return ''
      const parts = []
      for (const b of blocks) {
        if (!b || typeof b !== 'object') continue
        if (typeof b.text === 'string') parts.push(b.text)
        else if (b.type === 'tool-call' && typeof b.name === 'string') parts.push('[工具:' + b.name + ']')
      }
      return parts.join('\n')
    }

    sp.register({
      key: 'sessiongraph.graph',
      schema: { parse: (value) => value },
      stateVersion: 5,
      init: () => ({ nodes: [], cursor: null, currentTurn: null }),
      apply: (state, event) => {
        switch (event.type) {
          case 'turn/start': {
            const node = {
              id: 'turn-' + event.data.turn,
              seq: event.seq,
              time: event.time,
              category: 'turn',
              text: '',
              meta: { turn: event.data.turn, turnEnd: null },
            }
            return { ...state, currentTurn: event.data.turn, nodes: state.nodes.concat(node), cursor: node.id }
          }
          case 'turn/end': {
            let found = -1
            for (let i = state.nodes.length - 1; i >= 0; i--) {
              if (state.nodes[i].category === 'turn' && state.nodes[i].meta.turn === event.data.turn) { found = i; break }
            }
            if (found === -1) return state
            const nodes = state.nodes.slice()
            nodes[found] = { ...nodes[found], meta: { ...nodes[found].meta, turnEnd: { reason: event.data.reason } } }
            return { ...state, nodes }
          }
          case 'user/message': {
            const src = event.data.source
            const cat = src && src.kind === 'user' ? 'user' : 'context'
            const node = {
              id: String(event.data.id),
              seq: event.seq,
              time: event.time,
              category: cat,
              role: event.data.role,
              text: textOf(event.data.content),
              meta: {
                turn: state.currentTurn,
                sourceKind: src ? src.kind : null,
                plugin: src && src.kind === 'plugin' && src.plugin ? String(src.plugin) : null,
              },
            }
            return { ...state, nodes: state.nodes.concat(node), cursor: node.id }
          }
          case 'assistant/message': {
            const d = event.data
            const think = Array.isArray(d.message.content) && d.message.content.some((b) => b && typeof b === 'object' && b.type === 'reasoning')
            const node = {
              id: String(d.message.id),
              seq: event.seq,
              time: event.time,
              category: 'assistant',
              role: d.message.role,
              text: textOf(d.message.content),
              meta: { turn: d.turn, step: d.step, usage: d.usage || null, think: think },
            }
            return { ...state, nodes: state.nodes.concat(node), cursor: node.id }
          }
          case 'tool/call': {
            const node = {
              id: 'tool-' + event.data.callId,
              seq: event.seq,
              time: event.time,
              category: 'tool',
              text: '[工具:' + event.data.name + ']',
              meta: { turn: state.currentTurn, step: event.data.step, callId: String(event.data.callId), name: event.data.name, result: false, error: false },
            }
            return { ...state, nodes: state.nodes.concat(node), cursor: node.id }
          }
          case 'tool/result': {
            const callId = (() => {
              const m = event.data.message
              if (!m || !Array.isArray(m.content)) return null
              for (const b of m.content) {
                if (b && typeof b === 'object' && b.toolCallId != null) return String(b.toolCallId)
              }
              return null
            })()
            if (callId === null) return state
            let found = -1
            for (let i = state.nodes.length - 1; i >= 0; i--) {
              if (state.nodes[i].category === 'tool' && state.nodes[i].meta.callId === callId) { found = i; break }
            }
            if (found === -1) return state
            const nodes = state.nodes.slice()
            nodes[found] = { ...nodes[found], meta: { ...nodes[found].meta, result: true, error: !!event.data.error } }
            return { ...state, nodes }
          }
          default:
            return state
        }
      },
      view: (state) => ({ nodes: state.nodes, cursor: state.cursor }),
    })

    const tool = harness.defineTool({
      name: 'sessiongraph_debug',
      description: 'SessionGraph 验证工具:读取当前会话的图投影快照(分类节点流/游标)与切换记录。',
      parameters: {},
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      async execute(args, exec) {
        const agent = exec.agent
        if (!agent) return { error: 'exec.agent 缺失' }
        const sp2 = ctx.get('sessionProjections')
        if (!sp2) return { error: 'sessionProjections 缺失' }
        const snap = sp2.snapshot(agent.session)
        const graph = snap.values['sessiongraph.graph']
        const runs = switchRuns[String(agent.id)] || []
        if (!graph) return { sessionId: agent.id, asOfSeq: snap.asOfSeq, error: '图投影缺失(可能未注册或本会话无事件)' }
        const cats = {}
        for (const n of graph.nodes) cats[n.category] = (cats[n.category] || 0) + 1
        return {
          sessionId: agent.id,
          asOfSeq: snap.asOfSeq,
          nodeCount: graph.nodes.length,
          categoryCounts: cats,
          cursor: graph.cursor,
          switchKeys: Object.keys(switchRuns),
          switches: runs.map((r) => ({
            runId: r.runId,
            childId: r.childId,
            provider: r.provider,
            startedAt: r.startedAt,
            stopReason: r.stopReason,
            endedAt: r.endedAt,
          })),
          nodes: graph.nodes.map((n) => ({
            id: n.id,
            seq: n.seq,
            category: n.category,
            time: n.time,
            text: (n.text || '').slice(0, 50),
            meta: {
              turn: n.meta.turn == null ? null : n.meta.turn,
              step: n.meta.step == null ? null : n.meta.step,
              callId: n.meta.callId || null,
              name: n.meta.name || null,
              toolState: n.category === 'tool' ? (n.meta.result ? (n.meta.error ? '✗' : '✓') : '…') : null,
              turnEnd: n.meta.turnEnd || null,
              plugin: n.meta.plugin || null,
              think: n.meta.think || false,
            },
          })),
        }
      },
    })
    ctx.effect(() => harness.registerTool(ctx, tool))
  },
}
