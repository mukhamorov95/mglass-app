import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { isOwnerRole } from '@/lib/getRole'
import { createServiceClient } from '@/lib/supabase-service'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { LEAD_NOTE_KEYS, leadNoteError } from '@/lib/b2b/leadQuote'

export const dynamic = 'force-dynamic'

// Ключи notes, которые B2B-калькулятор пишет при правке просчёта. Из браузера
// patch_order_notes_shallow пускает только цех и владельца (_assert_shop_caller, 30.07),
// и с 22.09 каждая правка просчёта менеджером сохраняла поля, а на notes падала:
// «forbidden: shop action requires production role». Пишем сервером после своей проверки.
const ROLES = ['admin', 'ceo', 'manager', 'commercial'] as const
const KEYS = new Set<string>(['status', 'quote_date', 'production_days', 'user_notes', 'manager_name', ...LEAD_NOTE_KEYS])

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  const guard = await requireRole([...ROLES])
  if (guard instanceof NextResponse) return guard

  const { id } = await params
  const orderId = Number(id)
  if (!Number.isInteger(orderId) || orderId <= 0) return NextResponse.json({ error: 'Некорректный номер заказа' }, { status: 400 })

  const body = await req.json().catch(() => ({})) as { patch?: Record<string, unknown> }
  const patch: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(body.patch ?? {})) {
    if (!KEYS.has(k)) return NextResponse.json({ error: `Поле «${k}» калькулятор не пишет` }, { status: 400 })
    if (v !== null && !['string', 'number'].includes(typeof v)) return NextResponse.json({ error: `Поле «${k}» — не строка и не число` }, { status: 400 })
    const leadErr = leadNoteError(k, v)
    if (leadErr) return NextResponse.json({ error: `Поле «${k}»: ${leadErr}` }, { status: 400 })
    patch[k] = typeof v === 'string' ? v.slice(0, 4000) : v
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Нечего записать' }, { status: 400 })

  const { data: prof, error: profErr } = await supabase.from('users').select('see_all_orders').eq('id', user.id).maybeSingle()
  if (profErr) return NextResponse.json({ error: `Профиль не прочитан: ${profErr.message}` }, { status: 500 })
  const seeAll = isOwnerRole(guard) || (prof as { see_all_orders?: boolean } | null)?.see_all_orders === true

  const svc = createServiceClient()
  const { data: order, error: readErr } = await svc.from('b2b_orders')
    .select('id, created_by, archived_at').eq('id', orderId).maybeSingle()
  if (readErr) return NextResponse.json({ error: `Заказ не прочитан: ${readErr.message}` }, { status: 500 })
  if (!order || order.archived_at) return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 })
  // Правило 4: менеджер правит свои просчёты, владелец и «видит все заказы» — любые.
  if (!seeAll && String(order.created_by ?? '') !== user.id) {
    return NextResponse.json({ error: 'Это просчёт другого менеджера' }, { status: 403 })
  }

  const { error } = await svc.rpc('patch_order_notes_shallow', { p_order_id: orderId, p_patch: patch })
  if (error) return NextResponse.json({ error: `Заметки просчёта не записаны: ${error.message}` }, { status: 500 })
  return NextResponse.json({ ok: true })
}
