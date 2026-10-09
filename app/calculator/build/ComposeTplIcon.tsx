import { layoutPanels } from '@/lib/calc/composeLayout'
import type { ComposeTemplate } from '@/lib/calc/composeTemplates'

// Значок шаблона — вид спереди (CONSTRUCTOR_ROUTE.md, К9 В7): стены, стёкла в пропорции, ручка
// у двери, стрелка у раздвижной, излом угла. Шторка ниже двери — разница видна до касания.
const GLASS = '#7fa0ad', FILL = '#e6eff2', INK = '#111110', WALL = '#dcdcd7'
const STD_H = 2000

export function TplIcon({ t, px = 56, pxH = 48 }: { t: ComposeTemplate; px?: number; pxH?: number }) {
  const { panels, walls, corner } = layoutPanels(t.shape, t.panels.map(p => ({ ...p, id: p.key })))
  const last = panels[panels.length - 1]
  const W = last ? last.x0 + last.w : 1000
  const H = Math.max(STD_H, ...panels.map(p => p.h))
  const pad = 140
  const vbW = W + pad * 2, vbH = H + pad * 1.5
  const k = Math.max(vbW / px, vbH / pxH)
  const y = (v: number) => H - v
  return (
    <svg viewBox={`${-pad} ${-pad / 2} ${vbW} ${vbH}`} width={px} height={pxH} preserveAspectRatio="xMidYMid meet" aria-hidden className="block">
      {walls.map((w, i) => <rect key={`w${i}`} x={w.side === 'left' ? w.x - 90 : w.x} y={0} width={90} height={H} fill={WALL} />)}
      <line x1={-pad / 2} y1={H} x2={W + pad / 2} y2={H} stroke={WALL} strokeWidth={k * 1.5} />
      {corner != null && <line x1={corner} y1={y(H)} x2={corner} y2={H} stroke={GLASS} strokeWidth={k} strokeDasharray={`${k * 2} ${k * 2}`} />}
      {panels.map(p => {
        const x = p.x0 + 15, w = p.w - 30, top = y(p.h)
        const edge = (s: 'left' | 'right' | null, inset: number) => (s === 'left' ? x + inset : x + w - inset)
        return (
          <g key={p.id}>
            <rect x={x} y={top} width={w} height={p.h} fill={FILL} stroke={GLASS} strokeWidth={k} />
            {p.kind === 'door' && p.hinge && [top + 280, H - 280].map(hy => <rect key={hy} x={edge(p.hinge, 0) - 40} y={hy - 70} width={80} height={140} fill={INK} />)}
            {(p.kind === 'door' || p.kind === 'slide') && p.free && (
              <line x1={edge(p.free, 110)} y1={y(1250)} x2={edge(p.free, 110)} y2={y(750)} stroke={INK} strokeWidth={k * 1.6} strokeLinecap="round" />
            )}
            {p.kind === 'slide' && (() => {
              // Наконечник не длиннее десятой доли стекла: в значке иначе стрелка слипается в ромб.
              const a = Math.min(k * 2.5, w * 0.08), ay = top + 240, x1 = x + w * 0.2, x2 = x + w * 0.8
              return <path d={`M${x1},${ay} H${x2} M${x1 + a},${ay - a * 0.8} L${x1},${ay} L${x1 + a},${ay + a * 0.8} M${x2 - a},${ay - a * 0.8} L${x2},${ay} L${x2 - a},${ay + a * 0.8}`}
                fill="none" stroke={INK} strokeWidth={k} strokeLinecap="round" strokeLinejoin="round" />
            })()}
          </g>
        )
      })}
    </svg>
  )
}
