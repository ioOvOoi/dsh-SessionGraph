/**
 * SessionGraph 静态版 Host 半体
 *
 * 设计说明：
 * 1. 入口形态遵循官方静态插件模式：export name/inject/apply
 * 2. 保留 sessiongraph.graph 投影（节点流 + sgJump 兼容展示）
 * 3. 新增 sessiongraph.meta 投影：提供 switches（委派记录）和 toolInfo（工具描述）
 * 4. 删除所有 RPC（harness.handle 调用）和 jump 触发逻辑
 * 5. 使用 @deepseek-ai/dsh-tools 的 defineTool 定义调试工具
 * 6. 事件监听维护 switchRuns（委派记录）供投影消费
 */

import { defineTool } from '@deepseek-ai/dsh-tools';

// 插件入口
export const name = 'dsh-sessiongraph';
export const inject = ['sessionProjections', 'tools', 'sessions', 'agents'];

export function apply(ctx) {
  // tools 服务(供投影 tool/call 分支注入工具描述;惰性获取,服务可能晚于插件出现)
  let toolsSvc = ctx.get('tools');
  if (!toolsSvc) {
    ctx.on('ready', () => { toolsSvc = ctx.get('tools'); });
  }
  // ─── 委派记录(switchRuns)：保留现有 subagent 跟踪逻辑不变 ───
  const switchRuns = {};
  const SWITCH_RETENTION_MS = 30 * 60 * 1000;
  const sweepRuns = () => {
    const now = Date.now();
    for (const key of Object.keys(switchRuns)) {
      const kept = switchRuns[key].filter((r) => r.endedAt === null || now - r.endedAt < SWITCH_RETENTION_MS);
      if (kept.length) switchRuns[key] = kept;
      else delete switchRuns[key];
    }
  };
  const agents = ctx.get('agents');
  const initiatorId = () => {
    if (!agents) return undefined;
    const a = agents.currentInitiator();
    return a ? String(a.id) : undefined;
  };
  const findRun = (runId) => {
    for (const key of Object.keys(switchRuns)) {
      const r = switchRuns[key].find((x) => x.runId === runId);
      if (r) return { key, run: r };
    }
    return undefined;
  };

  // ─── tool 描述缓存：按名称缓存 tool description，供侧边栏 toolInfo 使用 ───
  const toolDescCache = {};
  const toolInfoOf = (graph) => {
    const tools = ctx.get('tools');
    const out = {};
    if (!graph) return out;
    for (const n of graph.nodes) {
      if (n.category !== 'tool' || !n.meta || !n.meta.name) continue;
      const name = n.meta.name;
      if (toolDescCache[name] !== undefined) {
        if (toolDescCache[name]) out[name] = toolDescCache[name];
        continue;
      }
      const def = tools ? tools.get(name) : undefined;
      const desc = def && typeof def.description === 'string' && def.description.length > 0 ? def.description : '';
      toolDescCache[name] = desc || null;
      if (desc) out[name] = desc;
    }
    return out;
  };

  // ─── 事件监听：维护 switchRuns ───
  ctx.on('subagent/start', (info) => {
    if (!info) return;
    sweepRuns();
    const pid = initiatorId() || 'unknown';
    const list = switchRuns[pid] || (switchRuns[pid] = []);
    list.push({
      runId: String(info.runId),
      childId: String(info.id),
      provider: String(info.provider),
      startedAt: Date.now(),
      stopReason: null,
      endedAt: null,
    });
  }, { global: true });

  ctx.on('subagent/end', (info) => {
    if (!info) return;
    const runId = String(info.runId);
    let hit = findRun(runId);
    if (!hit) {
      const pid = initiatorId();
      if (pid) {
        const list = switchRuns[pid] || [];
        const r = list.find((x) => x.runId === runId);
        if (r) hit = { key: pid, run: r };
      }
    }
    if (!hit) return;
    hit.run.stopReason = info.stopReason ? { kind: info.stopReason.kind != null ? info.stopReason.kind : info.stopReason } : null;
    hit.run.endedAt = Date.now();
    sweepRuns();
  }, { global: true });

  // ─── 从 message content 数组提取纯文本 ───
  const textOf = (blocks) => {
    if (!Array.isArray(blocks)) return '';
    const parts = [];
    for (const b of blocks) {
      if (!b || typeof b !== 'object') continue;
      if (typeof b.text === 'string') parts.push(b.text);
      else if (b.type === 'tool-call' && typeof b.name === 'string') parts.push('[工具:' + b.name + ']');
    }
    return parts.join('\n');
  };

  // ─── 投影注册 ───
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    // ─── 投影：sessiongraph.graph ───
    // v6 状态版本 —— 新增 jump 节点和 shadowed 标记，向后兼容 v5
    projectionCtx.sessionProjections.register({
      key: 'sessiongraph.graph',
      schema: { parse: (value) => value },
      stateVersion: 6,
      init: () => ({ nodes: [], cursor: null, currentTurn: null, toolInfo: {}, switches: [] }),
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
            };
            return { ...state, currentTurn: event.data.turn, nodes: state.nodes.concat(node), cursor: node.id };
          }
          case 'turn/end': {
            let found = -1;
            for (let i = state.nodes.length - 1; i >= 0; i--) {
              if (state.nodes[i].category === 'turn' && state.nodes[i].meta.turn === event.data.turn) { found = i; break; }
            }
            if (found === -1) return state;
            const nodes = state.nodes.slice();
            nodes[found] = { ...nodes[found], meta: { ...nodes[found].meta, turnEnd: { reason: event.data.reason } } };
            return { ...state, nodes };
          }
          case 'user/message': {
            // ── 红线 4：投影 apply 先处理 sgJump ──
            // 识别 jump 摘要节点：event.data.sgJump 存在 → 生成 category:'jump'，不落入普通 user/message 分支
            const d = event.data;
            if (d && d.sgJump) {
              const jumpMeta = d.sgJump;
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
              };
              // 将被遮蔽段对应节点就地标记 shadowed = true（浅拷贝更新，保持数组不变序）
              const shadowSet = new Set(jumpMeta.shadowedSeqs);
              const nodes = state.nodes.map((n) => {
                if (shadowSet.has(n.seq)) {
                  return { ...n, meta: { ...n.meta, shadowed: true } };
                }
                return n;
              });
              return { ...state, nodes: nodes.concat(jumpNode), cursor: jumpNode.id };
            }

            // 普通 user/message 分支（原逻辑不变）
            const src = d.source;
            const cat = src && src.kind === 'user' ? 'user' : 'context';
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
            };
            return { ...state, nodes: state.nodes.concat(node), cursor: node.id };
          }
          case 'assistant/message': {
            const d = event.data;
            const think = Array.isArray(d.message.content) && d.message.content.some((b) => b && typeof b === 'object' && b.type === 'reasoning');
            const node = {
              id: String(d.message.id),
              seq: event.seq,
              time: event.time,
              category: 'assistant',
              role: d.message.role,
              text: textOf(d.message.content),
              meta: { turn: d.turn, step: d.step, usage: d.usage || null, think: think },
            };
            return { ...state, nodes: state.nodes.concat(node), cursor: node.id };
          }
          case 'tool/call': {
            const node = {
              id: 'tool-' + event.data.callId,
              seq: event.seq,
              time: event.time,
              category: 'tool',
              text: '[工具:' + event.data.name + ']',
              meta: { turn: state.currentTurn, step: event.data.step, callId: String(event.data.callId), name: event.data.name, result: false, error: false },
            };
            // 工具描述并入投影 state(toolInfo):新名称才新建对象,引用稳定供 memo 比较
            const name = event.data.name;
            let toolInfo = state.toolInfo;
            if (name && toolInfo[name] === undefined) {
              const def = toolsSvc ? toolsSvc.get(name) : undefined;
              const desc = def && typeof def.description === 'string' && def.description.length > 0 ? def.description : '';
              toolInfo = { ...toolInfo, [name]: desc };
            }
            // 委派记录并入投影 state(switches):subagent/start 是全局事件不进会话流,
            // 此处按 tool/call 顺序与闭包 switchRuns 配对(与动态版 buildItems 的 runIdx 同构)
            let switches = state.switches;
            if (name === 'subagent') {
              const pid = initiatorId() || 'unknown';
              const runs = switchRuns[pid] || [];
              if (switches.length < runs.length) {
                const r = runs[switches.length];
                switches = switches.concat({
                  runId: r.runId,
                  childId: r.childId,
                  provider: r.provider,
                  startedAt: r.startedAt,
                  stopReason: r.stopReason,
                  endedAt: r.endedAt,
                });
              }
            }
            return { ...state, nodes: state.nodes.concat(node), cursor: node.id, toolInfo, switches };
          }
          case 'tool/result': {
            const callId = (() => {
              const m = event.data.message;
              if (!m || !Array.isArray(m.content)) return null;
              for (const b of m.content) {
                if (b && typeof b === 'object' && b.toolCallId != null) return String(b.toolCallId);
              }
              return null;
            })();
            if (callId === null) return state;
            let found = -1;
            for (let i = state.nodes.length - 1; i >= 0; i--) {
              if (state.nodes[i].category === 'tool' && state.nodes[i].meta.callId === callId) { found = i; break; }
            }
            if (found === -1) return state;
            const nodes = state.nodes.slice();
            nodes[found] = { ...nodes[found], meta: { ...nodes[found].meta, result: true, error: !!event.data.error } };
            return { ...state, nodes };
          }
          default:
            return state;
        }
      },
      view: (state) => ({ nodes: state.nodes, cursor: state.cursor, toolInfo: state.toolInfo, switches: state.switches }),
    });
  });

  // ─── sessiongraph_debug 工具：输出投影快照 + switch 记录 ───
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
      if (!agent) return { error: 'exec.agent 缺失' };
      const sp = ctx.get('sessionProjections');
      if (!sp) return { error: 'sessionProjections 缺失' };
      const snap = sp.snapshot(agent.session);
      const graph = snap.values['sessiongraph.graph'];
      const runs = switchRuns[String(agent.id)] || [];
      if (!graph) return { sessionId: agent.id, asOfSeq: snap.asOfSeq, error: '图投影缺失(可能未注册或本会话无事件)' };
      const cats = {};
      for (const n of graph.nodes) cats[n.category] = (cats[n.category] || 0) + 1;
      // 统计 shadowed 节点数
      let shadowedCount = 0;
      for (const n of graph.nodes) {
        if (n.meta && n.meta.shadowed) shadowedCount++;
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
      };
    },
  });
  ctx.tools.register(tool);
}