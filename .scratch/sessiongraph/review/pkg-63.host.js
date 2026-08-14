return {
  apply(ctx) {
    const sp = ctx.get('sessionProjections')
    if (sp === undefined) return

    // ─── 委派记录(switchRuns)：保留现有 subagent 跟踪逻辑不变 ───
    const switchRuns = {}
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
      sweepRuns()
    })

    // ─── tool 描述缓存：按名称缓存 tool description，供侧边栏 toolInfo RPC 使用 ───
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

    // ─── RPC: sessiongraph.switches ───
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

    // ─── RPC: sessiongraph.toolinfo ───
    harness.handle('sessiongraph.toolinfo', async (args) => {
      const pid = args && args.sessionId != null ? String(args.sessionId) : ''
      const sessions = ctx.get('sessions')
      const session = sessions ? sessions.get(pid) : undefined
      const snap = session && sp ? sp.snapshot(session) : null
      return { tools: toolInfoOf(snap ? snap.values['sessiongraph.graph'] : null) }
    })

    // ─── RPC: sessiongraph.get ───
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

    // ─── 从 message content 数组提取纯文本 ───
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

    // 遮蔽阈值：被遮蔽节点数 < 此值时拒绝（信息量不足不值得遮蔽）
    const MIN_SHADOW = 4

    // ═══════════════════════════════════════════════════════════════════
    //  busy 守卫：jump 前的四项检查
    //  ① surface 完整性(末 seq == events 末 seq)  → 由 jump RPC 调用处单独做
    //  ② 尾部无未闭合 compaction/start
    //  ③ 尾部无未闭合 turn/start
    //  ④ subagent 运行中(switchRuns 里存在 endedAt === null 的委派)
    //  任一不满足 → { ok:false, reason:'busy' }
    // ═══════════════════════════════════════════════════════════════════
    const checkBusy = (session, pid) => {
      const events = session.events
      if (!events || events.length === 0) return null // 空会话，不算 busy

      // ② 尾部无未闭合 compaction/start
      for (let i = events.length - 1; i >= 0; i--) {
        const ev = events[i]
        if (ev.type === 'compaction/start') return { ok: false, reason: 'busy' }
        if (ev.type === 'compaction/end') break
      }

      // ③ 尾部无未闭合 turn/start（agent 运行中特征）
      for (let i = events.length - 1; i >= 0; i--) {
        const ev = events[i]
        if (ev.type === 'turn/start') return { ok: false, reason: 'busy' }
        if (ev.type === 'turn/end') break
      }

      // ④ subagent 运行中：switchRuns 里存在 endedAt === null 的委派
      const runs = pid ? switchRuns[pid] : undefined
      if (runs) {
        for (const r of runs) {
          if (r.endedAt === null) return { ok: false, reason: 'busy' }
        }
      }

      return null // 全部通过
    }

    // ═══════════════════════════════════════════════════════════════════
    //  RPC: sessiongraph.jump
    //  输入 { sessionId, anchorSeq }
    //  输出 { ok, reason?, shadowedCount?, summary? }
    // ═══════════════════════════════════════════════════════════════════
    harness.handle('sessiongraph.jump', async (args) => {
      const pid = args && args.sessionId != null ? String(args.sessionId) : ''
      const anchorSeq = args && args.anchorSeq != null ? Number(args.anchorSeq) : NaN
      if (!pid) return { ok: false, reason: 'missing-session' }
      if (Number.isNaN(anchorSeq)) return { ok: false, reason: 'invalid-anchorSeq' }

      // 1. sessions.get
      const sessions = ctx.get('sessions')
      const session = sessions ? sessions.get(pid) : undefined
      if (!session) return { ok: false, reason: 'session-not-found' }

      // 2. busy 守卫（四项检查）
      const busyResult = checkBusy(session, pid)
      if (busyResult) return busyResult

      // 3. 一致性验证：surface 末 seq 必须等于 events 末 seq（防 surface fold 滞后）
      const events = session.events
      const surface = session.surface
      if (!surface || !surface.nodes || surface.nodes.length === 0) {
        return { ok: false, reason: 'surface-empty' }
      }
      if (events && events.length > 0) {
        const lastEventSeq = events[events.length - 1].seq
        const lastSurfaceSeq = surface.nodes[surface.nodes.length - 1]
        if (lastSurfaceSeq !== lastEventSeq) {
          return { ok: false, reason: 'surface-stale' }
        }
      }

      // 4. 计算遮蔽范围：surface.nodes 中 anchorSeq 之后的所有节点（半开区间，不含 anchor）
      const nodesArr = surface.nodes // seq 数组，升序
      const anchorIdx = nodesArr.indexOf(anchorSeq)
      if (anchorIdx === -1) return { ok: false, reason: 'anchor-not-found' }

      // 半开区间：(anchorIdx, 末尾]
      const shadowedSeqs = nodesArr.slice(anchorIdx + 1)
      if (shadowedSeqs.length === 0) {
        return { ok: false, reason: 'nothing-to-shadow' }
      }

      // 5. 遮蔽阈值：被遮蔽节点数不足时不执行（信息量不足不值得遮蔽）
      if (shadowedSeqs.length < MIN_SHADOW) {
        return { ok: false, reason: 'nothing-to-shadow' }
      }

      // 6. 构造摘要（手工模板，不调 LLM）
      //    取被遮蔽节点的首尾 text 各 ~20 字；只索引被遮蔽节点对应事件，避免全量扫描
      const truncate = (s, max) => {
        if (!s) return ''
        return s.length > max ? s.slice(0, max) + '…' : s
      }
      // 一次性建立 seq→event 索引，只收集被遮蔽范围的事件（events 的 seq 不一定等于数组下标）
      const shadowedSet = new Set(shadowedSeqs)
      const shadowedEventMap = new Map()
      for (const ev of events) {
        if (ev.seq !== undefined && shadowedSet.has(ev.seq)) {
          shadowedEventMap.set(ev.seq, ev)
        }
      }
      // 从索引中提取文本（复用 textOf）
      const seqText = (seq) => {
        const ev = shadowedEventMap.get(seq)
        if (!ev) return ''
        const d = ev.data
        if (ev.type === 'user/message' && d && d.content) return textOf(d.content)
        if (ev.type === 'assistant/message' && d && d.message && d.message.content) return textOf(d.message.content)
        if (ev.type === 'tool/call' && d) return '[工具:' + (d.name || 'unknown') + ']'
        if (ev.type === 'tool/result' && d && d.message && d.message.content) return textOf(d.message.content)
        return ''
      }
      // 找首条非空文本节点
      let firstText = ''
      for (const s of shadowedSeqs) {
        const t = seqText(s)
        if (t.length > 0) { firstText = t; break }
      }
      // 找末条非空文本节点
      let lastText = ''
      for (let i = shadowedSeqs.length - 1; i >= 0; i--) {
        const t = seqText(shadowedSeqs[i])
        if (t.length > 0) { lastText = t; break }
      }
      const summary = '分支切换:遮蔽 ' + shadowedSeqs.length + ' 条 · 首条缩略:「' + truncate(firstText, 20) + '」 · 末条缩略:「' + truncate(lastText, 20) + '」'

      // 7. session.append replace
      //    source: { kind:'plugin', plugin:'sessiongraph' } —— 符合事件契约，投影据此识别 jump 摘要
      //    surfaceOp.start/end 用第一个/最后一个被遮蔽节点 seq（平台验证确认是 seq 语义）
      //    sourceEventSeqs 必须精确覆盖被遮蔽范围的所有节点 seq（红线 1）
      try {
        session.append('user/message', {
          role: 'user',
          source: { kind: 'plugin', plugin: 'sessiongraph' },
          content: [{ type: 'text', text: summary }],
          sgJump: {
            anchorSeq: anchorSeq,
            shadowedSeqs: shadowedSeqs.slice(),
            summary: summary,
          },
        }, {
          surfaceOp: {
            op: 'replace',
            start: shadowedSeqs[0],
            end: shadowedSeqs[shadowedSeqs.length - 1],
          },
          sourceEventSeqs: shadowedSeqs.slice(),
        })
      } catch (err) {
        return { ok: false, reason: 'append-failed: ' + (err && err.message ? err.message : String(err)) }
      }

      // 8. 返回结果
      return { ok: true, shadowedCount: shadowedSeqs.length, summary: summary }
    })

    // ═══════════════════════════════════════════════════════════════════
    //  投影：sessiongraph.graph
    //  v6 状态版本 —— 新增 jump 节点和 shadowed 标记，向后兼容 v5
    // ═══════════════════════════════════════════════════════════════════
    sp.register({
      key: 'sessiongraph.graph',
      schema: { parse: (value) => value },
      stateVersion: 6,
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
            // ── 红线 4：投影 apply 先处理 sgJump ──
            // 识别 jump 摘要节点：event.data.sgJump 存在 → 生成 category:'jump'，不落入普通 user/message 分支
            const d = event.data
            if (d && d.sgJump) {
              const jumpMeta = d.sgJump
              const jumpNode = {
                id: 'jump-' + event.seq,
                seq: event.seq,
                time: event.time,
                category: 'jump',
                text: textOf(d.content),
                meta: {
                  anchorSeq: jumpMeta.anchorSeq,
                  shadowedSeqs: jumpMeta.shadowedSeqs,
                  summary: jumpMeta.summary,
                  turn: state.currentTurn,
                },
              }
              // 将被遮蔽段对应节点就地标记 shadowed = true（浅拷贝更新，保持数组不变序）
              const shadowSet = new Set(jumpMeta.shadowedSeqs)
              const nodes = state.nodes.map((n) => {
                if (shadowSet.has(n.seq)) {
                  return { ...n, meta: { ...n.meta, shadowed: true } }
                }
                return n
              })
              return { ...state, nodes: nodes.concat(jumpNode), cursor: jumpNode.id }
            }

            // 普通 user/message 分支（原逻辑不变）
            const src = d.source
            const cat = src && src.kind === 'user' ? 'user' : 'context'
            const node = {
              id: String(d.id),
              seq: event.seq,
              time: event.time,
              category: cat,
              role: d.role,
              text: textOf(d.content),
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

    // ─── sessiongraph_debug 工具：输出投影快照 + switch 记录 + jump 信息 ───
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
        // 统计 shadowed 节点数
        let shadowedCount = 0
        for (const n of graph.nodes) {
          if (n.meta && n.meta.shadowed) shadowedCount++
        }
        return {
          sessionId: agent.id,
          asOfSeq: snap.asOfSeq,
          nodeCount: graph.nodes.length,
          categoryCounts: cats,
          cursor: graph.cursor,
          shadowedCount: shadowedCount,
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
              // jump 节点特有字段
              anchorSeq: n.meta.anchorSeq == null ? null : n.meta.anchorSeq,
              shadowedSeqs: n.meta.shadowedSeqs || null,
              summary: n.meta.summary || null,
              // shadowed 标记
              shadowed: n.meta.shadowed || false,
            },
          })),
        }
      },
    })
    ctx.effect(() => harness.registerTool(ctx, tool))
  },
}
