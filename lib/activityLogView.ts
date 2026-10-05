// Журнал действий (activity_log) — как его читает владелец: кто, когда, где, что было
// и что стало. Записи двух видов: от триггера базы (row.insert/update/delete, миграция
// 20261006_margin_edits_audit) и прежние явные (user.permission_change и т. п.).
// Чистые функции — тест __tests__/activityLogView.test.ts.

import { COST_RU, type CostKey } from '@/lib/sales/marginFields.mjs'

export type LogEntry = {
  id: number
  user_id: string | null
  user_name: string | null
  action: string
  entity_type: string | null
  entity_id: string | null
  details: Record<string, unknown> | null
  created_at: string
}

export const TABLES: Record<string, string> = {
  crm_sales: 'Продажи',
  margin_edits: 'Маржа',
  manager_month_plans: 'Планы менеджеров',
  users: 'Пользователи и права',
  payments: 'Платежи',
  commercial_proposals: 'КП',
  contracts: 'Договоры и счета',
  calculations: 'Расчёты',
  financial_settings: 'Финансовые настройки',
  earnings_settings: 'Мотивация менеджеров',
  b2b_rates: 'Ставки B2B',
  manager_schedules: 'Графики менеджеров',
  user: 'Пользователи и права',
}

const COLUMNS: Record<string, string> = {
  status: 'статус', amount: 'сумма', partner_fee: 'партнёрские', prepayment: 'предоплата',
  prepayment_paid: 'предоплата оплачена', remainder_paid: 'остаток оплачен', paid_remainder_at: 'остаток оплачен',
  manager: 'менеджер', client: 'клиент', order_no: '№ заказа', sale_date: 'дата продажи', ready_date: 'дата готовности',
  note: 'примечание', payment_method: 'способ оплаты', department: 'отдел', voided: 'погашена', needs_review: 'на проверку',
  ledger_month: 'месяц книги', product_type: 'изделие', value: 'значение', plan_money: 'план', month: 'месяц',
  role: 'роль', permissions: 'права', can_view_all_deals: 'видеть все сделки', can_view_all_clients: 'видеть всех клиентов',
  can_view_money: 'видеть деньги', active: 'активен', name: 'имя', email: 'почта', amo_user_id: 'amo-id',
  max_discount_percent: 'макс. скидка', can_delete: 'может удалять', paid_at: 'дата оплаты', kind: 'вид', method: 'способ',
  voided_at: 'отменён', total: 'итого', number: 'номер', client_name: 'клиент', final_price: 'цена', discount: 'скидка',
  margin: 'маржа', items: 'позиции', content: 'текст', spec: 'спецификация', work_from: 'начало дня', work_to: 'конец дня',
  work_days: 'рабочие дни', is_seller: 'продавец', starts_on: 'вышел с', base_salary_rub: 'оклад', commission_tiers: 'шкала комиссии',
  archived_at: 'в архиве', deal_id: 'сделка', label: 'название',
}

const VERB: Record<string, { text: string; tone: 'add' | 'edit' | 'del' }> = {
  'row.insert': { text: 'создано', tone: 'add' },
  'row.update': { text: 'изменено', tone: 'edit' },
  'row.delete': { text: 'удалено', tone: 'del' },
  'user.update': { text: 'изменён пользователь', tone: 'edit' },
  'user.permission_change': { text: 'изменены права', tone: 'edit' },
  'user.password_change': { text: 'сменён пароль', tone: 'edit' },
}

export function fmtValue(v: unknown, column?: string): string {
  if (v == null || v === '') return '—'
  if (column === 'status' && typeof v === 'string') return v === 'closed' ? 'закрыт' : v === 'open' ? 'в работе' : v
  if (typeof v === 'boolean') return v ? 'да' : 'нет'
  if (typeof v === 'number') return v.toLocaleString('ru-RU')
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) && v.length < 16) return Number(v).toLocaleString('ru-RU')
  if (typeof v === 'string') return v.length > 80 ? `${v.slice(0, 80)}…` : v
  const s = JSON.stringify(v)
  return s.length > 80 ? `${s.slice(0, 80)}…` : s
}

export type Change = { what: string; before: string; after: string }
export type Described = {
  verb: string
  tone: 'add' | 'edit' | 'del' | 'info'
  place: string          // раздел: «Продажи», «Маржа»…
  object: string         // о чём: «заказ 0944-3 · Юлия Горбачева», «Вера»
  changes: Change[]
}

// sales — номера заказов по id продажи: у правки маржи в ключе только id.
export function describe(e: LogEntry, sales: Map<number, { order_no: string | null; client: string | null }> = new Map()): Described {
  const v = VERB[e.action] ?? { text: e.action, tone: 'info' as const }
  const d = (e.details ?? {}) as { row?: Record<string, unknown>; changes?: Record<string, unknown>; permissions?: unknown }
  const row = d.row ?? {}
  const table = e.entity_type ?? ''
  const place = TABLES[table] ?? table
  const changes: Change[] = []

  if (table === 'margin_edits') {
    const [saleId, field] = (e.entity_id ?? '').split(' · ')
    const s = sales.get(Number(saleId))
    const what = field === 'closed' ? 'закрыт' : COST_RU[field as CostKey] ?? field
    const object = s ? `заказ ${s.order_no ?? '—'}${s.client ? ` · ${s.client}` : ''}` : `продажа #${saleId}`
    const asVal = (x: unknown) => (field === 'closed' ? (Number(x) === 1 ? 'да' : 'нет') : fmtValue(x))
    if (e.action === 'row.update') {
      const c = (d.changes?.value ?? []) as unknown[]
      changes.push({ what, before: asVal(c[0]), after: asVal(c[1]) })
    } else if (e.action === 'row.insert') changes.push({ what, before: 'из книги', after: asVal(row.value) })
    else if (e.action === 'row.delete') changes.push({ what, before: asVal(row.value), after: 'снова из книги' })
    return { verb: v.text, tone: v.tone, place, object, changes }
  }

  for (const [k, c] of Object.entries(d.changes ?? {})) {
    const what = COLUMNS[k] ?? k
    if (Array.isArray(c)) changes.push({ what, before: fmtValue(c[0], k), after: fmtValue(c[1], k) })
    else changes.push({ what, before: '', after: 'изменено' })
  }
  const name = row.order_no ? `заказ ${row.order_no}` : row.number ? `№ ${row.number}` : row.name ? String(row.name) : row.month && row.amo_user_id ? `${row.month}, amo #${row.amo_user_id}` : e.entity_id ? `#${e.entity_id}` : ''
  const who = row.client ?? row.client_name
  const object = [name, who].filter(Boolean).join(' · ')
  if (e.action === 'row.delete' || e.action === 'row.insert') {
    for (const k of ['amount', 'status', 'manager', 'value', 'plan_money', 'total', 'final_price', 'role'] as const) {
      if (row[k] != null) changes.push({ what: COLUMNS[k], before: e.action === 'row.delete' ? fmtValue(row[k], k) : '', after: e.action === 'row.insert' ? fmtValue(row[k], k) : '' })
    }
  }
  if (e.action === 'user.permission_change' && d.permissions) changes.push({ what: 'права', before: '', after: fmtValue(d.permissions) })
  return { verb: v.text, tone: v.tone, place, object, changes }
}
