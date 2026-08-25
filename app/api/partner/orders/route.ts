import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { resolvePartnerClient } from '@/lib/partnerClient'

// Кабинет партнёра — «мои заказы» (read-only, строго по своему клиенту).
// Клиент определяется по b2b_clients.user_id = auth.uid(). Никогда не отдаёт
// чужие данные. Если аккаунт не привязан (или колонка ещё не создана) — пусто.

// Лента заказа (order-level флаги notes.stages) → человекочитаемый этап и % готовности.
const LANE: { key: string; label: string }[] = [
  { key: 'printed',          label: 'Чертёж' },
  { key: 'material_ordered', label: 'Материал' },
  { key: 'cut',              label: 'Резка' },
  { key: 'edge',             label: 'Полировка' },
  { key: 'drilled',          label: 'Сверление' },
  { key: 'tempering',        label: 'Закалка' },
  { key: 'packed',           label: 'Упаковка' },
]

function parseNotes(n: string | null): Record<string, unknown> {
  if (!n) return {}
  try { const p = JSON.parse(n); return typeof p === 'object' && p ? p as Record<string, unknown> : {} } catch { return {} }
}
// Рабочие дни (пропуская сб/вс) — согласованно с А1/А4 (расчёт срока при запуске
// и сортировка цеха). Раньше запущенный заказ без явного срока показывал фабрикованные
// +7 дней; теперь честный ориентир — запуск + 15 рабочих дней (сварное правит менеджер).
function addWorkingDays(from: Date, days: number): Date {
  const d = new Date(from); let left = days
  while (left > 0) { d.setDate(d.getDate() + 1); const wd = d.getDay(); if (wd !== 0 && wd !== 6) left-- }
  return d
}
function deadline(pn: Record<string, unknown>, createdAt: string): string {
  const dl = pn.deadline_date ? new Date(pn.deadline_date as string)
    : pn.launched_at && pn.production_days ? (() => { const d = new Date(pn.launched_at as string); d.setDate(d.getDate() + (pn.production_days as number)); return d })()
    : pn.launched_at ? addWorkingDays(new Date(pn.launched_at as string), 15)
    : addWorkingDays(new Date(createdAt), 15)
  return dl.toISOString()
}

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const svc = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  // Привязанный клиент (первичный владелец ИЛИ участник команды). Нет → «не привязан».
  const client = await resolvePartnerClient<{ id: number; name: string }>(svc, user.id, 'id,name')
  if (!client) return NextResponse.json({ linked: false, client: null, orders: [] })

  // Все состояния: просчёт → отправлен в работу → в работе → отгружен.
  // Партнёр видит и просчёты, которые мы сделали для него.
  const { data } = await svc
    .from('b2b_orders')
    .select('id,custom_number,client_order_number,created_at,updated_at,launched_at,total_after_discount,total_sale_inc_vat,notes,items')
    .eq('client_id', client.id)
    .is('archived_at', null)
    .order('created_at', { ascending: false })
    .limit(300)

  const orders = (data ?? []).map((o: Record<string, unknown>) => {
    const pn = parseNotes(o.notes as string | null)
    const stages = (pn.stages ?? {}) as Record<string, unknown>
    const status = (pn.status as string | undefined) || 'quote'
    const launched = !!(o.launched_at || pn.launched_at)
    const shipped = stages.shipped === true
    const packed = stages.packed === true
    const doneN = LANE.filter(s => stages[s.key] === true).length
    const frontier = LANE.find(s => stages[s.key] !== true)

    // lane: quote (просчёт) · submitted (отправлен в работу, ждёт нас) · in_work · shipped
    const lane = shipped ? 'shipped'
      : launched ? 'in_work'
      : status === 'pending_approval' ? 'submitted'
      : 'quote'

    const stage = lane === 'shipped' ? 'Отгружен'
      : lane === 'submitted' ? 'Отправлен в работу'
      : lane === 'quote' ? 'Просчёт'
      : packed ? 'Готов к выдаче'
      : frontier ? frontier.label : 'В работе'

    // Пересчитан ли просчёт нами и почему (для подсветки партнёру).
    const history = Array.isArray(pn.status_history) ? pn.status_history : []
    const lastComment = (pn.status_comment as string | undefined) || null

    // Что внутри — материалы + толщины (кратко) и число позиций.
    const items = Array.isArray(o.items) ? (o.items as Record<string, unknown>[]) : []
    const matLabels = [...new Set(items.map(it => {
      const nm = String(it.materialName ?? '').trim()
      const th = it.thickness ? `${it.thickness}мм` : ''
      return [nm, th].filter(Boolean).join(' ')
    }).filter(Boolean))]
    const summary = matLabels.slice(0, 2).join(' · ') + (matLabels.length > 2 ? ` +${matLabels.length - 2}` : '')

    return {
      id: o.id as number,
      number: (o.custom_number as string | null)?.trim() || `#${o.id}`,
      clientOrderNumber: (o.client_order_number as string | null) ?? null,
      created_at: o.created_at as string,
      updatedAt: (o.updated_at as string | null) ?? (o.created_at as string),
      amount: (o.total_after_discount as number | null) ?? (o.total_sale_inc_vat as number | null) ?? 0,
      lane,
      progressPct: lane === 'in_work' || lane === 'shipped' ? Math.round((doneN / LANE.length) * 100) : 0,
      stage,
      shipped,
      ready: packed && !shipped,
      deadline: deadline(pn, o.created_at as string),
      recalcNote: history.length > 0 ? lastComment : null,
      summary,
      positions: items.length,
    }
  })

  return NextResponse.json({ linked: true, client: { name: client.name }, orders })
}
