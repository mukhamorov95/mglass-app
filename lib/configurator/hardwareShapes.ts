// Форма фурнитуры для 3D — чистый модуль (без three и 'use client'), чтобы им
// пользовались и клиентский рендер (Partition3D/hardware.tsx), и сервер (options API).
// shape управляет тем, КАКОЙ меш рисуется; выбор клиента меняет shape → 3D меняется.

export type HardwareShape =
  | 'hinge-glass' | 'hinge-wall'                    // петли: стекло-стекло / стекло-стена
  | 'handle-bar' | 'handle-knob' | 'handle-inset'   // ручки: скоба / кноб / купе (врезная)
  | 'roller' | 'mount-glass' | 'mount-wall' | 'mount-corner' | 'connector' | 'cap'
  | 'mount-diag45' | 'mount-stabilizer'             // крепления штанги M1: 45°-коннектор / стабилизатор
  | 'mount-rail-end'                                // торец штанги у перпендикулярного стекла

// ЕДИНЫЙ список форм: и рендер, и выбор в админке берут его отсюда. Раньше админка
// держала свою копию, и новые формы в выпадающий список просто не попадали.
export const SHAPE_LIST: { id: HardwareShape; label: string; hint: string }[] = [
  { id: 'hinge-glass',      label: 'Петля стекло-стекло',        hint: 'две пятки + барабан-ось' },
  { id: 'hinge-wall',       label: 'Петля стекло-стена',          hint: 'пятка на стекле + кронштейн к стене' },
  { id: 'handle-bar',       label: 'Ручка-скоба',                 hint: 'два плеча + хват' },
  { id: 'handle-knob',      label: 'Ручка-кноб',                  hint: 'круглый набалдашник' },
  { id: 'handle-inset',     label: 'Ручка-купе врезная',          hint: 'утопленная чаша' },
  { id: 'roller',           label: 'Ролик раздвижной',            hint: 'каретка на штанге' },
  { id: 'mount-glass',      label: 'Крепление стекло↔штанга',     hint: 'кубик на штанге, прорезь под стекло (КП-001)' },
  { id: 'mount-rail-end',   label: 'Крепление торца штанги',      hint: 'корпус на конце штанги + щеки на стекло' },
  { id: 'mount-wall',       label: 'Крепление штанги к стене',    hint: 'фланец на стене + обойма на трубе' },
  { id: 'mount-corner',     label: 'Крепление угловое',           hint: 'труба перпендикулярно к стеклу' },
  { id: 'mount-diag45',     label: 'Крепление 45° (люкс)',        hint: 'шарнир: диск + шар + хомут' },
  { id: 'mount-stabilizer', label: 'Крепление стабилизатора',     hint: 'настенный фланец + муфта' },
  { id: 'connector',        label: 'Соединитель штанги',          hint: 'стык двух отрезков под углом' },
  { id: 'cap',              label: 'Заглушка штанги',             hint: 'колпачок на торец' },
]

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
