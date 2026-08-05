import type { Configuration } from '@/lib/configurator/catalog'

// Изометрия «под каталог»: полупрозрачное стекло поверх текстурной ниши,
// металлик-фурнитура (градиенты), тени и мягкое затенение в углу.
// Угловые складываются под 90°. SVG строится в чистой функции (без мутаций рендера).
const IA = { x: 0.90, y: -0.32 }
const IB = { x: -0.90, y: -0.32 }
const EDGE = '#2c2c29', DIM = '#8f8f8a', LABEL = '#4b4b47'

const clamp = (x: number) => Math.max(0, Math.min(255, Math.round(x)))
const hx = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
const HEX = (a: number[]) => '#' + a.map(v => clamp(v).toString(16).padStart(2, '0')).join('')
const lighten = (h: string, f: number) => HEX(hx(h).map(v => v + (255 - v) * f))
const darken = (h: string, f: number) => HEX(hx(h).map(v => v * (1 - f)))

export function isoSvg(config: Configuration): string {
  const g = (id: string) => `pi-${id}`
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
  const Dctx = corner ? (Lb || 1) : 360

  const Wp = (u: number, v: number, h: number) => ({ x: u * IA.x + v * IB.x, y: (u * IA.y + v * IB.y) - h })
  const pts = [Wp(0, 0, 0), Wp(La, 0, 0), Wp(La, Dctx, 0), Wp(0, Dctx, 0), Wp(La, 0, H), Wp(La, Dctx, H), Wp(0, Dctx, H), Wp(0, 0, H)]
  if (corner) pts.push(Wp(0, Lb, 0), Wp(0, Lb, H))
  const minx = Math.min(...pts.map(p => p.x)), maxx = Math.max(...pts.map(p => p.x))
  const miny = Math.min(...pts.map(p => p.y)), maxy = Math.max(...pts.map(p => p.y))
  const AREA = 560, PADX = 95, PADY = 64
  const sc = Math.min((AREA - 2 * PADX) / ((maxx - minx) || 1), (430 - 2 * PADY) / ((maxy - miny) || 1))
  const ox = PADX - minx * sc + ((AREA - 2 * PADX) - (maxx - minx) * sc) / 2
  const oy = PADY - miny * sc
  const XY = (u: number, v: number, h: number) => { const p = Wp(u, v, h); return { x: ox + p.x * sc, y: oy + p.y * sc } }
  const S = (u: number, v: number, h: number) => { const p = XY(u, v, h); return `${p.x.toFixed(1)},${p.y.toFixed(1)}` }
  const quad = (a: number[], b: number[], c: number[], d: number[]) =>
    `${S(a[0], a[1], a[2])} ${S(b[0], b[1], b[2])} ${S(c[0], c[1], c[2])} ${S(d[0], d[1], d[2])}`

  const mDark = darken(hex, 0.55), mMid = hex, mHi = lighten(hex, 0.55)
  const defs = `
   <linearGradient id="${g('metal')}" x1="0" y1="0" x2="1" y2="1">
     <stop offset="0" stop-color="${mDark}"/><stop offset="0.35" stop-color="${mHi}"/>
     <stop offset="0.55" stop-color="${mMid}"/><stop offset="1" stop-color="${mDark}"/></linearGradient>
   <linearGradient id="${g('glass')}" x1="0" y1="0" x2="0" y2="1">
     <stop offset="0" stop-color="#20262a" stop-opacity="0.30"/>
     <stop offset="0.5" stop-color="#333b3f" stop-opacity="0.44"/>
     <stop offset="1" stop-color="#232a2d" stop-opacity="0.52"/></linearGradient>
   <linearGradient id="${g('stone')}" x1="0" y1="0" x2="0" y2="1">
     <stop offset="0" stop-color="#efece7"/><stop offset="1" stop-color="#dcd8d2"/></linearGradient>
   <linearGradient id="${g('floor')}" x1="0" y1="0" x2="0" y2="1">
     <stop offset="0" stop-color="#e4e0da"/><stop offset="1" stop-color="#cfcbc4"/></linearGradient>
   <radialGradient id="${g('ao')}" cx="0.5" cy="0.1" r="0.9">
     <stop offset="0" stop-color="#000" stop-opacity="0.16"/><stop offset="0.6" stop-color="#000" stop-opacity="0"/></radialGradient>
   <filter id="${g('soft')}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="5"/></filter>
   <filter id="${g('grain')}"><feTurbulence type="fractalNoise" baseFrequency="0.012 0.02" numOctaves="2" seed="7" result="n"/>
     <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0.05 0"/></filter>`

  const parts: string[] = [`<defs>${defs}</defs>`, `<rect x="0" y="0" width="${AREA}" height="470" rx="14" fill="#f6f5f3"/>`]
  // контактная тень
  parts.push(`<polygon points="${quad([-60, -40, 0], [La + 60, -40, 0], [La + 60, Dctx + 40, 0], [-60, Dctx + 40, 0])}" fill="#000" opacity="0.14" filter="url(#${g('soft')})"/>`)
  // ниша
  const wallR = `<polygon points="${quad([La, 0, 0], [La, Dctx, 0], [La, Dctx, H], [La, 0, H])}" fill="url(#${g('stone')})"/>`
  const wallB = `<polygon points="${quad([0, Dctx, 0], [La, Dctx, 0], [La, Dctx, H], [0, Dctx, H])}" fill="url(#${g('stone')})"/>`
  const floor = `<polygon points="${quad([0, 0, 0], [La, 0, 0], [La, Dctx, 0], [0, Dctx, 0])}" fill="url(#${g('floor')})"/>`
  parts.push(wallB, `<polygon points="${quad([La, 0, 0], [La, Dctx, 0], [La, Dctx, H], [La, 0, H])}" fill="#000" opacity="0.05"/>`, wallR, floor)
  parts.push(`<clipPath id="${g('nc')}">${wallB}${wallR}${floor}</clipPath>`)
  parts.push(`<g clip-path="url(#${g('nc')})"><rect x="0" y="0" width="${AREA}" height="470" filter="url(#${g('grain')})"/>`)
  const veins = [[70, 60, 180, 200, 120, 320], [300, 40, 360, 260, 300, 420], [180, 120, 120, 300, 200, 430], [420, 80, 470, 300, 430, 440], [240, 20, 200, 180, 340, 360], [400, 140, 340, 320, 460, 460]]
  for (const [x1, y1, cx, cy, x2, y2] of veins) parts.push(`<path d="M${x1} ${y1} Q${cx} ${cy} ${x2} ${y2}" fill="none" stroke="#89847e" stroke-width="1.5" opacity="0.30"/>`)
  parts.push(`</g>`)
  parts.push(`<polygon points="${quad([0, 0, 0], [La, 0, H], [La, Dctx, H], [0, Dctx, H])}" fill="url(#${g('ao')})"/>`)

  const prof = (a: number[], b: number[], w = 5) => {
    const A = XY(a[0], a[1], a[2]), B = XY(b[0], b[1], b[2])
    parts.push(`<line x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}" stroke="${mDark}" stroke-width="${w + 1.5}"/><line x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}" stroke="url(#${g('metal')})" stroke-width="${w}"/><line x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}" stroke="${mHi}" stroke-width="1" opacity="0.8"/>`)
  }
  const glass = (u0: number, v0: number, u1: number, v1: number) => {
    parts.push(`<polygon points="${quad([u0, v0, 0], [u1, v1, 0], [u1, v1, H], [u0, v0, H])}" fill="url(#${g('glass')})" stroke="${EDGE}" stroke-width="1.3"/>`)
    parts.push(`<polygon points="${S(u0, v0, H)} ${S(u1, v1, H)} ${S(u1, v1, H * 0.58)} ${S(u0, v0, H * 0.58)}" fill="#fff" opacity="0.13"/>`)
    const pt = (t: number, h: number) => S(u0 + (u1 - u0) * t, v0 + (v1 - v0) * t, h)
    parts.push(`<polygon points="${pt(0.05, 0)} ${pt(0.28, 0)} ${pt(0.46, H)} ${pt(0.23, H)}" fill="#fff" opacity="0.11"/>`)
    const a = XY(u0 + (u1 - u0) * 0.15, v0 + (v1 - v0) * 0.15, 0), b = XY(u0 + (u1 - u0) * 0.22, v0 + (v1 - v0) * 0.22, H)
    parts.push(`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#fff" stroke-width="2.5" opacity="0.42"/>`)
  }

  if (corner) { glass(0, 0, 0, Lb); prof([0, Lb, 0], [0, Lb, H]); prof([0, 0, H], [0, Lb, H]) }
  const fixedLen = doorLen ? Math.max(0, La - doorLen) : La
  glass(0, 0, La, 0)
  prof([La, 0, 0], [La, 0, H]); prof([La, 0, H], [0, 0, H]); prof([0, 0, 0], [La, 0, 0])
  if (corner) prof([0, 0, 0], [0, Lb, 0])
  prof([0, 0, H + 28], [La, 0, H + 28], 7)
  if (corner) prof([0, 0, H + 28], [0, Lb, H + 28], 7)

  if (doorLen) {
    const dv = XY(fixedLen, 0, 0), dvt = XY(fixedLen, 0, H)
    parts.push(`<line x1="${dv.x}" y1="${dv.y}" x2="${dvt.x}" y2="${dvt.y}" stroke="${EDGE}" stroke-width="1.1"/>`)
    const h0 = XY(La - 45, 0, H * 0.40), h1 = XY(La - 45, 0, H * 0.60)
    parts.push(`<line x1="${h0.x}" y1="${h0.y}" x2="${h1.x}" y2="${h1.y}" stroke="${mDark}" stroke-width="7"/><line x1="${h0.x}" y1="${h0.y}" x2="${h1.x}" y2="${h1.y}" stroke="url(#${g('metal')})" stroke-width="4.5"/>`)
    if (plate && !sliding) {
      for (const hh of [250, H - 250]) {
        const wA = XY(fixedLen + plate.doorSide, 0, hh), wS = XY(fixedLen - plate.statSide, 0, hh)
        parts.push(`<line x1="${wS.x}" y1="${wS.y - 5}" x2="${wA.x}" y2="${wA.y - 5}" stroke="${mDark}" stroke-width="13" stroke-linecap="round"/><line x1="${wS.x}" y1="${wS.y - 5}" x2="${wA.x}" y2="${wA.y - 5}" stroke="url(#${g('metal')})" stroke-width="10" stroke-linecap="round"/><line x1="${wS.x}" y1="${wS.y - 8}" x2="${wA.x}" y2="${wA.y - 8}" stroke="${mHi}" stroke-width="2" stroke-linecap="round" opacity="0.7"/>`)
      }
    }
  }
  if (sliding) {
    const a = XY(La * 0.5, 0, 0), b = XY(La * 0.5, 0, H)
    parts.push(`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${EDGE}" stroke-width="1.1" stroke-dasharray="6 4"/>`)
  }

  const dl = (a: number[], b: number[], label: string, off = 22) => {
    const A = XY(a[0], a[1], a[2]), B = XY(b[0], b[1], b[2])
    parts.push(`<line x1="${A.x}" y1="${A.y + off}" x2="${B.x}" y2="${B.y + off}" stroke="${DIM}" stroke-width="1"/><text x="${(A.x + B.x) / 2}" y="${(A.y + B.y) / 2 + off + 14}" fill="${LABEL}" font-size="12" text-anchor="middle" font-family="ui-monospace,monospace">${label}</text>`)
  }
  dl([0, 0, 0], [La, 0, 0], `${dims.width} мм`)
  if (corner) dl([0, Lb, 0], [0, 0, 0], `${dims.width2 ?? 0} мм`)
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
