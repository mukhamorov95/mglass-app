// Приёмка паспорта. Без внешних зависимостей: правила здесь — не «типы ради типов»,
// а перечень ошибок, которые реально приходят из чертежа и из черновика модели.
// Битый паспорт не попадает в реестр — выключается одна деталь, сцена живёт.

import type { PartSpec, Prim, PartIssue, MountOn } from './types'

const MOUNTS: MountOn[] = ['glass-face', 'glass-edge', 'tube', 'tube-end', 'wall', 'free']

// Разумные пределы для душевой фурнитуры, мм. Ловят перепутанные единицы
// (метры вместо мм, дюймы) и опечатки в разряде — самую частую ошибку разбора.
const MIN_MM = 0.5
const MAX_MM = 600

const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v)

function checkPrim(pr: Prim, i: number, out: PartIssue[], id: string) {
  const at = (field: string, problem: string) => out.push({ id, field: `geometry[${i}].${field}`, problem })
  const sizes: number[] = []
  switch (pr.p) {
    case 'box': {
      if (!Array.isArray(pr.size) || pr.size.length !== 3 || !pr.size.every(num)) return at('size', 'нужны три числа')
      sizes.push(...pr.size)
      if (pr.round != null && pr.round > Math.min(...pr.size) / 2) at('round', 'скругление больше половины габарита')
      break
    }
    case 'cyl': {
      if (!num(pr.d) || !num(pr.len)) return at('d/len', 'диаметр и длина обязательны')
      sizes.push(pr.d, pr.len, ...(num(pr.d2) ? [pr.d2 as number] : []))
      break
    }
    case 'ball': {
      if (!num(pr.d)) return at('d', 'нужен диаметр')
      sizes.push(pr.d)
      break
    }
    case 'clamp': {
      if (!Array.isArray(pr.section) || pr.section.length !== 2 || !pr.section.every(num)) return at('section', 'нужны два числа сечения')
      if (!num(pr.wall) || pr.wall <= 0) return at('wall', 'стенка обоймы должна быть больше нуля')
      if (!num(pr.len)) return at('len', 'нужна длина обоймы')
      sizes.push(...pr.section, pr.len)
      break
    }
    case 'ring': {
      if (!num(pr.d) || !num(pr.thk)) return at('d/thk', 'нужны диаметр и толщина')
      if (pr.thk >= pr.d) at('thk', 'толщина прутка не меньше диаметра кольца')
      sizes.push(pr.d, pr.thk)
      break
    }
    default:
      return at('p', `неизвестный примитив «${(pr as { p: string }).p}»`)
  }
  for (const s of sizes) {
    if (s < MIN_MM) at('size', `${s} мм — меньше ${MIN_MM}; похоже на метры вместо миллиметров`)
    else if (s > MAX_MM) at('size', `${s} мм — больше ${MAX_MM}; для душевой фурнитуры это не размер детали`)
  }
}

export function validatePart(spec: PartSpec): PartIssue[] {
  const out: PartIssue[] = []
  const id = spec?.id ?? '(без id)'
  const bad = (field: string, problem: string) => out.push({ id, field, problem })

  if (!spec.id || !/^[a-z0-9-]+$/.test(spec.id)) bad('id', 'ключ формы: строчные латиница, цифры и дефис')
  if (!spec.article) bad('article', 'артикул обязателен — по нему деталь сходится с прайсом')
  if (!spec.label) bad('label', 'нужно человеческое название')
  if (!spec.role) bad('role', 'нужна роль комплекта')

  if (!Array.isArray(spec.geometry) || spec.geometry.length === 0) {
    if (!spec.gltf) bad('geometry', 'пустая геометрия и нет gltf — рисовать нечего')
  } else {
    spec.geometry.forEach((pr, i) => checkPrim(pr, i, out, id))
  }

  const m = spec.mount
  if (!m || !MOUNTS.includes(m.on)) bad('mount.on', `посадка должна быть одной из: ${MOUNTS.join(', ')}`)
  else {
    // Сквозная посадка бывает только через отверстие в полотне.
    if (m.through && m.on !== 'glass-face') bad('mount.through', 'сквозной может быть только деталь на плоскости стекла')
    // Обхват объявляют только те, кто садится на трубу — иначе поле забыто от копии.
    if (m.clamps && m.on !== 'tube' && m.on !== 'tube-end') bad('mount.clamps', 'обхват сечения — только для посадки на штангу')
    if ((m.on === 'tube' || m.on === 'tube-end') && !m.clamps) bad('mount.clamps', 'деталь на штанге обязана объявить сечение, которое обхватывает')
    if (m.standoff != null && (m.standoff < 0 || m.standoff > MAX_MM)) bad('mount.standoff', 'отступ вне разумного диапазона')
  }

  // Обойма обязана быть шире того, что обхватывает: иначе труба протыкает деталь.
  if (m?.clamps) {
    const clamp = spec.geometry.find(g => g.p === 'clamp') as Extract<Prim, { p: 'clamp' }> | undefined
    if (clamp) {
      const [cw, ch] = clamp.section, [tw, th] = m.clamps
      if (cw < tw || ch < th) bad('geometry.clamp', `обойма ${cw}×${ch} меньше штанги ${tw}×${th} — труба пройдёт насквозь`)
    }
  }

  // Числа с чертежа должны быть числами: null из разбора чертежа значит «не видно».
  for (const [k, v] of Object.entries(spec.dims ?? {})) {
    if (!num(v)) bad(`dims.${k}`, 'не число — размер не считан с чертежа, деталь нельзя выпускать')
  }
  return out
}
