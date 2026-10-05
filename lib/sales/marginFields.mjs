// Статьи книги «Маржа» и правки из приложения. Без адреса книги и без загрузки:
// модуль читает и клиентская карточка объекта (components/sales/MarginObjectRow.tsx),
// и Node-скрипт сверки — поэтому .mjs, типы — в marginFields.d.mts.

export const COST_KEYS = [
  'glass', 'hardware', 'designer', 'measurer', 'installer', 'delivery',
  'partners', 'claims', 'tax', 'bonus_manager', 'bonus_ror', 'bonus_rop',
]

// «По объекту проставлены все расходы» — эти шесть статей заполнены, хотя бы нулём.
// Партнёров и рекламаций у большинства объектов нет: там пустая ячейка и значит
// «не было». Налог и бонусы книга считает формулой от суммы.
export const REQUIRED_COSTS = ['glass', 'hardware', 'designer', 'measurer', 'installer', 'delivery']

export const COST_RU = {
  glass: 'стекло', hardware: 'фурнитура', designer: 'конструктор', measurer: 'замерщик',
  installer: 'монтажник', delivery: 'доставка', partners: 'партнёры', claims: 'рекламации',
  tax: 'налог', bonus_manager: 'бонус менеджера', bonus_ror: 'бонус РОР', bonus_rop: 'бонус РОП',
}

// Правка «Маржи» из приложения (margin_edits) — ячейка объекта поверх книги. Ключ —
// продажа, а не строка книги: номер строки сдвигается при вставке.
export const EDIT_FIELDS = [...COST_KEYS, 'closed']
