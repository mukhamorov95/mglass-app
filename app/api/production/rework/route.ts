import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { requireRole } from '@/lib/apiAuth'
import { actorName } from '@/lib/production/executor'
import { parseReworkBody } from '@/lib/production/rework'
import { applyRework } from '@/lib/production/reworkApply'

// П3 — «Переделать» / «Брак»: маршрут детали возвращается назад, брак записывается побочным
// эффектом. Одно действие рабочего = одна запись в журнале переделок + переоткрытые задачи.
// Зовут два экрана: очередь (task_id — задача, на которой нашли брак) и карточка заказа
// (order_id + item_index — место берётся из фронтира позиции). dry_run отдаёт план без записи:
// карточка показывает его в подтверждении («пойдёт заново с резки, вернётся 4 этапа»).

// Allow-list ролей цеха: менеджер, партнёр, замерщик сюда не проходят.
const SHOP_ROLES = ['production', 'admin', 'ceo', 'buyer'] as const

export async function POST(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  const guard = await requireRole([...SHOP_ROLES])
  if (guard instanceof NextResponse) return guard

  const parsed = parseReworkBody(await req.json().catch(() => ({})))
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const { target, reason, comment, dryRun } = parsed.value

  const svc = createServiceClient()

  // Позиция: из задачи или прямо из запроса — тогда сверяем, что она есть в заказе.
  let orderId: number
  let itemIndex: number
  let foundTaskId: number | undefined
  if ('taskId' in target) {
    const { data: task, error: tErr } = await svc.from('production_tasks')
      .select('id, order_id, item_index').eq('id', target.taskId).maybeSingle()
    if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 })
    if (!task) return NextResponse.json({ error: 'Задача не найдена' }, { status: 404 })
    orderId = task.order_id
    itemIndex = task.item_index
    foundTaskId = task.id
  } else {
    orderId = target.orderId
    itemIndex = target.itemIndex
  }

  const { data: ord, error: oErr } = await svc.from('b2b_orders')
    .select('id, items, custom_number, client_name').eq('id', orderId).maybeSingle()
  if (oErr) return NextResponse.json({ error: oErr.message }, { status: 500 })
  if (!ord) return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 })
  const o = ord as { id: number; items: unknown; custom_number: string | null; client_name: string | null }
  const itemsCount = Array.isArray(o.items) ? o.items.length : 0
  if (!('taskId' in target) && itemIndex >= itemsCount) {
    return NextResponse.json({ error: `В заказе нет позиции ${itemIndex + 1}` }, { status: 400 })
  }

  const { data: prof } = await supabase.from('users').select('name').eq('id', user.id).maybeSingle()
  const who = actorName((prof as { name: string | null } | null)?.name, user.email)

  const res = await applyRework(svc, { order: o, itemIndex, reason, comment, foundTaskId, dryRun, actor: { id: user.id, name: who } })
  if ('error' in res) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json(res)
}
