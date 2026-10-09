'use client'

import { useEffect, useRef, useState } from 'react'
import type { Edge, Spot } from '@/lib/calc/composeDraft'
import { sameSpot, type Elevation, type LMark, type LPanel, type P, type Plan } from '@/lib/calc/composeLayout'

// Схема собранного (CONSTRUCTOR_ROUTE.md, К3): фасад снаружи развёрткой и план сверху.
// Касание детали выбирает её строку; пока строка выбрана, касание кромки ставит деталь туда
// или убирает. Размеры — из состава, цену схема не знает и не считает.

const GLASS_STROKE = '#7c8c93'
const DIM = '#9a9a95'
const INK = '#111110'
const FACADE_MAX_H = 300      // px — фасад не выше этого: вид, панель и итог — на одном экране (К9 В2)

// Ширина контейнера в px: шрифт и толщины задаём в пикселях экрана, а не в миллиметрах.
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    // Сразу, а не ждать наблюдателя: в скрытой вкладке он молчит до показа, и схема пустая.
    setW(el.getBoundingClientRect().width)
    const ro = new ResizeObserver(e => setW(e[0].contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

// Подбор масштаба: поля зависят от шрифта, шрифт — от масштаба. Двух шагов хватает.
function fit(contentW: number, px: number, pad: (fs: number) => { l: number; r: number }) {
  let fs = 11 / Math.max(px / Math.max(contentW + 800, 1), 1e-4)
  for (let i = 0; i < 2; i++) {
    const p = pad(fs)
    const scale = px / (contentW + p.l + p.r)
    fs = 11 / scale
  }
  const p = pad(fs)
  return { fs, k: fs / 11, ...p }
}

const EDGES: Edge[] = ['left', 'right', 'top', 'bottom']
function edgeLine(p: LPanel, e: Edge): [number, number, number, number] {
  if (e === 'left') return [p.x0, 0, p.x0, p.h]
  if (e === 'right') return [p.x0 + p.w, 0, p.x0 + p.w, p.h]
  if (e === 'top') return [p.x0, p.h, p.x0 + p.w, p.h]
  return [p.x0, 0, p.x0 + p.w, 0]
}

export function ComposeScheme({ elevation, plan, selected, activeSpots, onSelect, onEdge, glassSwatch, finishHex }: {
  elevation: Elevation
  plan: Plan
  selected: string | null
  activeSpots: Spot[]
  onSelect: (rowId: string) => void
  onEdge: (s: Spot) => void
  glassSwatch: string
  finishHex: string
}) {
  const showPlan = elevation.panels.some(p => p.kind !== 'fixed') || elevation.panels.some(p => p.run === 'side')
  return (
    <div className={`grid gap-3 ${showPlan ? 'sm:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)]' : ''} items-end`}>
      <Facade elevation={elevation} selected={selected} activeSpots={activeSpots} onSelect={onSelect} onEdge={onEdge} glassSwatch={glassSwatch} finishHex={finishHex} />
      {showPlan && <PlanView plan={plan} />}
    </div>
  )
}

function Facade({ elevation: el, selected, activeSpots, onSelect, onEdge, glassSwatch, finishHex }: {
  elevation: Elevation; selected: string | null; activeSpots: Spot[]
  onSelect: (rowId: string) => void; onEdge: (s: Spot) => void; glassSwatch: string; finishHex: string
}) {
  const [ref, px] = useWidth<HTMLDivElement>()
  const WALL = 70
  const frameAt = (w: number) => {
    const f = fit(el.width, w, x => ({ l: WALL + x * 4.2, r: WALL + x }))
    const top = el.height + f.fs * 1.6
    return { ...f, top, vbW: el.width + f.l + f.r, vbH: top + f.fs * 3.4 }
  }
  // Узкая высокая душевая (дверь 424 × 2004) растягивала фасад на экран: рисунок сужаем,
  // пока он не влезет по высоте, а не только по ширине колонки.
  let pxW = px || 600
  let fr = frameAt(pxW)
  for (let i = 0; i < 3 && (fr.vbH / fr.vbW) * pxW > FACADE_MAX_H; i++) {
    pxW = (pxW * FACADE_MAX_H) / ((fr.vbH / fr.vbW) * pxW)
    fr = frameAt(pxW)
  }
  const { fs, k, l, top } = fr
  const vb = `${-l} ${-top} ${fr.vbW} ${fr.vbH}`
  const pxH = (fr.vbH / fr.vbW) * pxW
  const dimmed = (rowId: string) => !!selected && rowId !== selected
  const markColor = (rowId: string) => (selected === rowId ? INK : '#55554f')

  // Номер строки — у первой детали каждой группы (строка × кромка), сбоку от неё.
  const badges: { key: string; x: number; y: number; num: number; rowId: string }[] = []
  const seen = new Set<string>()
  for (const m of el.marks) {
    const key = `${m.rowId}:${m.panelId}:${m.edge}`
    if (seen.has(key)) continue
    seen.add(key)
    const dx = m.edge === 'left' ? 1 : m.edge === 'right' ? -1 : 0
    badges.push({ key, num: m.num, rowId: m.rowId, x: m.x + dx * fs * 1.6, y: m.y + (dx ? 0 : fs * 1.4) })
  }

  return (
    <div ref={ref} className="min-w-0">
      {px > 0 && (
        <svg viewBox={vb} width={pxW} height={pxH} className="block select-none mx-auto" style={{ touchAction: 'manipulation' }}>
          <defs>
            <pattern id="cs-hatch" width={fs * 0.9} height={fs * 0.9} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2={fs * 0.9} stroke="#d6d6d1" strokeWidth={k * 1.5} />
            </pattern>
          </defs>
          <g transform="scale(1,-1)">
            <line x1={-WALL} y1={0} x2={el.width + WALL} y2={0} stroke="#c9c9c4" strokeWidth={k * 1.5} />
            {el.walls.map(w => (
              <rect key={`${w.x}-${w.side}`} x={w.side === 'left' ? w.x - WALL : w.x} y={0} width={WALL} height={el.height + 150}
                fill="url(#cs-hatch)" stroke="#c9c9c4" strokeWidth={k} />
            ))}
            {el.corner != null && (
              <line x1={el.corner} y1={0} x2={el.corner} y2={el.height + 60} stroke="#c9c9c4" strokeWidth={k} strokeDasharray={`${fs * 0.5} ${fs * 0.4}`} />
            )}
            {el.panels.map(p => (
              <g key={p.id}>
                <rect x={p.x0} y={0} width={p.w} height={p.h} fill={glassSwatch} fillOpacity={0.45} stroke={GLASS_STROKE} strokeWidth={k * 1.2} />
                {p.kind === 'door' && p.hinge && (() => {
                  const hx = p.hinge === 'left' ? p.x0 : p.x0 + p.w
                  const fx = p.hinge === 'left' ? p.x0 + p.w : p.x0
                  return <polyline points={`${fx},${p.h} ${hx},${p.h / 2} ${fx},0`} fill="none" stroke={DIM} strokeWidth={k} strokeDasharray={`${fs * 0.6} ${fs * 0.4}`} />
                })()}
                {p.kind === 'slide' && (() => {
                  const y = p.h * 0.62, a = p.x0 + p.w * 0.28, b = p.x0 + p.w * 0.72, hd = fs * 0.7
                  return <path d={`M${a},${y} L${b},${y} M${a + hd},${y + hd * 0.6} L${a},${y} L${a + hd},${y - hd * 0.6} M${b - hd},${y + hd * 0.6} L${b},${y} L${b - hd},${y - hd * 0.6}`} fill="none" stroke={DIM} strokeWidth={k * 1.2} />
                })()}
              </g>
            ))}
            {el.lines.map((ln, i) => (
              <line key={`l${i}`} x1={ln.x1} y1={ln.y1} x2={ln.x2} y2={ln.y2}
                stroke={selected === ln.rowId ? INK : '#a9a9a3'} strokeOpacity={dimmed(ln.rowId) ? 0.35 : 1}
                strokeWidth={k * (selected === ln.rowId ? 3.5 : 2)} strokeLinecap="round" />
            ))}
            {el.lines.map((ln, i) => (
              <line key={`lh${i}`} x1={ln.x1} y1={ln.y1} x2={ln.x2} y2={ln.y2} stroke="transparent" strokeWidth={k * 12}
                onClick={() => onSelect(ln.rowId)} className="cursor-pointer" />
            ))}
            {el.marks.map((m, i) => (
              <Mark key={`m${i}`} m={m} k={k} fill={finishHex} stroke={markColor(m.rowId)} faded={dimmed(m.rowId)} onClick={() => onSelect(m.rowId)} />
            ))}
            {selected && el.panels.flatMap(p => EDGES.map(e => {
              const [x1, y1, x2, y2] = edgeLine(p, e)
              const on = activeSpots.some(s => sameSpot(s, { panelId: p.id, edge: e }))
              return (
                <g key={`${p.id}-${e}`} onClick={() => onEdge({ panelId: p.id, edge: e })} className="cursor-pointer group">
                  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={on ? '#2563eb' : 'transparent'} strokeWidth={k * 4} strokeOpacity={0.55} />
                  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#2563eb" strokeWidth={k * 3} strokeDasharray={`${fs * 0.5} ${fs * 0.35}`} className="opacity-0 group-hover:opacity-70" />
                  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={k * 18} />
                </g>
              )
            }))}
          </g>
          {badges.map(b => (
            <g key={b.key} onClick={() => onSelect(b.rowId)} className="cursor-pointer" opacity={dimmed(b.rowId) ? 0.35 : 1}>
              <circle cx={b.x} cy={-b.y} r={fs * 0.72} fill={selected === b.rowId ? INK : '#ffffff'} stroke={INK} strokeWidth={k} />
              <text x={b.x} y={-b.y} dy="0.36em" textAnchor="middle" fontSize={fs * 0.85} fontWeight={600} fill={selected === b.rowId ? '#ffffff' : INK}>{b.num}</text>
            </g>
          ))}
          {el.panels.map(p => {
            const fits = p.w > p.label.length * fs * 0.55 + fs
            return (
              <g key={`t${p.id}`} pointerEvents="none">
                {fits && <text x={p.x0 + p.w / 2} y={-p.h + fs * 1.3} textAnchor="middle" fontSize={fs * 0.9} fill="#4b4b47">{p.label}</text>}
                <line x1={p.x0} y1={fs * 1.3} x2={p.x0 + p.w} y2={fs * 1.3} stroke={DIM} strokeWidth={k} />
                <line x1={p.x0} y1={fs * 0.8} x2={p.x0} y2={fs * 1.8} stroke={DIM} strokeWidth={k} />
                <line x1={p.x0 + p.w} y1={fs * 0.8} x2={p.x0 + p.w} y2={fs * 1.8} stroke={DIM} strokeWidth={k} />
                <text x={p.x0 + p.w / 2} y={fs * 2.7} textAnchor="middle" fontSize={fs} fontFamily="ui-monospace, monospace" fill="#4b4b47">{p.w}</text>
              </g>
            )
          })}
          {el.panels.length > 0 && (() => {
            const x = -WALL - fs * 1.4
            const hs = [...new Set(el.panels.map(p => p.h))]
            return (
              <g pointerEvents="none">
                <line x1={x} y1={0} x2={x} y2={-el.height} stroke={DIM} strokeWidth={k} />
                <line x1={x - fs * 0.5} y1={0} x2={x + fs * 0.5} y2={0} stroke={DIM} strokeWidth={k} />
                <line x1={x - fs * 0.5} y1={-el.height} x2={x + fs * 0.5} y2={-el.height} stroke={DIM} strokeWidth={k} />
                <text x={x - fs * 0.6} y={-el.height / 2} textAnchor="middle" fontSize={fs} fontFamily="ui-monospace, monospace" fill="#4b4b47"
                  transform={`rotate(-90 ${x - fs * 0.6} ${-el.height / 2})`}>{hs.length > 1 ? `до ${el.height}` : el.height}</text>
              </g>
            )
          })()}
          {el.corner != null && (
            <text x={el.corner} y={-el.height - fs * 0.6} textAnchor="middle" fontSize={fs * 0.85} fill={DIM} pointerEvents="none">угол</text>
          )}
        </svg>
      )}
      <p className="text-[11px] text-[#9a9a95] mt-1">Вид снаружи{el.corner != null ? ' · боковая сторона развёрнута за углом' : ''}</p>
    </div>
  )
}

// Деталь на фасаде. Размер — в пикселях экрана (k = мм на px), иначе петля на широкой
// душевой превращается в точку, а на узкой — в кирпич.
function Mark({ m, k, fill, stroke, faded, onClick }: { m: LMark; k: number; fill: string; stroke: string; faded: boolean; onClick: () => void }) {
  const common = { fill, stroke, strokeWidth: k * 1.2, opacity: faded ? 0.35 : 1, onClick, className: 'cursor-pointer' }
  const box = (w: number, h: number) => <rect x={m.x - (w * k) / 2} y={m.y - (h * k) / 2} width={w * k} height={h * k} rx={k * 1.5} {...common} />
  if (m.type === 'hinge') return box(8, 16)
  if (m.type === 'handle') return box(5, 30)
  if (m.type === 'connector') return box(9, 9)
  return <circle cx={m.x} cy={m.y} r={(m.type === 'mount' ? 5 : 4) * k} {...common} />
}

function PlanView({ plan }: { plan: Plan }) {
  const [ref, px] = useWidth<HTMLDivElement>()
  const w = plan.maxX - plan.minX, h = plan.maxY - plan.minY
  const pad = Math.max(w, h) * 0.08 + 60
  const vbW = w + pad * 2, vbH = h + pad * 2
  const k = px ? vbW / px : 1
  const pxH = px ? Math.min((vbH / vbW) * px, 260) : 0
  // План: x вправо, y вглубь — на экране вглубь значит вверх, вход снизу.
  const sx = (p: P) => p[0], sy = (p: P) => -p[1]
  const glass = '#7fa0ad'
  return (
    <div ref={ref} className="min-w-0">
      {px > 0 && (
        <svg viewBox={`${plan.minX - pad} ${-plan.maxY - pad} ${vbW} ${vbH}`} width={px} height={pxH} preserveAspectRatio="xMidYMid meet" className="block">
          {plan.walls.map(([a, b], i) => <line key={`w${i}`} x1={sx(a)} y1={sy(a)} x2={sx(b)} y2={sy(b)} stroke="#c9c9c4" strokeWidth={k * 7} strokeLinecap="square" />)}
          {plan.fixed.map(([a, b], i) => <line key={`f${i}`} x1={sx(a)} y1={sy(a)} x2={sx(b)} y2={sy(b)} stroke={glass} strokeWidth={k * 3.5} />)}
          {plan.slides.map(([a, b], i) => <line key={`s${i}`} x1={sx(a)} y1={sy(a)} x2={sx(b)} y2={sy(b)} stroke={glass} strokeWidth={k * 3.5} strokeDasharray={`${k * 10} ${k * 4}`} />)}
          {plan.doors.map((d, i) => {
            const r = Math.hypot(d.open[0] - d.hinge[0], d.open[1] - d.hinge[1])
            const ax = sx(d.closed) - sx(d.hinge), ay = sy(d.closed) - sy(d.hinge)
            const bx = sx(d.open) - sx(d.hinge), by = sy(d.open) - sy(d.hinge)
            const sweep = ax * by - ay * bx > 0 ? 1 : 0
            return (
              <g key={`d${i}`}>
                <path d={`M${sx(d.closed)},${sy(d.closed)} A${r},${r} 0 0 ${sweep} ${sx(d.open)},${sy(d.open)}`} fill="none" stroke={DIM} strokeWidth={k} strokeDasharray={`${k * 5} ${k * 4}`} />
                <line x1={sx(d.hinge)} y1={sy(d.hinge)} x2={sx(d.open)} y2={sy(d.open)} stroke={glass} strokeWidth={k * 3.5} />
                <circle cx={sx(d.hinge)} cy={sy(d.hinge)} r={k * 3} fill={INK} />
              </g>
            )
          })}
        </svg>
      )}
      <p className="text-[11px] text-[#9a9a95] mt-1">План сверху · вход снизу</p>
    </div>
  )
}
