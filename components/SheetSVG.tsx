import type { CuttingSheet } from '@/lib/cuttingOptimizer'

// Визуальная карта раскроя листа (read-only). Раньше жила локально в
// app/b2b-cutting/page.tsx; вынесена в общий компонент, чтобы её же показывать
// станочнику у резки (app/production-app/station), а не только в десктоп-админке.

export const PIECE_COLORS = [
  '#4B9FFF', '#FF6B6B', '#51CF66', '#FAB005', '#CC5DE8',
  '#20C997', '#FF8C42', '#845EF7', '#F06595', '#74C0FC',
  '#A9E34B', '#FFA94D', '#63E6BE', '#E599F7', '#FFD43B',
]

export function pieceColor(idx: number, alpha = 1): string {
  const hex = PIECE_COLORS[idx % PIECE_COLORS.length]
  if (alpha >= 1) return hex
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

export function SheetSVG({ sheet, sheetW, sheetH, edgeMargin }: {
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
