/**
 * SessionGraph 静态 Client 半体
 *
 * 入口形态: window.__ModuleLoader__.load (官方静态插件标准)
 * 移植自: .scratch/sessiongraph/review/pkg-67.client.js (动态版)
 *
 * === SlimOverlay 数据来源结论 (§6 移植要求) ===
 * shell.overlay 槽位 scope="root", owner props 仅含 useSessions/useWorkspaces,
 * 不含 useProjection (仅 session-scoped 槽位才有 useProjection)。
 * 静态版无 host.call RPC, 因此 SlimOverlay 无法直接获取投影数据。
 * 解决方案: 模块级共享状态 _sharedGraphData, GraphPanel 写入, SlimOverlay 订阅。
 * GraphPanel 通过 useProjection('sessiongraph.graph') 读取投影, 写入 _sharedGraphData;
 * SlimOverlay 通过 _sharedGraphData.subscribe() 订阅变化, 不依赖 RPC。
 */
window.__ModuleLoader__.load({
	id: 'dsh-sessiongraph',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

		const React = require('react');

		// ===== CSS 注入 (styles.insert → 模块级 <style> 标签) =====
		const css = `
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
/* T5: 操作原子悬停反馈(复用工具原子视觉,仅加交互反馈) */
.sg-op{cursor:pointer;transition:opacity .15s ease;}
.sg-op:hover{opacity:.85;}
`;
		const tagId = 'dsh-sessiongraph/client.css';
		if (typeof document !== 'undefined' &&
			document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {
			const tag = document.createElement('style');
			tag.dataset.plugin = 'dsh-sessiongraph';
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}

		// ===== 模块级共享状态 (GraphPanel → SlimOverlay 数据桥) =====
		//   shell.overlay 槽位 scope="root", 无 useProjection, 无 host.call RPC,
		//   因此 SlimOverlay 通过此模块级可观察对象订阅 GraphPanel 写入的图数据。
		const _sharedGraphData = {
			_nodes: null,
			_cursor: null,
			_switches: null,
			_listeners: new Set(),
			update(nodes, cursor, switches) {
				this._nodes = nodes
				this._cursor = cursor
				this._switches = switches
				for (const fn of this._listeners) {
					try { fn(nodes, cursor, switches) } catch (_) { /* ignore */ }
				}
			},
			subscribe(fn) {
				this._listeners.add(fn)
				return () => { this._listeners.delete(fn) }
			},
		}

		// ===== 工具函数 =====
		const reasonText = (reason) => {
			if (reason == null) return '?'
			if (typeof reason === 'object') return reason.kind != null ? String(reason.kind) : JSON.stringify(reason)
			return String(reason)
		}

		const CAT = {
			user: { label: 'USER', fill: '#8f8f8f', r: 16 },
			context: { label: 'CTX', fill: '#d6d6d6', r: 6, stroke: '#b8b8b8' },
			assistant: { label: 'ASST', fill: '#232323', r: 9 },
			tool: { label: 'TOOL', fill: '#c9c9c9', r: 5 },
			turn: { label: 'TURN', fill: 'none', r: 3 },
			switch: { label: '委派', fill: '#e5ddd0', r: 7, stroke: '#a89f8f' },
			// jump 摘要节点样式(只读兼容保留)
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
			// jump 节点标签(只读)
			if (n.category === 'jump') return '分支切换 ' + snippet(n.meta.summary || n.text, 16) + ' ⛔'
			return CAT[n.category] ? CAT[n.category].label : ''
		}

		// 归一化节点(兜底 meta)
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

		// ===== 布局与交互常量 =====
		const LAYOUT = {
			LATERAL_STEP: 34,
			LATERAL_MAX: 72,
			NODE_GAP: 26,
			TURN_MARKER_X: -30,
			EDGE_CURVE: 14,
			FAN_X0: 26,
			FAN_DX: 22,
			FAN_DY: 18,
			SWITCH_DX: 6,
			SWITCH_DY: 8,
			FOLD_KEEP: 2,
			HIT_PAD: 10,
		}
		const POLL = { COLLAPSED_MS: 400, RESIZE_MS: 150 }

		// 委派记录按开始时间升序
		const sortRuns = (arr) => (arr || []).slice().sort((a, b) => a.startedAt - b.startedAt)

		// ===== 跳转定位(保留: 节点单击定位跳转聊天锚点) =====
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
			// jump 节点跳转到对应 anchor 的聊天位置
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
			// 静态版: 原生 setTimeout 替代 ctx.get('timer').timeout
			const t = setTimeout(() => el.classList.remove('sg-jump-flash'), 1700)
			// 返回清理函数(虽然这里通常不需要, scroll 完即止)
			return () => clearTimeout(t)
		}
		const jumpNode = (n, items) => scrollToKey(keyOfNode(n, items))

		// ===== Obsidian 式布局:时间顺序 + 引力漂移 + 贝塞尔弯曲 =====
		const hashOf = (s) => {
			let h = 0
			for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
			return Math.abs(h)
		}
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
		const buildLayout = (items, roundOf, turnRound, roundSnippet, effFoldKey) => {
			const segCount = {}
			for (const it of items) {
				if (it.meta && it.meta.shadowed) continue
				const k = roundOf[it.id]
				if (k) segCount[k] = (segCount[k] || 0) + 1
			}

			const chain = []
			for (const it of items) {
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

		// ===== 公共渲染函数: tool/switch/操作原子共用 =====
		const renderToolAtom = (x, y, r, fill, stroke, dash, iconText, title, onClick, disabled, key, showLabel, hoverCls) => {
			const elems = []
			elems.push(React.createElement('circle', {
				key: key + '-hit', cx: x, cy: y, r: r + LAYOUT.HIT_PAD, fill: 'transparent',
				style: disabled ? { pointerEvents: 'none' } : undefined,
				onClick: (e) => { e.stopPropagation(); if (!disabled && onClick) onClick(e) },
				title: title,
			}))
			elems.push(React.createElement('circle', {
				key: key + '-c', cx: x, cy: y, r: r,
				fill: fill,
				stroke: stroke || 'none', strokeWidth: stroke ? 1.5 : 0,
				strokeDasharray: dash || undefined,
				className: hoverCls || undefined,
				style: disabled ? { opacity: 0.35, pointerEvents: 'none' } : undefined,
				onClick: (e) => { e.stopPropagation(); if (!disabled && onClick) onClick(e) },
			}))
			if (showLabel !== false) {
				elems.push(React.createElement('text', {
					key: key + '-t', x: x, y: y + 3,
					textAnchor: 'middle',
					className: 'sg-label-text',
					style: { pointerEvents: 'none', fontSize: '9px', fill: disabled ? '#b0a89a' : '#6f6a62' },
				}, iconText))
			}
			return elems
		}

		// ===== GraphView 组件 =====
		//   移植改动:
		//   - 删除 pendingJump/jumpMsg/confirmJump/cancelJump/jumpFailText/ACT_MSG_MS
		//   - 删除 host.call('sessiongraph.switches'/'toolinfo') — 改由 metaSwitches/metaToolInfo props 传入
		//   - timer → 原生 setTimeout
		//   - 操作原子组仅保留 ± 折叠/展开 + ✕ 关闭
		const GraphView = ({ sessionId, base, cursor, onCollapse, metaSwitches, metaToolInfo }) => {
			const [selectedId, setSelectedId] = React.useState(null)
			const [hoverId, setHoverId] = React.useState(null)
			const [folded, setFolded] = React.useState({})
			const [view, setView] = React.useState(null)
			const [size, setSize] = React.useState({ w: 400, h: 500 })
			const [panning, setPanning] = React.useState(false)
			const [dragId, setDragId] = React.useState(null)
			const [live, setLive] = React.useState(null)
			const [pulseKey, setPulseKey] = React.useState(0)
			// 操作原子组状态(仅 ±/✕, 无 jump)
			const [opTarget, setOpTarget] = React.useState(null)
			const svgRef = React.useRef(null)
			const panRef = React.useRef(null)
			const pendRef = React.useRef(null)
			const memoRef = React.useRef(null)
			const interactRef = React.useRef(0)
			const viewRef = React.useRef(null)
			const sizeRef = React.useRef({ w: 400, h: 500 })
			const opTimerRef = React.useRef(null)

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
				setOpTarget(null)
				if (opTimerRef.current) { clearTimeout(opTimerRef.current); opTimerRef.current = null }
			}, [sessionId])

			// 从 owner props 获取 metaSwitches/metaToolInfo (替代 host.call)
			const switches = metaSwitches || []
			const toolInfo = metaToolInfo || null

			const runs = sortRuns(switches)
			const items = buildItems(normBase, runs)

			let maxTurn = 0
			for (const it of items) if (it.category === 'turn' && it.meta.turn > maxTurn) maxTurn = it.meta.turn

			// 运行中判定
			const running = items.some((it) => it.category === 'tool' && !(it.meta && it.meta.result))

			// ===== 用户轮次模型 =====
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

			// 尺寸测量:ResizeObserver + 150ms 节流
			React.useEffect(() => {
				const el = svgRef.current
				if (!el) return
				let alive = true
				let ro = null
				let pending = false
				let resizeTimerId = null
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
						const fire = () => { pending = false; if (alive) measure() }
						resizeTimerId = setTimeout(fire, POLL.RESIZE_MS)
					})
					ro.observe(el)
				}
				return () => {
					alive = false
					if (ro) ro.disconnect()
					if (resizeTimerId) clearTimeout(resizeTimerId)
				}
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

			// 操作原子组超时自动消失(3 秒无操作关闭)
			React.useEffect(() => {
				if (opTimerRef.current) { clearTimeout(opTimerRef.current); opTimerRef.current = null }
				if (opTarget) {
					opTimerRef.current = setTimeout(() => {
						setOpTarget(null)
						opTimerRef.current = null
					}, 3000)
				}
				return () => {
					if (opTimerRef.current) { clearTimeout(opTimerRef.current); opTimerRef.current = null }
				}
			}, [opTarget])

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

			// 关闭操作原子组
			const closeOp = React.useCallback((e) => {
				if (e) e.stopPropagation()
				setOpTarget(null)
				if (opTimerRef.current) { clearTimeout(opTimerRef.current); opTimerRef.current = null }
			}, [])

			const children = []

			// 常显边(Obsidian 式)
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

				// shadowed 节点样式
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
							onClick: () => {
								toggleFold(rk)
								jumpNode(n, items)
								closeOp()
							},
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
							onClick: () => {
								toggleFold(rk)
								jumpNode(n, items)
								closeOp()
							},
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
					children.push(React.createElement('g', {
						key: n.id, className: cls, opacity: onPath ? 1 : 0.32,
						onClick: () => {
							setSelectedId(n.id)
							jumpNode(n, items)
							setOpTarget({ id: n.id, nodeId: n.id })
						},
						onMouseEnter: () => setHoverId(n.id),
						onMouseLeave: () => setHoverId(null),
						title: '委派 → ' + n.meta.childId + ' · ' + n.meta.provider + (n.meta.stopReason ? ' · ' + reasonText(n.meta.stopReason) : ' · 运行中'),
					},
						...renderToolAtom(
							p.x, p.y, r,
							cat.fill,
							cat.stroke, '3 2',
							'委派→' + String(n.meta.childId).slice(0, 6),
							'委派 → ' + n.meta.childId + ' · ' + n.meta.provider + (n.meta.stopReason ? ' · ' + reasonText(n.meta.stopReason) : ' · 运行中'),
							() => {
								setSelectedId(n.id)
								jumpNode(n, items)
								setOpTarget({ id: n.id, nodeId: n.id })
							},
							false,
							'sw-' + n.id,
							showLabels,
						),
					))
				} else if (n.category === 'tool') {
					children.push(React.createElement('g', {
						key: n.id, className: cls, style: { animationDelay: ((L.stackIdx[n.id] || 0) % 5) * 0.25 + 's' },
						opacity: onPath ? 1 : 0.32,
						onMouseEnter: () => setHoverId(n.id),
						onMouseLeave: () => setHoverId(null),
						title: cat.label + ' ' + (n.meta.name || '') + ' #' + n.seq + (n.meta.result ? (n.meta.error ? ' ✗失败' : ' ✓完成') : ' …运行中'),
					},
						...renderToolAtom(
							p.x, p.y, r,
							neighborSet.has(n.id) || sel ? '#a9a49c' : cat.fill,
							sel ? '#4a4a4a' : undefined,
							undefined,
							labelOf(n, toolInfo),
							cat.label + ' ' + (n.meta.name || '') + ' #' + n.seq + (n.meta.result ? (n.meta.error ? ' ✗失败' : ' ✓完成') : ' …运行中'),
							() => { setSelectedId(n.id); jumpNode(n, items) },
							false,
							'tl-' + n.id,
							showLabels,
						),
					))
				} else {
					// user/context/assistant/jump 节点统一渲染
					children.push(React.createElement('g', {
						key: n.id, className: cls, opacity: nodeOpacity,
						onMouseDown: (e) => {
							e.preventDefault()
							e.stopPropagation()
							pendRef.current = { id: n.id, x: e.clientX, y: e.clientY, moved: false }
						},
						onClick: (e) => {
							e.stopPropagation()
							if (pendRef.current && pendRef.current.moved) return
							interactRef.current = Date.now()
							setSelectedId(n.id)
							setPulseKey((k) => k + 1)
							jumpNode(n, items)
							// 弹出操作原子组(±/✕)
							if (opTarget && opTarget.id === n.id) {
								// 同一节点重复点击不重置
								return
							}
							setOpTarget({ id: n.id, nodeId: n.id })
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

			// ===== 操作原子组渲染(仅 ±/✕, 无 ⇄) =====
			if (opTarget) {
				const p = eff(opTarget.id)
				if (p) {
					const targetNode = items.find((it) => it.id === opTarget.id)
					const isAsst = targetNode && targetNode.category === 'assistant'
					const baseK = isAsst && L.childMap[opTarget.id] ? L.childMap[opTarget.id].length : 0

					const actPos = (k) => ({
						x: p.x - (LAYOUT.FAN_X0 + k * LAYOUT.FAN_DX),
						y: p.y + (k - baseK - 1) * LAYOUT.FAN_DY,
					})

					// 「± 折叠/展开该轮」
					const actRK = roundOf[opTarget.id]
					const isJumpNode = targetNode && targetNode.category === 'jump'
					const foldDisabled = isJumpNode || !actRK
					const foldTitle = isJumpNode ? '遮蔽摘要不可折叠'
						: !actRK ? '无法确定所属轮次'
						: (effFoldKey(actRK) ? '展开该轮' : '折叠该轮')
					const foldIcon = actRK && effFoldKey(actRK) ? '+' : '−'
					children.push(React.createElement('g', { key: 'act-fold' },
						...renderToolAtom(
							actPos(baseK).x, actPos(baseK).y,
							5,
							foldDisabled ? '#d9d9d9' : '#c9c9c9',
							undefined, undefined,
							foldIcon,
							foldTitle,
							(e) => {
								e.stopPropagation()
								if (foldDisabled) return
								closeOp()
								toggleFold(actRK)
							},
							foldDisabled,
							'act-f',
							true, 'sg-op',
						),
					))

					// 「✕ 关闭」
					children.push(React.createElement('g', { key: 'act-close' },
						...renderToolAtom(
							actPos(baseK + 1).x, actPos(baseK + 1).y,
							5,
							'#c9c9c9',
							undefined, undefined,
							'✕',
							'取消',
							closeOp, false,
							'act-c',
							true, 'sg-op',
						),
					))
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
			// 点击空白区域清除操作原子组
			const onClickBg = (e) => {
				if (e.target === e.currentTarget) {
					setSelectedId(null)
					closeOp()
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

		// 拖拽/父级重渲染期间跳过重渲染 — 增加 metaSwitches/metaToolInfo 比较
		const GraphViewMemo = React.memo(GraphView, (a, b) =>
			a.sessionId === b.sessionId &&
			a.base === b.base &&
			a.cursor === b.cursor &&
			a.metaSwitches === b.metaSwitches &&
			a.metaToolInfo === b.metaToolInfo
		)

		// ===== 收起态:精简时间线窄条 =====
		//   数据来源: 模块级 _sharedGraphData (GraphPanel 写入, 本组件订阅)
		//   shell.overlay scope="root" 无 useProjection, 静态版无 host.call RPC,
		//   因此通过模块级可观察对象桥接数据。
		const dotStyle = (n) => {
			switch (n.category) {
				case 'user': return { s: 12, c: '#8f8f8f' }
				case 'context': return { s: 7, c: '#d6d6d6', b: '1px solid #b8b8b8' }
				case 'assistant': return { s: 9, c: '#232323' }
				case 'tool': return { s: 7, c: '#c9c9c9' }
				case 'switch': return { s: 9, c: '#c9a24b' }
				case 'jump': return { s: 9, c: '#d8d0c0', b: '1px solid #a89f8f' }
				default: return { s: 5, c: '#cfc9bf' }
			}
		}
		const SlimOverlay = ({ useSessions }) => {
			const current = useSessions((s) => (s ? s.current : undefined))
			const [collapsed, setCollapsed] = React.useState(false)
			const [nodes, setNodes] = React.useState(null)
			const [cursor, setCursor] = React.useState(null)
			const [switchesData, setSwitchesData] = React.useState(null)

			// 检测框架 details 列是否收起
			React.useEffect(() => {
				const check = () => {
					const el = document.querySelector('[data-details-collapsed]')
					setCollapsed(!!el)
				}
				check()
				const id = setInterval(check, POLL.COLLAPSED_MS)
				return () => clearInterval(id)
			}, [])

			// 订阅模块级共享数据(GraphPanel 写入)
			React.useEffect(() => {
				if (!collapsed || !current) {
					setNodes(null)
					setCursor(null)
					setSwitchesData(null)
					return
				}
				// 初始化读取当前值
				setNodes(_sharedGraphData._nodes)
				setCursor(_sharedGraphData._cursor)
				setSwitchesData(_sharedGraphData._switches)
				// 订阅后续更新
				const unsub = _sharedGraphData.subscribe((n, c, s) => {
					setNodes(n)
					setCursor(c)
					setSwitchesData(s)
				})
				return unsub
			}, [collapsed, current])

			if (!collapsed) return null

			const runs = sortRuns(switchesData)
			const items = buildItems((nodes || []).map(normalizeNode), runs)

			const expand = () => {
				// ctx.layout 在外部 apply 闭包中; 此处使用模块级引用
				if (_layoutRef) _layoutRef.openDetails()
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

		// 模块级 layout 引用, 供 SlimOverlay 展开使用
		let _layoutRef = null

		// ===== details 列(真实布局列) =====
		//   GraphPanel 增加 useProjection('sessiongraph.meta') 读取 meta,
		//   把 meta.switches/meta.toolInfo 作为 props 传给 GraphView;
		//   同时把 nodes/cursor 写入 _sharedGraphData 供 SlimOverlay 订阅。
		const GraphPanel = ({ sessionId, useProjection }) => {
			const graph = useProjection('sessiongraph.graph')
			const meta = useProjection('sessiongraph.meta')
			const base = graph && Array.isArray(graph.nodes) ? graph.nodes : []
			const cursor = graph ? graph.cursor : null
			const metaSwitches = meta && Array.isArray(meta.switches) ? meta.switches : []
			const metaToolInfo = meta && typeof meta.toolInfo === 'object' ? meta.toolInfo : null

			// 将图数据写入模块级共享状态(SlimOverlay 订阅)
			React.useEffect(() => {
				_sharedGraphData.update(base, cursor, metaSwitches)
			}, [base, cursor, metaSwitches])

			// 会话切换:自动打开 details 列
			React.useEffect(() => {
				if (_layoutRef && sessionId != null) _layoutRef.openDetails()
			}, [sessionId])

			return React.createElement(GraphViewMemo, {
				sessionId: String(sessionId == null ? '' : sessionId),
				base: base,
				cursor: cursor,
				onCollapse: () => {
					if (_layoutRef) _layoutRef.closeDetails()
				},
				metaSwitches: metaSwitches,
				metaToolInfo: metaToolInfo,
			})
		}

		// ===== 插槽注册 =====
		const apply = (ctx) => {
			// layout 引用缓存(供 SlimOverlay 展开)
			_layoutRef = ctx.layout

			// details 列: 会话级, 有 useProjection
			ctx.slots.inject('details', () => ctx.slots.register(
				{ name: 'details', id: 'sessiongraph-details', order: 10, label: () => '会话图谱' },
				GraphPanel,
			))

			// 收起态精简条: root 级, 有 useSessions
			ctx.slots.inject('shell.overlay', () => ctx.slots.register(
				{ name: 'shell.overlay', id: 'sessiongraph-slim-overlay', order: 20, label: () => '会话图谱精简条' },
				SlimOverlay,
			))
		}

		// ===== 导出 =====
		exports.apply = apply
		exports.inject = ['slots', 'connection', 'layout']
		return module.exports
	}
})
