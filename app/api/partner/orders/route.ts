import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

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
function deadline(pn: Record<string, unknown>, createdAt: string): string {
  const dl = pn.deadline_date ? new Date(pn.deadline_date as string)
    : pn.launched_at && pn.production_days ? (() => { const d = new Date(pn.launched_at as string); d.setDate(d.getDate() + (pn.production_days as number)); return d })()
    : pn.launched_at ? (() => { const d = new Date(pn.launched_at as string); d.setDate(d.getDate() + 7); return d })()
    : (() => { const d = new Date(createdAt); d.setDate(d.getDate() + 10); return d })()
  return dl.toISOString()
}

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const svc = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  // Привязанный клиент. Ошибка (нет колонки user_id) или отсутствие строки → «не привязан».
  const { data: client, error: cErr } = await svc
    .from('b2b_clients').select('id,name').eq('user_id', user.id).maybeSingle()
  if (cErr || !client) return NextResponse.json({ linked: false, client: null, orders: [] })

  const { data } = await svc
    .from('b2b_orders')
    .select('id,custom_number,client_order_number,created_at,total_after_discount,total_sale_inc_vat,notes')
    .eq('client_id', client.id)
    .not('notes', 'ilike', '%"status":"quote"%')
    .is('archived_at', null)
    .order('created_at', { ascending: false })
    .limit(200)

  const orders = (data ?? []).map((o: Record<string, unknown>) => {
    const pn = parseNotes(o.notes as string | null)
    const stages = (pn.stages ?? {}) as Record<string, unknown>
    const shipped = stages.shipped === true
    const doneN = LANE.filter(s => stages[s.key] === true).length
    // Текущий этап = первый невыполненный; если упаковано — «готов»/«отгружен».
    const frontier = LANE.find(s => stages[s.key] !== true)
    const packed = stages.packed === true
    const stage = shipped ? 'Отгружен' : packed ? 'Готов к выдаче' : frontier ? frontier.label : 'В работе'
    return {
      id: o.id as number,
      number: (o.custom_number as string | null)?.trim() || `#${o.id}`,
      clientOrderNumber: (o.client_order_number as string | null) ?? null,
      created_at: o.created_at as string,
      amount: (o.total_after_discount as number | null) ?? (o.total_sale_inc_vat as number | null) ?? 0,
      progressPct: Math.round((doneN / LANE.length) * 100),
      stage,
      shipped,
      ready: packed && !shipped,
      deadline: deadline(pn, o.created_at as string),
    }
  })

  return NextResponse.json({ linked: true, client: { name: client.name }, orders })
}
