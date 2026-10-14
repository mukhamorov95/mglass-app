'use client'

import type { DfmIssue, PartGeometry } from '@/lib/glasmen'
import { num } from './api'

const circlePath = (cx: number, cy: number, r: number) =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`

export default function PartPreview({
  geom, issues, selected, mirror, onSelect,
}: {
  geom: PartGeometry
  issues: DfmIssue[]
  selected: number | null
  mirror: boolean
  onSelect: (idx: number | null) => void
}) {
  const W = geom.width, H = geom.height
  if (!(W > 0 && H > 0) || !geom.outerPathD) {
    return (
      <div className="flex aspect-[4/3] items-center justify-center rounded-xl border border-dashed border-[#e4e4e0] bg-white text-[13px] text-[#9a9a95]">
        Контура детали нет — нечего показать
      </div>
    )
  }

  const L = Math.max(W, H)
  const pad = L * 0.14
  const fs = L * 0.04
  const sw = L * 0.003
  const closed = geom.perimeter > 0
  const body = [geom.outerPathD, ...geom.cutouts.map(c => c.pathD), ...geom.holes.map(h => circlePath(h.cx, h.cy, h.d / 2))].join(' ')
  const fill = mirror ? '#dfe4e8' : '#d6ecee'
  const stroke = mirror ? '#7d8790' : '#4f8f97'
  const dimY = H + pad * 0.45
  const dimX = W + pad * 0.45
  const tick = pad * 0.12

  return (
    <svg
      viewBox={`${-pad * 0.5} ${-pad * 0.5} ${W + pad * 1.5} ${H + pad * 1.4}`}
      className="h-auto w-full rounded-xl border border-[#e4e4e0] bg-white"
      style={{ maxHeight: 460 }}
      role="img"
      aria-label={`Деталь ${num(W)}×${num(H)} мм`}
      onClick={() => onSelect(null)}
    >
      {closed
        ? <path d={body} fill={fill} fillRule="evenodd" stroke={stroke} strokeWidth={sw} />
        : <path d={geom.outerPathD} fill="none" stroke="#b91c1c" strokeWidth={sw * 1.5} strokeDasharray={`${sw * 6} ${sw * 4}`} />}

      {issues.map((it, idx) => {
        if (!it.region && !it.at) return null
        const hard = it.level === 'hard'
        const active = selected === idx
        const dim = selected !== null && !active
        const color = hard ? '#dc2626' : '#f59e0b'
        const r = it.region
        return (
          <g
            key={idx}
            opacity={dim ? 0.25 : 1}
            className="cursor-pointer"
            onClick={e => { e.stopPropagation(); onSelect(active ? null : idx) }}
          >
            {r && (
              <rect
                x={r.minX} y={r.minY}
                width={Math.max(r.maxX - r.minX, sw)} height={Math.max(r.maxY - r.minY, sw)}
                fill={color} fillOpacity={active ? 0.32 : 0.16}
                stroke={color} strokeWidth={active ? sw * 2 : sw} strokeDasharray={active ? undefined : `${sw * 4} ${sw * 3}`}
              />
            )}
            {it.at && <circle cx={it.at.x} cy={it.at.y} r={L * (active ? 0.018 : 0.012)} fill={color} stroke="#fff" strokeWidth={sw} />}
          </g>
        )
      })}

      <g stroke="#9a9a95" strokeWidth={sw} fill="#55554f" fontSize={fs} fontFamily="ui-sans-serif, system-ui">
        <line x1={0} y1={dimY} x2={W} y2={dimY} />
        <line x1={0} y1={dimY - tick} x2={0} y2={dimY + tick} />
        <line x1={W} y1={dimY - tick} x2={W} y2={dimY + tick} />
        <text x={W / 2} y={dimY + fs * 1.25} textAnchor="middle" stroke="none">{num(W)} мм</text>
        <line x1={dimX} y1={0} x2={dimX} y2={H} />
        <line x1={dimX - tick} y1={0} x2={dimX + tick} y2={0} />
        <line x1={dimX - tick} y1={H} x2={dimX + tick} y2={H} />
        <text x={dimX + fs * 0.6} y={H / 2} stroke="none" dominantBaseline="middle" transform={`rotate(90 ${dimX + fs * 0.6} ${H / 2})`} textAnchor="middle">{num(H)} мм</text>
      </g>
    </svg>
  )
}
