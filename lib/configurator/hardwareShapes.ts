// Форма фурнитуры для 3D — чистый модуль (без three и 'use client'), чтобы им
// пользовались и клиентский рендер (Partition3D/hardware.tsx), и сервер (options API).
// shape управляет тем, КАКОЙ меш рисуется; выбор клиента меняет shape → 3D меняется.

export type HardwareShape =
  | 'hinge-glass' | 'hinge-wall'                    // петли: стекло-стекло / стекло-стена
  | 'handle-bar' | 'handle-knob' | 'handle-inset'   // ручки: скоба / кноб / купе (врезная)
  | 'roller' | 'mount-glass' | 'mount-wall' | 'mount-corner' | 'connector' | 'cap'

// Код модели геометрии → форма по умолчанию (обратная совместимость со старым рендером).
export function shapeForModel(model: string): HardwareShape {
  switch (model) {
    case 'sd210': return 'handle-bar'
    case 'kupe': return 'handle-inset'
    case 'roller': return 'roller'
    case 'kp006': return 'mount-glass'
    case 'kp002': return 'mount-wall'
    case 'kp001': return 'mount-corner'
    case 'connector': return 'connector'
    case 'cap': return 'cap'
    case 'dessau': case 'balge': default: return 'hinge-glass'
  }
}

// Название/артикул позиции справочника → форма (для авто-тега; логист может переопределить).
export function inferShape(text: string): HardwareShape {
  const t = (text || '').toLowerCase()
  if (/кноб|knob|шар(?!нир)|ball/.test(t)) return 'handle-knob'
  if (/купе|kupe|утоплен|врезн|чаш/.test(t)) return 'handle-inset'
  if (/скоб|поручень|h-обр|bar handle|ручка.*штанг/.test(t)) return 'handle-bar'
  if (/ролик|каретк|roller/.test(t)) return 'roller'
  if (/соедин|коннектор|connector/.test(t)) return 'connector'
  if (/заглушк|колпач|cap/.test(t)) return 'cap'
  if (/(петл|hinge).*(стен|wall)|стекло-?стен/.test(t)) return 'hinge-wall'
  if (/петл|hinge|навес/.test(t)) return 'hinge-glass'
  if (/ручк|handle/.test(t)) return 'handle-bar'   // ручка без уточнения — скоба
  return 'hinge-glass'
}

// Роли, у которых у клиента может быть выбор внешнего вида (петля/ручка).
export const SELECTABLE_ROLES = ['hinge', 'handle'] as const
