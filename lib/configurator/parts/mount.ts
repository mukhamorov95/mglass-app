// Посадка: сцена описывает ПОВЕРХНОСТЬ, деталь — как она к ней крепится.
// Координаты детали никто больше не считает руками — этим занимается placePart.
//
// Рамка детали, единая для всех паспортов (запомнить один раз):
//   +Z — наружу от поверхности (нормаль),  +Y — вверх,  +X — вдоль поверхности.
// Ноль детали лежит НА поверхности, геометрия растёт в +Z. Тогда «вынос 60 мм»
// с чертежа — это буквально z от 0 до 60, и знаки не подбираются на каждом месте
// установки. Обратную половину сквозной детали разворачивает сам placePart.

import type { PartSpec, V3 } from './types'

const MM = 0.001

export type Surface = {
  kind: PartSpec['mount']['on']
  point: V3                      // метры, мировые координаты точки на поверхности
  out: [number, number]          // XZ, единичный — наружу от поверхности
  along?: [number, number]       // XZ, единичный — вдоль поверхности; по умолчанию ⊥ out
  thickness?: number             // мм — толщина стекла, нужна сквозным деталям
  section?: [number, number]     // мм — сечение штанги, для посадки на трубу
}

export type Placement = {
  pos: V3
  rotY: number
  mirror?: { pos: V3; rotY: number }   // вторая половина сквозной детали
}

export type PlaceResult = { ok: true; placement: Placement } | { ok: false; reason: string }

const unit = (v: [number, number]): [number, number] => {
  const L = Math.hypot(v[0], v[1])
  return L > 1e-9 ? [v[0] / L, v[1] / L] : [0, 1]
}

// Поворот вокруг Y, при котором локальная +Z смотрит в out.
const rotYFor = (out: [number, number]) => Math.atan2(out[0], out[1])

export function placePart(spec: PartSpec, s: Surface): PlaceResult {
  const m = spec.mount
  if (m.on !== s.kind) return { ok: false, reason: `деталь «${spec.id}» садится на ${m.on}, а поверхность — ${s.kind}` }

  if (m.clamps && s.section) {
    const [cw, ch] = m.clamps, [sw, sh] = s.section
    if (cw !== sw || ch !== sh) return { ok: false, reason: `«${spec.id}» рассчитана на штангу ${cw}×${ch}, в сцене ${sw}×${sh}` }
  }
  if (m.through && !s.thickness) return { ok: false, reason: `сквозная деталь «${spec.id}» требует толщину полотна` }
  if (m.glassMm && s.thickness && (s.thickness < m.glassMm[0] || s.thickness > m.glassMm[1])) {
    return { ok: false, reason: `«${spec.id}» под стекло ${m.glassMm[0]}–${m.glassMm[1]} мм, в сцене ${s.thickness}` }
  }

  const out = unit(s.out)
  const along = unit(s.along ?? [out[1], -out[0]])
  const n = m.standoff ?? 0, a = m.along ?? 0, up = m.lift ?? 0

  const pos: V3 = [
    s.point[0] + (out[0] * n + along[0] * a) * MM,
    s.point[1] + up * MM,
    s.point[2] + (out[1] * n + along[1] * a) * MM,
  ]
  const rotY = rotYFor(out)

  // Сквозная (двусторонняя П-скоба): вторая половина с изнанки полотна, развёрнута.
  if (m.through) {
    const t = s.thickness as number
    const back: V3 = [pos[0] - out[0] * t * MM, pos[1], pos[2] - out[1] * t * MM]
    return { ok: true, placement: { pos, rotY, mirror: { pos: back, rotY: rotY + Math.PI } } }
  }
  return { ok: true, placement: { pos, rotY } }
}

// Поверхности, которые умеет описывать сцена. Держим конструкторы рядом с посадкой,
// чтобы место установки не изобретало нормали заново — там и жили ошибки со знаками.
export const surfaces = {
  // Плоскость полотна: точка на грани, нормаль наружу.
  glassFace(center: V3, out: [number, number], along: [number, number], thicknessMm: number,
            alongM = 0, y?: number): Surface {
    const o = unit(out), al = unit(along)
    const half = (thicknessMm / 2) * MM
    return {
      kind: 'glass-face',
      point: [center[0] + o[0] * half + al[0] * alongM, y ?? center[1], center[2] + o[1] * half + al[1] * alongM],
      out: o, along: al, thickness: thicknessMm,
    }
  },
  // Торец полотна: нормаль — прочь от полотна в его плоскости, «вдоль» — по толщине.
  glassEdge(point: V3, out: [number, number], thicknessMm: number): Surface {
    const o = unit(out)
    return { kind: 'glass-edge', point, out: o, along: [o[1], -o[0]], thickness: thicknessMm }
  },
  // Штанга: точка на оси, «вдоль» — ось трубы, нормаль — куда смотрит деталь.
  tube(point: V3, axis: [number, number], out: [number, number], section: [number, number]): Surface {
    return { kind: 'tube', point, out: unit(out), along: unit(axis), section }
  },
  tubeEnd(point: V3, axis: [number, number], section: [number, number]): Surface {
    const a = unit(axis)
    return { kind: 'tube-end', point, out: a, along: [a[1], -a[0]], section }
  },
  wall(point: V3, out: [number, number]): Surface {
    return { kind: 'wall', point, out: unit(out) }
  },
}
