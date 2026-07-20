'use client'

import { useEffect, useState, useMemo, useRef } from 'react'
import { createClient } from '@/lib/supabase-browser'
import type { B2BMaterial } from '@/lib/types'
import {
  runCuttingOptimizer,
  runCuttingOptimizerOptimized,
  DEFAULT_CUTTING_SETTINGS,
  type CuttingSettings,
  type PieceGroup,
  type MaterialCuttingResult,
  type CuttingSheet,
  type Remnant,
  type CuttingPiece,
} from '@/lib/cuttingOptimizer'

// ─── Types ─────────────────────────────────────────────────────────────────────

type Item = {
  materialName?: string
  category?: string
  thickness?: number
  width?: number
  height?: number
  quantity?: number
  totalAreaNet?: number
  hasTempering?: boolean
  comment?: string
  hasTriplex?: boolean
  triplexLayers?: number
  triplexGlasses?: { materialId?: number; materialName?: string; thickness?: number }[]
}

type Order = {
  id: number
  client_name: string
  total_after_discount: number
  total_sale_inc_vat: number
  discount_percent: number
  items: Item[]
  notes: string | null
  created_at: string
  status: string
  materialOrdered: boolean
  totalAreaNet: number
  totalPieces: number
}

function parseNotes(n: string | null): Record<string, unknown> {
  if (!n) return {}
  try { const p = JSON.parse(n); if (typeof p === 'object') return p } catch {}
  return {}
}

function getItemArea(item: Item): number {
  const w = (item.width ?? 0) / 1000
  const h = (item.height ?? 0) / 1000
  const qty = item.quantity ?? 1
  return w * h * qty
}

// ─── Colors ────────────────────────────────────────────────────────────────────

const PIECE_COLORS = [
  '#4B9FFF', '#FF6B6B', '#51CF66', '#FAB005', '#CC5DE8',
  '#20C997', '#FF8C42', '#845EF7', '#F06595', '#74C0FC',
  '#A9E34B', '#FFA94D', '#63E6BE', '#E599F7', '#FFD43B',
]

function pieceColor(idx: number, alpha = 1): string {
  const hex = PIECE_COLORS[idx % PIECE_COLORS.length]
  if (alpha >= 1) return hex
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

// ─── Sheet SVG (auto, read-only) ──────────────────────────────────────────────

function SheetSVG({ sheet, sheetW, sheetH, edgeMargin }: {
  sheet: CuttingSheet
  sheetW: number
  sheetH: number
  edgeMargin: number
}) {
  return (
    <svg
      viewBox={`0 0 ${sheetW} ${sheetH}`}
      style={{ display: 'block', width: '100%', borderRadius: 6, border: '1px solid #e4e4e0' }}
    >
      <rect x={0} y={0} width={sheetW} height={sheetH} fill="#d8d8d4" />
      <rect
        x={edgeMargin} y={edgeMargin}
        width={sheetW - 2 * edgeMargin} height={sheetH - 2 * edgeMargin}
        fill="#f0f0ec" stroke="#b0b0aa" strokeWidth={3}
      />
      {sheet.pieces.map((p, i) => {
        const fill = pieceColor(p.colorIndex, 0.85)
        const minDim = Math.min(p.w, p.h)
        const showLabel = minDim > 80 && p.w > 150
        return (
          <g key={i}>
            <rect x={p.x} y={p.y} width={p.w} height={p.h} fill={fill} stroke="#fff" strokeWidth={2} rx={4} />
            {showLabel && (
              <>
                <text
                  x={p.x + p.w / 2} y={p.y + p.h / 2 - (minDim > 200 ? 50 : 0)}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize={Math.max(60, minDim / 6)}
                  fill="rgba(0,0,0,0.75)" fontWeight="600" fontFamily="Arial"
                >{p.w}×{p.h}</text>
                {minDim > 200 && (
                  <text
                    x={p.x + p.w / 2} y={p.y + p.h / 2 + 60}
                    textAnchor="middle" dominantBaseline="middle"
                    fontSize={Math.max(40, minDim / 9)}
                    fill="rgba(0,0,0,0.5)" fontFamily="Arial"
                  >{p.orderClientName}</text>
                )}
              </>
            )}
          </g>
        )
      })}
      {sheet.remnants?.map((rem, i) => {
        const fs = Math.max(45, Math.min(rem.w, rem.h) / 7)
        return (
          <g key={`rem-${i}`}>
            <rect
              x={rem.x} y={rem.y} width={rem.w} height={rem.h}
              fill="rgba(251,191,36,0.12)" stroke="rgba(245,158,11,0.5)"
              strokeWidth={4} strokeDasharray="20 10"
            />
            {Math.min(rem.w, rem.h) > 200 && (
              <text
                x={rem.x + rem.w / 2} y={rem.y + rem.h / 2}
                textAnchor="middle" dominantBaseline="middle"
                fontSize={fs} fill="rgba(180,120,0,0.85)" fontFamily="Arial" fontWeight="600"
              >{rem.w}×{rem.h}</text>
            )}
          </g>
        )
      })}
      <text x={sheetW / 2} y={sheetH - 30} textAnchor="middle" fontSize={55} fill="#888" fontFamily="Arial">
        {sheetW}×{sheetH} мм
      </text>
    </svg>
  )
}

// ─── Manual Cutting Editor ────────────────────────────────────────────────────

type ManualPlacement = { sheetIdx: number; x: number; y: number; rotated: boolean }

const SNAP = 5

function snapMm(v: number) { return Math.round(v / SNAP) * SNAP }

function mCollides(
  id: string, x: number, y: number, w: number, h: number,
  sheetIdx: number, pls: Record<string, ManualPlacement>,
  allPieces: CuttingPiece[], gap: number,
): boolean {
  for (const [pid, pl] of Object.entries(pls)) {
    if (pid === id || pl.sheetIdx !== sheetIdx) continue
    const pc = allPieces.find(p => p.id === pid)
    if (!pc) continue
    const pw = pl.rotated ? pc.height : pc.width
    const ph = pl.rotated ? pc.width : pc.height
    if (x < pl.x + pw + gap && x + w + gap > pl.x && y < pl.y + ph + gap && y + h + gap > pl.y) return true
  }
  return false
}

function findFreeSpot(
  piece: CuttingPiece, rotated: boolean, sheetIdx: number,
  pls: Record<string, ManualPlacement>, allPieces: CuttingPiece[],
  sheetW: number, sheetH: number, e: number, gap: number,
): { x: number; y: number } | null {
  const w = rotated ? piece.height : piece.width
  const h = rotated ? piece.width : piece.height
  for (let y = e; y + h + e <= sheetH; y += SNAP) {
    for (let x = e; x + w + e <= sheetW; x += SNAP) {
      if (!mCollides(piece.id, x, y, w, h, sheetIdx, pls, allPieces, gap)) return { x, y }
    }
  }
  return null
}

function ManualCuttingEditor({ pieces, sheetW, sheetH, edgeMargin, gap }: {
  pieces: CuttingPiece[]
  sheetW: number
  sheetH: number
  edgeMargin: number
  gap: number
}) {
  const [pls, setPls] = useState<Record<string, ManualPlacement>>({})
  const [sheetCount, setSheetCount] = useState(1)
  const [activeSheet, setActiveSheet] = useState(0)
  const [selId, setSelId] = useState<string | null>(null)

  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<{ id: string; startMX: number; startMY: number; origX: number; origY: number } | null>(null)
  const plsRef = useRef(pls)
  const piecesRef = useRef(pieces)
  // eslint-disable-next-line react-hooks/refs
  plsRef.current = pls          // sync update — always fresh for drag handlers
  // eslint-disable-next-line react-hooks/refs
  piecesRef.current = pieces    // sync update

  // Clean up stale placements when piece IDs change
  const pieceIdsKey = pieces.map(p => p.id).join('|')
  useEffect(() => {
    const ids = new Set(pieces.map(p => p.id))
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPls(prev => {
      const next: Record<string, ManualPlacement> = {}
      let changed = false
      for (const [id, pl] of Object.entries(prev)) {
        if (ids.has(id)) next[id] = pl
        else changed = true
      }
      return changed ? next : prev
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pieceIdsKey])

  const placed = Object.entries(pls).filter(([, pl]) => pl.sheetIdx === activeSheet)
  const unplaced = pieces.filter(p => !pls[p.id])

  const usedArea = placed.reduce((s, [id]) => {
    const pc = pieces.find(p => p.id === id)
    if (!pc) return s
    const pl = pls[id]
    const w = pl.rotated ? pc.height : pc.width
    const h = pl.rotated ? pc.width : pc.height
    return s + w * h
  }, 0)
  const eff = Math.round(usedArea / (sheetW * sheetH) * 100)

  const orderColorMap = useMemo(() => {
    const map = new Map<number, number>()
    let idx = 0
    for (const pc of pieces) {
      if (!map.has(pc.orderId)) map.set(pc.orderId, idx++)
    }
    return map
  }, [pieces])

  // Global drag handlers
  useEffect(() => {
    function onMove(e: MouseEvent) {
      const dr = dragRef.current
      if (!dr || !svgRef.current) return
      const r = svgRef.current.getBoundingClientRect()
      if (r.width === 0) return
      const scaleX = sheetW / r.width
      const scaleY = sheetH / r.height
      const pl = plsRef.current[dr.id]
      if (!pl) return
      const pc = piecesRef.current.find(p => p.id === dr.id)
      if (!pc) return
      const w = pl.rotated ? pc.height : pc.width
      const h = pl.rotated ? pc.width : pc.height
      let nx = snapMm(dr.origX + (e.clientX - dr.startMX) * scaleX)
      let ny = snapMm(dr.origY + (e.clientY - dr.startMY) * scaleY)
      nx = Math.max(edgeMargin, Math.min(nx, sheetW - edgeMargin - w))
      ny = Math.max(edgeMargin, Math.min(ny, sheetH - edgeMargin - h))
      if (!mCollides(dr.id, nx, ny, w, h, pl.sheetIdx, plsRef.current, piecesRef.current, gap)) {
        setPls(prev => ({ ...prev, [dr.id]: { ...prev[dr.id], x: nx, y: ny } }))
      }
    }
    function onUp() { dragRef.current = null }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [sheetW, sheetH, edgeMargin, gap])

  function handleUnplacedClick(piece: CuttingPiece) {
    const pos = findFreeSpot(piece, false, activeSheet, plsRef.current, piecesRef.current, sheetW, sheetH, edgeMargin, gap)
    if (pos) {
      setPls(prev => ({ ...prev, [piece.id]: { sheetIdx: activeSheet, x: pos.x, y: pos.y, rotated: false } }))
      return
    }
    const newIdx = sheetCount
    setSheetCount(c => c + 1)
    setActiveSheet(newIdx)
    const pos2 = findFreeSpot(piece, false, newIdx, plsRef.current, piecesRef.current, sheetW, sheetH, edgeMargin, gap)
    if (pos2) setPls(prev => ({ ...prev, [piece.id]: { sheetIdx: newIdx, x: pos2.x, y: pos2.y, rotated: false } }))
  }

  function handleRemove(id: string) {
    setPls(prev => { const n = { ...prev }; delete n[id]; return n })
    if (selId === id) setSelId(null)
  }

  function handleRotate(id: string) {
    setPls(prev => {
      const pl = prev[id]
      if (!pl) return prev
      const pc = piecesRef.current.find(p => p.id === id)
      if (!pc || !pc.canRotate) return prev
      const nr = !pl.rotated
      const w = nr ? pc.height : pc.width
      const h = nr ? pc.width : pc.height
      const x = Math.max(edgeMargin, Math.min(pl.x, sheetW - edgeMargin - w))
      const y = Math.max(edgeMargin, Math.min(pl.y, sheetH - edgeMargin - h))
      if (mCollides(id, x, y, w, h, pl.sheetIdx, prev, piecesRef.current, gap)) return prev
      return { ...prev, [id]: { ...pl, rotated: nr, x, y } }
    })
  }

  function onPieceMouseDown(e: React.MouseEvent, id: string) {
    e.preventDefault()
    e.stopPropagation()
    const pl = plsRef.current[id]
    if (!pl) return
    dragRef.current = { id, startMX: e.clientX, startMY: e.clientY, origX: pl.x, origY: pl.y }
    setSelId(id)
  }

  const selPl = selId ? pls[selId] : null
  const selPiece = selId ? pieces.find(p => p.id === selId) : null
  const allPlaced = unplaced.length === 0 && pieces.length > 0

  return (
    <div className="flex flex-col gap-2">
      {/* Sheet tabs */}
      <div className="flex items-center gap-1 flex-wrap">
        {Array.from({ length: sheetCount }, (_, i) => {
          const cnt = Object.values(pls).filter(pl => pl.sheetIdx === i).length
          return (
            <button key={i} onClick={() => setActiveSheet(i)}
              className={`px-2.5 py-1 rounded text-[11px] font-medium border transition-colors ${
                activeSheet === i ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-[#4b4b47] border-[#e4e4e0] hover:bg-[#f5f5f3]'
              }`}
            >
              Лист {i + 1}{cnt > 0 ? ` (${cnt})` : ''}
            </button>
          )
        })}
        <button
          onClick={() => { const ni = sheetCount; setSheetCount(c => c + 1); setActiveSheet(ni) }}
          className="px-2 py-1 rounded text-[11px] border border-dashed border-[#c4c4be] text-[#9a9a95] hover:border-indigo-400 hover:text-indigo-600 transition-colors"
        >+ лист</button>
        <span className="ml-auto text-[11px] text-[#6b6b66]">
          КПД <b className={eff >= 70 ? 'text-emerald-600' : eff >= 50 ? 'text-amber-600' : 'text-[#4b4b47]'}>{eff}%</b>
        </span>
      </div>

      {/* Toolbar for selected piece */}
      {selPl && selPiece && (
        <div className="flex items-center gap-2 px-2 py-1.5 bg-indigo-50 border border-indigo-200 rounded-lg">
          <span className="text-[11px] font-semibold text-indigo-800">{selPiece.label}{selPl.rotated ? ' ↻' : ''}</span>
          <div className="ml-auto flex items-center gap-1">
            <button onClick={() => handleRotate(selId!)} disabled={!selPiece.canRotate}
              className="px-2 py-0.5 rounded bg-white border border-indigo-200 text-indigo-700 hover:bg-indigo-50 disabled:opacity-40 text-[10px]"
            >↻ Повернуть</button>
            <button onClick={() => handleRemove(selId!)}
              className="px-2 py-0.5 rounded bg-white border border-red-200 text-red-600 hover:bg-red-50 text-[10px]"
            >✕ Убрать</button>
          </div>
        </div>
      )}

      {/* SVG Canvas */}
      <div className="rounded-lg border border-[#e4e4e0] overflow-hidden" onClick={() => setSelId(null)}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${sheetW} ${sheetH}`}
          style={{ display: 'block', width: '100%' }}
        >
          <rect x={0} y={0} width={sheetW} height={sheetH} fill="#d8d8d4" />
          <rect
            x={edgeMargin} y={edgeMargin}
            width={sheetW - 2 * edgeMargin} height={sheetH - 2 * edgeMargin}
            fill="#f0f0ec" stroke="#b0b0aa" strokeWidth={3}
          />
          {placed.map(([id, pl]) => {
            const pc = pieces.find(p => p.id === id)
            if (!pc) return null
            const w = pl.rotated ? pc.height : pc.width
            const h = pl.rotated ? pc.width : pc.height
            const isSel = id === selId
            const fill = pieceColor(orderColorMap.get(pc.orderId) ?? 0, 0.85)
            const minDim = Math.min(w, h)
            return (
              <g key={id} style={{ cursor: 'grab' }}
                onMouseDown={e => onPieceMouseDown(e, id)}
                onClick={e => { e.stopPropagation(); setSelId(id) }}
              >
                <rect
                  x={pl.x} y={pl.y} width={w} height={h}
                  fill={fill} stroke={isSel ? '#4338ca' : '#fff'}
                  strokeWidth={isSel ? 10 : 2} rx={4}
                />
                {minDim > 80 && (
                  <text
                    x={pl.x + w / 2} y={pl.y + h / 2}
                    textAnchor="middle" dominantBaseline="middle"
                    fontSize={Math.max(60, minDim / 6)}
                    fill="rgba(0,0,0,0.75)" fontWeight="600" fontFamily="Arial"
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >{w}×{h}{pl.rotated ? ' ↻' : ''}</text>
                )}
              </g>
            )
          })}
          <text x={sheetW / 2} y={sheetH - 30} textAnchor="middle" fontSize={55} fill="#888" fontFamily="Arial">
            {sheetW}×{sheetH} мм
          </text>
        </svg>
      </div>

      {/* Unplaced / done status */}
      {allPlaced ? (
        <div className="text-[11px] text-emerald-600 font-semibold">✓ Все {pieces.length} деталей размещены</div>
      ) : unplaced.length > 0 ? (
        <div>
          <div className="text-[10px] text-[#9a9a95] mb-1 font-medium">Нажмите для авто-размещения ({unplaced.length} шт):</div>
          <div className="flex flex-wrap gap-1 max-h-28 overflow-y-auto">
            {unplaced.map(pc => {
              const ci = orderColorMap.get(pc.orderId) ?? 0
              return (
                <button key={pc.id} onClick={() => handleUnplacedClick(pc)}
                  style={{ background: pieceColor(ci, 0.15), borderColor: pieceColor(ci, 0.6) }}
                  className="text-[10px] px-2 py-1 rounded border font-mono hover:opacity-75 transition-opacity text-[#111]"
                  title={`${pc.width}×${pc.height} мм · ${pc.orderClientName}`}
                >{pc.label}</button>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}

// ─── Material section ─────────────────────────────────────────────────────────

function MaterialSection({ result, edgeMargin, gap, pieces, expanded, onToggle }: {
  result: MaterialCuttingResult
  edgeMargin: number
  gap: number
  pieces: CuttingPiece[]
  expanded: boolean
  onToggle: () => void
}) {
  const orders = useMemo(() => {
    const m = new Map<number, string>()
    for (const sh of result.sheets) for (const p of sh.pieces) m.set(p.orderId, p.orderClientName)
    return Array.from(m.entries())
  }, [result])

  const patLabel =
    result.patternDirection === 'along_length' ? '↔ Волна по длине (фиксировано)' :
    result.patternDirection === 'along_width'  ? '↕ Волна по ширине (фиксировано)' : null

  const unplacedPieces = result.unplacedPieces ?? []
  const unplacedCount  = result.unplacedCount  ?? unplacedPieces.length

  return (
    <div className={`border rounded-xl overflow-hidden ${unplacedCount > 0 ? 'border-red-300' : 'border-[#e4e4e0]'}`}>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 bg-[#fafaf9] hover:bg-[#f5f5f3] transition-colors text-left"
      >
        <span className="text-[15px] font-bold text-[#111110] flex-1">{result.materialLabel}</span>
        <div className="flex items-center gap-3 flex-shrink-0">
          {patLabel && (
            <span className="text-[11px] px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">{patLabel}</span>
          )}
          {unplacedCount > 0 && (
            <span className="text-[11px] px-2 py-0.5 rounded bg-red-50 text-red-700 border border-red-200 font-semibold">
              ⚠ {unplacedCount} не влезло
            </span>
          )}
          <span className="text-[13px] font-bold text-blue-700 bg-blue-50 px-3 py-1 rounded-lg border border-blue-200">
            {result.sheetsNeeded} {result.sheetsNeeded === 1 ? 'лист' : result.sheetsNeeded < 5 ? 'листа' : 'листов'}
          </span>
          <span className={`text-[12px] font-semibold px-2 py-1 rounded border ${
            result.avgEfficiency >= 70 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
            result.avgEfficiency >= 50 ? 'bg-amber-50 text-amber-700 border-amber-200' :
            'bg-red-50 text-red-700 border-red-200'
          }`}>КПД {result.avgEfficiency}%</span>
          <span className="text-[#9a9a95] text-[12px]">{result.totalPieces} дет.</span>
          <span className="text-[18px] text-[#9a9a95]" style={{ transform: expanded ? 'rotate(180deg)' : 'none', display: 'inline-block' }}>›</span>
        </div>
      </button>

      {expanded && (
        <div className="p-4 space-y-4">
          {/* Unplaced pieces warning */}
          {unplacedCount > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-3">
              <div className="text-[12px] font-semibold text-red-700 mb-2">
                ⚠ {unplacedCount} {unplacedCount === 1 ? 'деталь не помещается' : unplacedCount < 5 ? 'детали не помещаются' : 'деталей не помещаются'} в формат листа {result.sheetWidth}×{result.sheetHeight} мм
              </div>
              <div className="flex flex-col gap-1">
                {unplacedPieces.map((p, i) => (
                  <div key={p.id ?? i} className="flex items-center gap-2 text-[11px] text-red-800 font-mono">
                    <span className="px-1.5 py-0.5 bg-red-100 rounded font-semibold">{p.width}×{p.height}</span>
                    <span className="text-red-600">{p.label}</span>
                    {p.orderClientName && <span className="text-red-500">· {p.orderClientName}</span>}
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-red-500 mt-2">
                Эти детали превышают рабочую область листа с учётом кромки и зазора. Замените на другой формат листа или разбейте деталь.
              </p>
            </div>
          )}

          {orders.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {orders.map(([orderId, clientName], i) => (
                <div key={orderId} className="flex items-center gap-1.5 text-[12px]">
                  <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: pieceColor(i) }} />
                  <span className="text-[#4b4b47]">{clientName || `Заказ #${orderId}`}</span>
                </div>
              ))}
            </div>
          )}

          {/* Split view */}
          <div className="grid grid-cols-2 gap-4 items-start">
            {/* Left: Auto */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-bold text-[#4b4b47]">Авто-раскрой</span>
                <span className="text-[11px] px-2 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-200">{result.sheetsNeeded} листов</span>
              </div>
              {result.sheets.map(sheet => (
                <div key={sheet.index} className="space-y-1">
                  <div className="flex items-center gap-2 text-[11px] text-[#6b6b66]">
                    <span className="font-semibold">Лист {sheet.index + 1}</span>
                    <span>·</span>
                    <span>{sheet.pieces.length} дет.</span>
                    <span>·</span>
                    <span className={sheet.efficiency >= 70 ? 'text-emerald-600' : sheet.efficiency >= 50 ? 'text-amber-600' : 'text-red-600'}>
                      {sheet.efficiency}%
                    </span>
                  </div>
                  <SheetSVG sheet={sheet} sheetW={result.sheetWidth} sheetH={result.sheetHeight} edgeMargin={edgeMargin} />
                  {sheet.remnants && sheet.remnants.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      <span className="text-[10px] text-amber-600 font-semibold">Остатки:</span>
                      {sheet.remnants.map((rem: Remnant, ri: number) => (
                        <span key={ri} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                          {rem.w}×{rem.h}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Right: Manual */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-bold text-[#4b4b47]">Ручной раскрой</span>
                <span className="text-[11px] text-[#9a9a95]">перетаскивайте детали</span>
              </div>
              <ManualCuttingEditor
                pieces={pieces}
                sheetW={result.sheetWidth}
                sheetH={result.sheetHeight}
                edgeMargin={edgeMargin}
                gap={gap}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function B2BCuttingPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [materials, setMaterials] = useState<B2BMaterial[]>([])
  const [settings, setSettings] = useState<CuttingSettings>(DEFAULT_CUTTING_SETTINGS)
  const [loading, setLoading] = useState(true)

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [showAll, setShowAll] = useState(false)
  const [results, setResults] = useState<MaterialCuttingResult[] | null>(null)
  const [pieceGroups, setPieceGroups] = useState<Map<string, PieceGroup> | null>(null)
  const [expandedMat, setExpandedMat] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [savingProc, setSavingProc] = useState(false)
  const [procSaved, setProcSaved] = useState(false)
  const [optimizing, setOptimizing] = useState(false)
  const [prevResults, setPrevResults] = useState<MaterialCuttingResult[] | null>(null)

  const resultsRef = useRef<HTMLDivElement>(null)

  // eslint-disable-next-line react-hooks/immutability
  useEffect(() => { load().catch(() => setLoading(false)) }, [])

  async function load() {
    setLoading(true)
    const sb = createClient()
    const [{ data: ordersData }, { data: matsData }, { data: settingsData }] = await Promise.all([
      sb.from('b2b_orders')
        .select('id,client_name,total_after_discount,total_sale_inc_vat,discount_percent,items,notes,created_at')
        .order('created_at', { ascending: false })
        .limit(500),
      sb.from('b2b_materials').select('*').eq('active', true).order('name'),
      sb.from('cutting_settings').select('*').eq('id', 1).single(),
    ])

    const parsed = (ordersData ?? []).map((o: Record<string, unknown>) => {
      const notes = parseNotes(o.notes as string | null)
      const status = (notes.status as string) ?? ''
      const stages = (notes.stages ?? {}) as Record<string, string | null>
      const items = (o.items ?? []) as Item[]
      return {
        ...o,
        status,
        materialOrdered: !!stages.material_ordered,
        totalAreaNet: items.reduce((s, it) => s + getItemArea(it), 0),
        totalPieces: items.reduce((s, it) => s + (it.quantity ?? 1), 0),
        items,
      } as Order
    }).filter((o: Order) =>
      o.items.some(it => (it.width ?? 0) > 0 && (it.height ?? 0) > 0) &&
      o.status !== 'quote'
    )

    setOrders(parsed)
    setMaterials((matsData ?? []) as B2BMaterial[])
    if (settingsData) setSettings(settingsData as CuttingSettings)
    setLoading(false)
  }

  const visibleOrders = useMemo(() =>
    showAll ? orders : orders.filter(o => !o.materialOrdered),
    [orders, showAll]
  )

  function toggleOrder(id: number) {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function selectAll() { setSelectedIds(new Set(visibleOrders.map(o => o.id))) }
  function clearAll()  { setSelectedIds(new Set()) }

  function buildPieceGroups(): Map<string, PieceGroup> {
    const matLookup = new Map<string, B2BMaterial>()
    for (const m of materials) matLookup.set(`${m.name}|${m.thickness}`, m)

    const groups = new Map<string, PieceGroup>()
    for (const order of orders.filter(o => selectedIds.has(o.id))) {
      for (const item of order.items) {
        if (!item.width || !item.height) continue
        // Слои детали: обычная позиция = 1 слой; триплекс = все стёкла пакета (толщины могут отличаться).
        const layers: { name: string; thk: number }[] = [
          { name: item.materialName ?? 'Неизвестно', thk: item.thickness ?? 0 },
        ]
        if (item.hasTriplex) {
          const extras = item.triplexGlasses?.length
            ? item.triplexGlasses
            : Array.from({ length: (item.triplexLayers === 3 ? 3 : 2) - 1 }, () => ({ materialName: item.materialName, thickness: item.thickness }))
          for (const g of extras) layers.push({ name: g.materialName ?? item.materialName ?? 'Неизвестно', thk: g.thickness ?? item.thickness ?? 0 })
        }

        for (const layer of layers) {
          const mName = layer.name
          const mThk  = layer.thk
          const mCat  = item.category ?? ''
          const matKey = `${mName}|${mThk}|${mCat}`
          const mat = matLookup.get(`${mName}|${mThk}`) as (B2BMaterial & { sheet_width?: number; sheet_height?: number; pattern_direction?: string }) | undefined

          if (!groups.has(matKey)) {
            groups.set(matKey, {
              pieces: [],
              materialLabel: `${mName} ${mThk > 0 ? mThk + ' мм' : ''}`.trim(),
              category: mCat,
              sheetWidth:  mat?.sheet_width  ?? 3210,
              sheetHeight: mat?.sheet_height ?? 2250,
              patternDirection: (mat?.pattern_direction ?? 'none') as 'none' | 'along_length' | 'along_width',
            })
          }

          const group = groups.get(matKey)!
          const qty = item.quantity ?? 1
          for (let i = 0; i < qty; i++) {
            group.pieces.push({
              id: `${order.id}-${mName}-${mThk}-${group.pieces.length}`,
              width: item.width,
              height: item.height,
              label: `${item.width}×${item.height}`,
              orderId: order.id,
              orderClientName: order.client_name,
              materialKey: matKey,
              canRotate: true,
            })
          }
        }
      }
    }
    return groups
  }

  function runOptimizer() {
    const groups = buildPieceGroups()
    if (groups.size === 0) return
    const res = runCuttingOptimizer(groups, settings)
    setResults(res)
    setPieceGroups(groups)
    setPrevResults(null)
    setExpandedMat(new Set(res.map(r => r.materialKey)))
    setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
  }

  async function runOptimize() {
    if (!results) return
    setOptimizing(true)
    await new Promise(r => setTimeout(r, 50))
    const groups = buildPieceGroups()
    const optimized = runCuttingOptimizerOptimized(groups, settings, 1500)
    setPrevResults(results)
    setResults(optimized)
    setPieceGroups(groups)
    setExpandedMat(new Set(optimized.map(r => r.materialKey)))
    setOptimizing(false)
  }

  async function savePlan() {
    if (!results) return
    setSaving(true)
    const sb = createClient()
    const { data } = await sb.from('cutting_plans').insert({
      title: `Раскрой ${new Date().toLocaleDateString('ru-RU')}`,
      order_ids: Array.from(selectedIds),
      plan_data: results,
      status: 'draft',
    }).select('id').single()
    if (data?.id) setSavedId(data.id)
    setSaving(false)
  }

  // Печатная заявка поставщику на материал из текущего плана раскроя.
  // Открывается в отдельном окне, чтобы не трогать стили страницы. Цену/сумму
  // заполняет поставщик при выставлении счёта.
  function printSupplierRequest() {
    if (!results || results.length === 0) return
    const esc = (s: string) => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] || c))
    const date = new Date().toLocaleDateString('ru-RU')
    const rows = results.map(r => `
      <tr>
        <td>${esc(r.materialLabel)}</td>
        <td class="c"><b>${r.sheetsNeeded}</b></td>
        <td class="c">${r.sheetWidth}×${r.sheetHeight}</td>
        <td class="c">${r.totalPieces}</td>
        <td class="c">${(r.totalSheetArea / 1_000_000).toFixed(2)}</td>
        <td></td><td></td>
      </tr>`).join('')
    const totalSheets = results.reduce((s, r) => s + r.sheetsNeeded, 0)
    const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Заявка поставщику</title>
      <style>
        body{font-family:-apple-system,Arial,sans-serif;color:#111;margin:24px;font-size:13px}
        h1{font-size:18px;margin:0 0 2px} .muted{color:#777;font-size:12px;margin:0 0 16px}
        table{width:100%;border-collapse:collapse;margin-top:10px}
        th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}
        th{background:#f5f5f3;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#555}
        td.c,th.c{text-align:center}
        tfoot td{font-weight:bold;background:#fafafa}
        .sign{margin-top:32px;font-size:12px;color:#555}
        @media print{button{display:none}}
      </style></head><body>
      <h1>M-GLASS · Заявка на материал</h1>
      <p class="muted">Дата: ${date} · Заказов в раскрое: ${selectedIds.size} · Просьба выставить счёт на оплату</p>
      <table>
        <thead><tr>
          <th>Материал</th><th class="c">Листов</th><th class="c">Размер листа, мм</th>
          <th class="c">Деталей</th><th class="c">Площадь, м²</th><th class="c">Цена за лист</th><th class="c">Сумма</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td>Итого</td><td class="c">${totalSheets}</td><td colspan="5"></td></tr></tfoot>
      </table>
      <p class="sign">Заявку составил: _____________________  ·  Поставщик: _____________________</p>
      <button onclick="window.print()" style="margin-top:20px;padding:8px 16px;font-size:13px;cursor:pointer">🖨 Печать</button>
      </body></html>`
    const w = window.open('', '_blank', 'width=800,height=900')
    if (w) { w.document.write(html); w.document.close() }
  }

  // Сохранить заявку как запись закупки → попадает в /admin/procurement,
  // где владелец/закупщик ведёт её по статусам (счёт → оплата → забрали).
  async function savePurchaseRequest() {
    if (!results || results.length === 0) return
    setSavingProc(true)
    const items = results.map(r => ({
      name: r.materialLabel,
      thickness: Number(r.materialKey.split('|')[1]) || 0,
      sheets: r.sheetsNeeded,
    }))
    const order_refs = orders.filter(o => selectedIds.has(o.id)).map(o => `${o.client_name} #${o.id}`)
    const res = await fetch('/api/admin/purchase-orders', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        supplier_name: '',
        items, order_refs, b2b_order_ids: Array.from(selectedIds),
        comment: `Заявка из раскроя ${new Date().toLocaleDateString('ru-RU')} — внести № счёта и поставщика`,
      }),
    })
    setSavingProc(false)
    setProcSaved(res.ok)
    if (!res.ok) alert('Не удалось сохранить заявку (нужны права закупок).')
  }

  // Ориентировочная себестоимость листов по материалу: листы × площадь × cost_price.
  // Та же формула, что в lib/productionSummary.ts (sheetCost) — без выдумок.
  function estSheetCost(r: { materialKey: string; sheetWidth: number; sheetHeight: number; sheetsNeeded: number }): number {
    const [name, thk] = r.materialKey.split('|')
    const mat = materials.find(m => `${m.name}|${m.thickness}` === `${name}|${thk}`) as { cost_price?: number | null } | undefined
    const cp = mat?.cost_price ?? 0
    const areaM2 = r.sheetWidth * r.sheetHeight / 1_000_000
    return Math.round(r.sheetsNeeded * areaM2 * cp)
  }

  // Сверка со складом: сколько листов на складе и сколько докупить.
  function stockInfo(r: { materialKey: string; sheetsNeeded: number }): { stock: number; toBuy: number } {
    const [name, thk] = r.materialKey.split('|')
    const mat = materials.find(m => `${m.name}|${m.thickness}` === `${name}|${thk}`) as { stock_sheets?: number | null } | undefined
    const stock = Number(mat?.stock_sheets ?? 0)
    return { stock, toBuy: Math.max(0, r.sheetsNeeded - stock) }
  }

  const selectedCount    = selectedIds.size
  const totalPiecesCount = orders.filter(o => selectedIds.has(o.id)).reduce((s, o) => s + o.totalPieces, 0)
  const needsMaterialCount = orders.filter(o => !o.materialOrdered).length

  if (loading) {
    return (
      <div className="min-h-screen bg-[#fafaf9] flex items-center justify-center">
        <div className="text-[#9a9a95] text-[14px]">Загрузка заказов...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#fafaf9] py-6 px-4">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-bold text-[#111110]">Планирование раскроя</h1>
            <p className="text-[13px] text-[#9a9a95] mt-1">Выберите заказы → авто-раскрой + редактор ручной раскладки</p>
          </div>
          <a href="/admin/cutting-settings" className="text-[12px] text-blue-600 hover:underline whitespace-nowrap">⚙ Настройки раскроя</a>
        </div>

        {/* Settings bar */}
        <div className="bg-white rounded-xl border border-[#e4e4e0] px-4 py-3 flex flex-wrap items-center gap-4 text-[12px]">
          <span className="font-semibold text-[#4b4b47]">Параметры:</span>
          <span className="text-[#6b6b66]">Зазор <b>{settings.gap_between_pieces} мм</b></span>
          <span className="text-[#6b6b66]">Кромка <b>{settings.edge_margin} мм</b></span>
          <span className="text-[#6b6b66]">Поворот <b>{settings.allow_rotation ? 'разрешён' : 'запрещён'}</b></span>
          <span className="text-[#6b6b66]">Рисунок <b>{settings.respect_pattern ? 'учитывается' : 'игнорируется'}</b></span>
        </div>

        {/* Filter toggle */}
        <div className="flex items-center gap-2">
          <button onClick={() => setShowAll(false)}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-colors ${
              !showAll ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-[#4b4b47] border-[#e4e4e0] hover:bg-[#f5f5f3]'
            }`}
          >Ждут материала ({needsMaterialCount})</button>
          <button onClick={() => setShowAll(true)}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-colors ${
              showAll ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-[#4b4b47] border-[#e4e4e0] hover:bg-[#f5f5f3]'
            }`}
          >Все активные ({orders.length})</button>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={selectAll} className="text-[11px] text-blue-600 hover:underline">Выбрать все</button>
            <span className="text-[#d0d0cc]">·</span>
            <button onClick={clearAll} className="text-[11px] text-[#9a9a95] hover:underline">Снять</button>
          </div>
        </div>

        {/* Orders list */}
        {visibleOrders.length === 0 ? (
          <div className="bg-white rounded-xl border border-[#e4e4e0] p-8 text-center text-[14px] text-[#9a9a95]">
            Нет заказов, ожидающих материала
          </div>
        ) : (
          <div className="space-y-2">
            {visibleOrders.map(order => {
              const sel = selectedIds.has(order.id)
              const matSummary = new Map<string, number>()
              for (const it of order.items) {
                const k = `${it.materialName ?? '?'} ${it.thickness ?? '?'} мм`
                matSummary.set(k, (matSummary.get(k) ?? 0) + (it.quantity ?? 1))
              }
              return (
                <div key={order.id} onClick={() => toggleOrder(order.id)}
                  className={`bg-white rounded-xl border-2 transition-all cursor-pointer hover:shadow-sm ${
                    sel ? 'border-blue-400 bg-blue-50/30' : 'border-[#e4e4e0] hover:border-[#c4c4be]'
                  }`}
                >
                  <div className="px-4 py-3 flex items-center gap-3">
                    <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                      sel ? 'bg-blue-600 border-blue-600' : 'border-[#c4c4be] bg-white'
                    }`}>
                      {sel && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[14px] font-semibold text-[#111110]">{order.client_name}</span>
                        {order.materialOrdered
                          ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">Материал заказан</span>
                          : <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">Ждёт материала</span>
                        }
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                        {Array.from(matSummary.entries()).map(([k, qty]) => (
                          <span key={k} className="text-[11px] text-[#6b6b66]">{k} · {qty} шт</span>
                        ))}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-[12px] text-[#6b6b66]">{order.totalPieces} {order.totalPieces === 1 ? 'деталь' : order.totalPieces < 5 ? 'детали' : 'деталей'}</div>
                      <div className="text-[11px] text-[#9a9a95]">{order.totalAreaNet.toFixed(2)} м²</div>
                      <div className="text-[11px] text-[#9a9a95]">{new Date(order.created_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}</div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-3">
          <button onClick={runOptimizer} disabled={selectedCount === 0}
            className="px-6 py-3 bg-blue-600 text-white rounded-xl text-[14px] font-semibold hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm"
          >
            {selectedCount === 0
              ? 'Выберите заказы'
              : `Создать раскрой → ${selectedCount} ${selectedCount === 1 ? 'заказ' : selectedCount < 5 ? 'заказа' : 'заказов'}, ${totalPiecesCount} деталей`}
          </button>
          {results && (
            <>
              <button onClick={runOptimize} disabled={optimizing}
                className="px-4 py-3 bg-emerald-600 text-white rounded-xl text-[13px] font-semibold hover:bg-emerald-700 disabled:opacity-60 transition-colors flex items-center gap-2"
              >
                {optimizing ? (
                  <><span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />Перебираю варианты...</>
                ) : '⚡ Оптимизировать'}
              </button>
              <button onClick={savePlan} disabled={saving}
                className="px-4 py-3 bg-white border border-[#e4e4e0] text-[#4b4b47] rounded-xl text-[13px] font-medium hover:bg-[#f5f5f3] disabled:opacity-50 transition-colors"
              >
                {saving ? 'Сохраняю...' : savedId ? '✓ Сохранено' : 'Сохранить план'}
              </button>
            </>
          )}
        </div>

        {/* Results */}
        {results && (
          <div ref={resultsRef} className="space-y-4 pt-2">

            {/* Optimization banner */}
            {prevResults && (() => {
              const prevSheets = prevResults.reduce((s, r) => s + r.sheetsNeeded, 0)
              const curSheets  = results.reduce((s, r) => s + r.sheetsNeeded, 0)
              const saved = prevSheets - curSheets
              const totalStrategies = results.reduce((s, r) => s + (r.strategiesChecked ?? 0), 0)
              return (
                <div className={`rounded-xl px-4 py-3 border flex items-center gap-3 text-[13px] ${
                  saved > 0 ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-[#f5f5f3] border-[#e4e4e0] text-[#6b6b66]'
                }`}>
                  <span className="text-[20px]">{saved > 0 ? '🎉' : '✓'}</span>
                  <div>
                    {saved > 0
                      ? <span className="font-semibold">Оптимизация сэкономила <b>{saved} {saved === 1 ? 'лист' : saved < 5 ? 'листа' : 'листов'}</b> ({prevSheets} → {curSheets})</span>
                      : <span className="font-semibold">Исходный раскрой уже оптимален</span>
                    }
                    <span className="ml-2 text-[11px] opacity-70">перебрано {totalStrategies} вариантов</span>
                  </div>
                </div>
              )
            })()}

            {/* Global unplaced warning */}
            {(() => {
              const totalUnplaced = results.reduce((s, r) => s + (r.unplacedCount ?? (r.unplacedPieces?.length ?? 0)), 0)
              if (totalUnplaced === 0) return null
              return (
                <div className="bg-red-50 border border-red-300 rounded-xl px-4 py-3 flex items-start gap-3 text-[13px] text-red-800">
                  <span className="text-[18px] flex-shrink-0">⚠</span>
                  <div>
                    <span className="font-semibold">
                      {totalUnplaced} {totalUnplaced === 1 ? 'деталь не помещается' : totalUnplaced < 5 ? 'детали не помещаются' : 'деталей не помещаются'} ни на один лист
                    </span>
                    <span className="ml-1 text-red-600 text-[12px]">— раскройте карту материала для подробностей</span>
                  </div>
                </div>
              )
            })()}

            {/* Purchase summary */}
            <div className="bg-white rounded-xl border border-[#e4e4e0] overflow-hidden">
              <div className="px-4 py-3 border-b border-[#f0f0ec] bg-[#fafaf9] flex items-center justify-between gap-2">
                <h2 className="text-[15px] font-bold text-[#111110]">Список закупки</h2>
                <div className="flex items-center gap-2">
                  <button onClick={savePurchaseRequest} disabled={savingProc || procSaved}
                    className="text-[12px] font-medium px-3 py-1.5 rounded-lg border border-[#e4e4e0] text-[#6b6b66] hover:border-[#111110] hover:text-[#111110] disabled:opacity-50 transition-colors whitespace-nowrap">
                    {procSaved ? '✓ В закупках' : savingProc ? 'Сохранение…' : 'Сохранить в закупки'}
                  </button>
                  <button onClick={printSupplierRequest}
                    className="text-[12px] font-medium px-3 py-1.5 rounded-lg bg-[#111110] text-white hover:bg-[#2a2a28] transition-colors whitespace-nowrap">
                    🖨 Заявка поставщику
                  </button>
                </div>
              </div>
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-[#f0f0ec]">
                    <th className="px-4 py-2.5 text-left text-[#9a9a95] font-medium">Материал</th>
                    <th className="px-4 py-2.5 text-center text-[#9a9a95] font-medium">Листов</th>
                    <th className="px-4 py-2.5 text-center text-[#9a9a95] font-medium">Размер листа</th>
                    <th className="px-4 py-2.5 text-center text-[#9a9a95] font-medium">Деталей</th>
                    <th className="px-4 py-2.5 text-center text-[#9a9a95] font-medium">КПД</th>
                    <th className="px-4 py-2.5 text-center text-[#9a9a95] font-medium whitespace-nowrap" title="На складе / докупить">Склад</th>
                    <th className="px-4 py-2.5 text-center text-[#9a9a95] font-medium">Рисунок</th>
                    <th className="px-4 py-2.5 text-right text-[#9a9a95] font-medium whitespace-nowrap" title="Ориентировочная себестоимость листов">Ориентир. ₽</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map(r => (
                    <tr key={r.materialKey} className="border-b border-[#f0f0ec] last:border-0 hover:bg-[#fafaf9]">
                      <td className="px-4 py-3 font-semibold text-[#111110]">{r.materialLabel}</td>
                      <td className="px-4 py-3 text-center">
                        <span className="font-bold text-blue-700 text-[15px]">{r.sheetsNeeded}</span>
                        <span className="text-[#9a9a95] ml-1">{r.sheetsNeeded === 1 ? 'лист' : r.sheetsNeeded < 5 ? 'листа' : 'листов'}</span>
                      </td>
                      <td className="px-4 py-3 text-center text-[#6b6b66] font-mono text-[12px]">{r.sheetWidth}×{r.sheetHeight}</td>
                      <td className="px-4 py-3 text-center text-[#6b6b66]">{r.totalPieces}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-[12px] font-semibold ${
                          r.avgEfficiency >= 70 ? 'text-emerald-600' : r.avgEfficiency >= 50 ? 'text-amber-600' : 'text-red-600'
                        }`}>{r.avgEfficiency}%</span>
                      </td>
                      <td className="px-4 py-3 text-center text-[12px] whitespace-nowrap">
                        {(() => { const { stock, toBuy } = stockInfo(r); return (
                          <>
                            <span className="text-[#6b6b66]">скл. {stock % 1 === 0 ? stock : stock.toFixed(1)}</span>
                            {toBuy > 0
                              ? <span className="ml-1 font-semibold text-red-600">· докупить {toBuy % 1 === 0 ? toBuy : toBuy.toFixed(1)}</span>
                              : <span className="ml-1 font-semibold text-emerald-600">· хватает</span>}
                          </>
                        )})()}
                      </td>
                      <td className="px-4 py-3 text-center text-[#9a9a95] text-[11px]">
                        {r.patternDirection === 'along_length' ? '↔ По длине' : r.patternDirection === 'along_width' ? '↕ По ширине' : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-[#111110] whitespace-nowrap">
                        {estSheetCost(r) > 0 ? `${estSheetCost(r).toLocaleString('ru-RU')} ₽` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-4 py-3 bg-[#fafaf9] border-t border-[#f0f0ec] flex flex-wrap gap-4 text-[12px] text-[#6b6b66]">
                <span>Итого листов: <b className="text-[#111110]">{results.reduce((s, r) => s + r.sheetsNeeded, 0)}</b></span>
                <span>Деталей: <b className="text-[#111110]">{results.reduce((s, r) => s + r.totalPieces, 0)}</b></span>
                <span>Площадь листов: <b className="text-[#111110]">{(results.reduce((s, r) => s + r.totalSheetArea, 0) / 1_000_000).toFixed(2)} м²</b></span>
                {(() => { const tot = results.reduce((s, r) => s + estSheetCost(r), 0); return tot > 0 ? <span>Ориентир. себестоимость: <b className="text-[#111110]">{tot.toLocaleString('ru-RU')} ₽</b></span> : null })()}
              </div>
            </div>

            {/* Per-material cutting layouts */}
            <div className="space-y-3">
              <h2 className="text-[15px] font-bold text-[#111110]">Карты раскроя</h2>
              {results.map(r => (
                <MaterialSection
                  key={r.materialKey}
                  result={r}
                  edgeMargin={settings.edge_margin}
                  gap={settings.gap_between_pieces}
                  pieces={pieceGroups?.get(r.materialKey)?.pieces ?? []}
                  expanded={expandedMat.has(r.materialKey)}
                  onToggle={() => {
                    setExpandedMat(prev => {
                      const next = new Set(prev)
                      next.has(r.materialKey) ? next.delete(r.materialKey) : next.add(r.materialKey)
                      return next
                    })
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
