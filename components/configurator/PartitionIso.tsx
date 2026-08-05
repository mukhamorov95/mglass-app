import type { Configuration } from '@/lib/configurator/catalog'

// Изометрия: два стекла складываются под 90° (как в каталоге). Ракурс фиксирован.
// SVG строится в чистой функции (не в теле компонента) — без мутаций рендера.
const IA = { x: 0.90, y: -0.32 }
const IB = { x: -0.90, y: -0.32 }
const EDGE = '#33332f', DIM = '#8f8f8a', LABEL = '#4b4b47'
const GLASS = '#d9edf2', GLASSOP = 0.72
const FLOOR = '#ecece8', WALLR = '#e0e0db', WALLL = '#e6e6e1'

export function isoSvg(config: Configuration): string {
  const corner = config.type.corner
  const hex = config.finish.hex
  const dims = config.dims
  const sliding = config.type.group === 'sliding'
  const doorLen = config.type.constraints.doorWidth
    ? (dims.doorWidth ?? 600)
    : sliding ? Math.round(dims.width * 0.5) : 0
  const plate = config.hinge?.plate ?? null

  const La = dims.width
  const Lb = corner ? (dims.width2 ?? 0) : 0
  const H = dims.height
  const Dctx = corner ? (Lb || 1) : 350

  const Wp = (u: number, v: number, h: number) => ({ x: u * IA.x + v * IB.x, y: (u * IA.y + v * IB.y) - h })
  const pts = [Wp(0, 0, 0), Wp(La, 0, 0), Wp(La, Dctx, 0), Wp(0, Dctx, 0), Wp(La, 0, H), Wp(La, Dctx, H), Wp(0, Dctx, H), Wp(0, 0, H)]
  if (corner) pts.push(Wp(0, Lb, 0), Wp(0, Lb, H))
  const minx = Math.min(...pts.map(p => p.x)), maxx = Math.max(...pts.map(p => p.x))
  const miny = Math.min(...pts.map(p => p.y)), maxy = Math.max(...pts.map(p => p.y))
  const AREA = 560, PADX = 90, PADY = 70
  const sc = Math.min((AREA - 2 * PADX) / ((maxx - minx) || 1), (420 - 2 * PADY) / ((maxy - miny) || 1))
  const ox = PADX - minx * sc + ((AREA - 2 * PADX) - (maxx - minx) * sc) / 2
  const oy = PADY - miny * sc
  const XY = (u: number, v: number, h: number) => { const p = Wp(u, v, h); return { x: ox + p.x * sc, y: oy + p.y * sc } }
  const S2 = (u: number, v: number, h: number) => { const p = XY(u, v, h); return `${p.x.toFixed(1)},${p.y.toFixed(1)}` }
  const quad = (a: number[], b: number[], c: number[], d: number[]) =>
    `${S2(a[0], a[1], a[2])} ${S2(b[0], b[1], b[2])} ${S2(c[0], c[1], c[2])} ${S2(d[0], d[1], d[2])}`

  const parts: string[] = [`<rect x="0" y="0" width="${AREA}" height="470" rx="14" fill="#fff"/>`]
  // ниша: пол + две стены
  parts.push(`<polygon points="${quad([0, 0, 0], [La, 0, 0], [La, Dctx, 0], [0, Dctx, 0])}" fill="${FLOOR}"/>`)
  parts.push(`<polygon points="${quad([La, 0, 0], [La, Dctx, 0], [La, Dctx, H], [La, 0, H])}" fill="${WALLR}"/>`)
  parts.push(`<polygon points="${quad([0, Dctx, 0], [La, Dctx, 0], [La, Dctx, H], [0, Dctx, H])}" fill="${WALLL}"/>`)

  const profile = (a: number[], b: number[]) => {
    const A = XY(a[0], a[1], a[2]), B = XY(b[0], b[1], b[2])
    parts.push(`<line x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}" stroke="#6f6f6a" stroke-width="6"/><line x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}" stroke="${hex}" stroke-width="3.5"/>`)
  }
  const glassPane = (u0: number, v0: number, u1: number, v1: number) => {
    parts.push(`<polygon points="${quad([u0, v0, 0], [u1, v1, 0], [u1, v1, H], [u0, v0, H])}" fill="${GLASS}" fill-opacity="${GLASSOP}" stroke="${EDGE}" stroke-width="1.4"/>`)
    const g0 = XY(u0 + (u1 - u0) * 0.2, v0 + (v1 - v0) * 0.2, 0), g1 = XY(u0 + (u1 - u0) * 0.4, v0 + (v1 - v0) * 0.4, H)
    parts.push(`<line x1="${g0.x}" y1="${g0.y}" x2="${g1.x}" y2="${g1.y}" stroke="#fff" stroke-width="6" opacity="0.5"/>`)
  }

  if (corner) {
    glassPane(0, 0, 0, Lb)
    profile([0, Lb, 0], [0, Lb, H]); profile([0, 0, H], [0, Lb, H]); profile([0, 0, H + 30], [0, Lb, H + 30])
  }
  const fixedLen = doorLen ? Math.max(0, La - doorLen) : La
  glassPane(0, 0, La, 0)
  profile([La, 0, 0], [La, 0, H]); profile([La, 0, H], [0, 0, H]); profile([0, 0, H + 30], [La, 0, H + 30])
  profile([0, 0, 0], [La, 0, 0])
  if (corner) profile([0, 0, 0], [0, Lb, 0])

  if (doorLen) {
    const dv = XY(fixedLen, 0, 0), dvt = XY(fixedLen, 0, H)
    parts.push(`<line x1="${dv.x}" y1="${dv.y}" x2="${dvt.x}" y2="${dvt.y}" stroke="${EDGE}" stroke-width="1.2"/>`)
    const hy0 = XY(La - 40, 0, H * 0.42), hy1 = XY(La - 40, 0, H * 0.58)
    parts.push(`<line x1="${hy0.x}" y1="${hy0.y}" x2="${hy1.x}" y2="${hy1.y}" stroke="${hex}" stroke-width="4"/>`)
    if (plate && !sliding) {
      for (const hh of [250, H - 250]) {
        const wA = XY(fixedLen + plate.doorSide, 0, hh), wS = XY(fixedLen - plate.statSide, 0, hh)
        parts.push(`<line x1="${wS.x}" y1="${wS.y - 6}" x2="${wA.x}" y2="${wA.y - 6}" stroke="#4a4a46" stroke-width="11" stroke-linecap="round" opacity="0.25"/><line x1="${wS.x}" y1="${wS.y - 6}" x2="${wA.x}" y2="${wA.y - 6}" stroke="${hex}" stroke-width="10" stroke-linecap="round"/>`)
      }
    }
  }
  if (sliding) {
    const a = XY(La * 0.5, 0, 0), b = XY(La * 0.5, 0, H)
    parts.push(`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${EDGE}" stroke-width="1.2" stroke-dasharray="6 4"/>`)
  }

  const dimLine = (a: number[], b: number[], label: string, off = 22) => {
    const A = XY(a[0], a[1], a[2]), B = XY(b[0], b[1], b[2])
    parts.push(`<line x1="${A.x}" y1="${A.y + off}" x2="${B.x}" y2="${B.y + off}" stroke="${DIM}" stroke-width="1"/><text x="${(A.x + B.x) / 2}" y="${(A.y + B.y) / 2 + off + 14}" fill="${LABEL}" font-size="12" text-anchor="middle" font-family="ui-monospace,monospace">${label}</text>`)
  }
  dimLine([0, 0, 0], [La, 0, 0], `${dims.width} мм`)
  if (corner) dimLine([0, Lb, 0], [0, 0, 0], `${dims.width2 ?? 0} мм`)
  const ha = XY(0, 0, 0), hb = XY(0, 0, H)
  parts.push(`<line x1="${ha.x - 24}" y1="${ha.y}" x2="${hb.x - 24}" y2="${hb.y}" stroke="${DIM}" stroke-width="1"/><text x="${ha.x - 30}" y="${(ha.y + hb.y) / 2}" fill="${LABEL}" font-size="12" text-anchor="middle" font-family="ui-monospace,monospace" transform="rotate(-90 ${ha.x - 30} ${(ha.y + hb.y) / 2})">${dims.height} мм</text>`)

  return `<svg viewBox="0 0 ${AREA} 470" width="100%" style="max-width:640px;display:block" role="img" aria-label="${config.type.label}, ${dims.width}×${dims.height} мм">${parts.join('')}</svg>`
}

export function PartitionIso({ config }: { config: Configuration }) {
  return (
    <div
      className="w-full"
      dangerouslySetInnerHTML={{ __html: isoSvg(config) }}
    />
  )
}
