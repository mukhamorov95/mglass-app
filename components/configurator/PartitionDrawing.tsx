import { hingeCount, type Configuration } from '@/lib/configurator/catalog'

// Параметрический фронтальный чертёж перегородки — перерисовывается от размеров.
// Инженерная эстетика: стекло, профиль/штанга/петли/ручка в цвете финиша, размерные линии.

const PAD = { top: 48, right: 70, bottom: 56, left: 30 }
const AREA_W = 560
const AREA_H = 360

const GLASS = '#dff0f4'
const EDGE = '#33332f'
const DIM = '#9a9a95'
const LABEL = '#4b4b47'

function Dim({ x1, y1, x2, y2, label, vertical }: {
  x1: number; y1: number; x2: number; y2: number; label: string; vertical?: boolean
}) {
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  return (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={DIM} strokeWidth={1} markerStart="url(#arr)" markerEnd="url(#arr)" />
      <text
        x={vertical ? mx + 12 : mx} y={vertical ? my : my + 14}
        fill={LABEL} fontSize={12} textAnchor="middle" fontFamily="ui-monospace, monospace"
        transform={vertical ? `rotate(90 ${mx + 12} ${my})` : undefined}
      >{label}</text>
    </g>
  )
}

export function PartitionDrawing({ config }: { config: Configuration }) {
  const { panels, finish, type, dims } = config
  const hex = finish.hex
  const totalW = Math.max(1, panels.reduce((s, p) => s + p.w, 0))
  const maxH = Math.max(1, ...panels.map(p => p.h))
  const scale = Math.min(AREA_W / totalW, AREA_H / maxH)
  const gw = totalW * scale
  const gh = maxH * scale
  const x0 = PAD.left + (AREA_W - gw) / 2
  const y0 = PAD.top + (AREA_H - gh) / 2
  const vbW = AREA_W + PAD.left + PAD.right
  const vbH = AREA_H + PAD.top + PAD.bottom

  // раскладка панелей слева-направо (без мутации — иммутабельность React 19)
  const laid = panels.map((p, i) => ({
    x: x0 + panels.slice(0, i).reduce((s, q) => s + q.w * scale, 0),
    y: y0, w: p.w * scale, h: p.h * scale, role: p.role, key: p.key, mm: p.w,
  }))

  const doorRect = laid.find(r => r.role === 'door')
  const fixedRect = laid.find(r => r.role === 'fixed' || r.role === 'return')
  const isSliding = type.group === 'sliding'
  const doorHinges = config.hinge ? hingeCount(dims.doorWidth ?? 600, dims.height) : 0
  const returnRect = laid.find(r => r.role === 'return')

  return (
    <svg viewBox={`0 0 ${vbW} ${vbH}`} width="100%" style={{ maxWidth: 640, display: 'block' }} role="img"
      aria-label={`${type.label}, ${dims.width}×${dims.height} мм`}>
      <defs>
        <marker id="arr" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
          <path d="M1,1 L7,4 L1,7" fill="none" stroke={DIM} strokeWidth={1} />
        </marker>
      </defs>

      <rect x="0" y="0" width={vbW} height={vbH} rx="14" fill="#ffffff" />

      {/* штанга/рельса сверху */}
      {(type.group === 'swing' || type.group === 'stationary') && (
        <rect x={x0} y={y0 - 10} width={gw} height={7} rx={3} fill={hex} />
      )}
      {isSliding && (
        <>
          <rect x={x0} y={y0 - 11} width={gw} height={8} rx={2} fill={hex} />
          <rect x={x0} y={y0 + gh + 3} width={gw} height={6} rx={2} fill={hex} />
        </>
      )}

      {/* стекло */}
      {laid.map(r => (
        <g key={r.key}>
          <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={GLASS} stroke={EDGE} strokeWidth={1.4} />
          <line x1={r.x + r.w * 0.16} y1={r.y + r.h} x2={r.x + r.w * 0.44} y2={r.y}
            stroke="#ffffff" strokeWidth={7} opacity={0.5} />
          {r.role === 'door' && (
            <text x={r.x + r.w / 2} y={r.y + r.h / 2} fill="#6b7a80" fontSize={12}
              textAnchor="middle" fontFamily="ui-monospace, monospace">дверь</text>
          )}
        </g>
      ))}

      {/* профиль Pr-002: внешние стены + пол (тёмная подложка + цвет финиша) */}
      {([[x0, y0, x0, y0 + gh], [x0 + gw, y0, x0 + gw, y0 + gh], [x0, y0 + gh, x0 + gw, y0 + gh]] as const).map(([a, b, c, d], i) => (
        <g key={i}>
          <line x1={a} y1={b} x2={c} y2={d} stroke="#6f6f6a" strokeWidth={6.5} />
          <line x1={a} y1={b} x2={c} y2={d} stroke={hex} strokeWidth={4} />
        </g>
      ))}

      {/* угловой раздел (для угловых) */}
      {returnRect && (
        <>
          <line x1={returnRect.x + returnRect.w} y1={y0 - 4} x2={returnRect.x + returnRect.w} y2={y0 + gh + 4}
            stroke={LABEL} strokeWidth={1} strokeDasharray="4 3" />
          <text x={returnRect.x + returnRect.w} y={y0 - 12} fill={LABEL} fontSize={11}
            textAnchor="middle" fontFamily="ui-monospace, monospace">90°</text>
        </>
      )}

      {/* петли: реальная площадка на стыке, 250 мм от верха и низа (правило M-Glass) */}
      {config.hinge && doorRect && fixedRect && doorHinges > 0 && (() => {
        const seamX = doorRect.x <= fixedRect.x ? doorRect.x + doorRect.w : doorRect.x
        const toward = doorRect.x > fixedRect.x ? 1 : -1
        const pl = config.hinge.plate
        const doorPx = pl.doorSide * scale, statPx = pl.statSide * scale
        const hPx = Math.max(11, pl.h * scale)
        const e1 = seamX + toward * doorPx, e2 = seamX - toward * statPx
        const px1 = Math.min(e1, e2), pw = Math.abs(e1 - e2)
        const ys = doorHinges === 2
          ? [250, dims.height - 250]
          : Array.from({ length: doorHinges }, (_, i) => 250 + (i * (dims.height - 500)) / (doorHinges - 1))
        return ys.map((mm, i) => {
          const cy = y0 + (mm / dims.height) * gh
          return (
            <g key={i}>
              <rect x={px1} y={cy - hPx / 2} width={pw} height={hPx} rx={2} fill={hex} stroke="#4a4a46" strokeWidth={0.8} />
              <line x1={px1} y1={cy - hPx / 2 + 1.5} x2={px1 + pw} y2={cy - hPx / 2 + 1.5} stroke="#ffffff" strokeWidth={1} opacity={0.35} />
              <rect x={seamX - toward * statPx * 0.6} y={cy - hPx * 0.3} width={Math.max(4, hPx * 0.42)} height={hPx * 0.6} rx={1} fill="#ffffff" opacity={0.22} />
              <line x1={seamX} y1={cy - hPx / 2} x2={seamX} y2={cy + hPx / 2} stroke="#2c2c29" strokeWidth={0.9} />
            </g>
          )
        })
      })()}

      {/* ручка на открывающейся кромке двери */}
      {doorRect && (() => {
        const seamOnLeft = fixedRect ? fixedRect.x < doorRect.x : true
        const hx = seamOnLeft ? doorRect.x + doorRect.w - 8 : doorRect.x + 8
        return <rect x={hx - 2} y={y0 + gh * 0.42} width={4} height={gh * 0.16} rx={2} fill={hex} />
      })()}

      {/* дуга открывания распашной двери */}
      {(type.group === 'swing' || type.group === 'screen') && doorRect && fixedRect && (() => {
        const hingeLeft = fixedRect.x < doorRect.x
        const px = hingeLeft ? doorRect.x : doorRect.x + doorRect.w
        const r = doorRect.w
        const ex = hingeLeft ? px + r : px - r
        const sweep = hingeLeft ? 0 : 1
        return <path d={`M ${px} ${y0 + gh} A ${r} ${r} 0 0 ${sweep} ${ex} ${y0 + gh - r}`}
          fill="none" stroke={DIM} strokeWidth={1} strokeDasharray="5 4" />
      })()}

      {/* размерные линии */}
      <Dim x1={x0} y1={y0 + gh + 26} x2={x0 + gw} y2={y0 + gh + 26}
        label={`${type.constraints.needsWidth2 ? `${dims.width} + ${dims.width2 ?? 0}` : dims.width} мм`} />
      <Dim x1={x0 + gw + 30} y1={y0} x2={x0 + gw + 30} y2={y0 + gh} label={`${dims.height} мм`} vertical />
      {doorRect && (
        <Dim x1={doorRect.x} y1={y0 - 26} x2={doorRect.x + doorRect.w} y2={y0 - 26} label={`${doorRect.mm} мм`} />
      )}
    </svg>
  )
}
