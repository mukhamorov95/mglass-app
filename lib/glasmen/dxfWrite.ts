import type { PartGeometry, Seg } from './types'
import { TAU, parsePathD, segStart, simSegs } from './geom'

// Выгрузка детали в DXF R12 (мм, y вверх): контур, отверстия, вырезы — на своих слоях.
// R12 без таблиц открывают и AutoCAD, и LibreCAD, и программы станков.

export type ToDxfOptions = {
  loose?: boolean    // отдельные LINE/ARC вместо полилиний (как экспорт из SolidWorks)
  label?: string     // подпись под деталью (TEXT на слое NOTES; при разборе игнорируется)
}

const f = (n: number) => {
  const r = Math.round(n * 1e6) / 1e6
  return Object.is(r, -0) ? '0' : String(r)
}
const deg = (rad: number) => {
  const d = ((rad * 180) / Math.PI) % 360
  return d < 0 ? d + 360 : d
}

// R12 хранит текст в однобайтовой кодировке; кириллицу пишем экранами \U+XXXX — их понимают AutoCAD и LibreCAD.
const dxfText = (t: string) => t.replace(/[^\x20-\x7e]/g, ch => `\\U+${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`)

function polyline(segs: Seg[], layer: string): string[] {
  const out = ['0', 'POLYLINE', '8', layer, '66', '1', '10', '0', '20', '0', '30', '0', '70', '1']
  for (const s of segs) {
    const halves: Seg[] = s.kind === 'arc' && Math.abs(s.sweep) > Math.PI
      ? [{ ...s, sweep: s.sweep / 2 }, { ...s, a0: s.a0 + s.sweep / 2, sweep: s.sweep / 2 }]
      : [s]
    for (const h of halves) {
      const p = segStart(h)
      out.push('0', 'VERTEX', '8', layer, '10', f(p.x), '20', f(p.y), '30', '0')
      if (h.kind === 'arc') out.push('42', f(Math.tan(h.sweep / 4)))
    }
  }
  out.push('0', 'SEQEND', '8', layer)
  return out
}

function loose(segs: Seg[], layer: string): string[] {
  const out: string[] = []
  for (const s of segs) {
    if (s.kind === 'line') {
      out.push('0', 'LINE', '8', layer, '10', f(s.a.x), '20', f(s.a.y), '30', '0', '11', f(s.b.x), '21', f(s.b.y), '31', '0')
    } else if (Math.abs(s.sweep) >= TAU - 1e-9) {
      out.push('0', 'CIRCLE', '8', layer, '10', f(s.c.x), '20', f(s.c.y), '30', '0', '40', f(s.r))
    } else {
      const [a, b] = s.sweep > 0 ? [s.a0, s.a0 + s.sweep] : [s.a0 + s.sweep, s.a0]
      out.push('0', 'ARC', '8', layer, '10', f(s.c.x), '20', f(s.c.y), '30', '0', '40', f(s.r), '50', f(deg(a)), '51', f(deg(b)))
    }
  }
  return out
}

export function toDxf(geom: PartGeometry, opts: ToDxfOptions = {}): string {
  const toDxfFrame = { flipY: true, ty: geom.height }
  const outer = simSegs(toDxfFrame, geom.outerSegs ?? parsePathD(geom.outerPathD))
  const cutouts = geom.cutouts.map(c => simSegs(toDxfFrame, c.segs ?? parsePathD(c.pathD)))
  const emit = opts.loose ? loose : polyline
  const body: string[] = [
    '0', 'SECTION', '2', 'HEADER',
    '9', '$ACADVER', '1', 'AC1009',
    '9', '$INSUNITS', '70', '4',
    '9', '$EXTMIN', '10', '0', '20', '0', '30', '0',
    '9', '$EXTMAX', '10', f(geom.width), '20', f(geom.height), '30', '0',
    '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES',
    ...emit(outer, 'CONTOUR'),
    ...geom.holes.flatMap(h => ['0', 'CIRCLE', '8', 'HOLES', '10', f(h.cx), '20', f(geom.height - h.cy), '30', '0', '40', f(h.d / 2)]),
    ...cutouts.flatMap(c => emit(c, 'CUTOUTS')),
    ...(opts.label ? ['0', 'TEXT', '8', 'NOTES', '10', '0', '20', f(-40), '30', '0', '40', '20', '1', dxfText(opts.label)] : []),
    '0', 'ENDSEC',
    '0', 'EOF',
  ]
  return body.join('\n') + '\n'
}
