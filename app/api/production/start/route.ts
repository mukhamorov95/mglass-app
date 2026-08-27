import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { requireRole } from '@/lib/apiAuth'
import { actorName } from '@/lib/production/executor'
import {
  buildStartPatch, pickAutoRelease, pickStartable,
  RELEASE_TASK_PATCH, type StartCandidate, type StartVia,
} from '@/lib/production/start'

// П2 — начало работы без трения. Живёт под /api/production/, а не под
// /api/production-tasks/, чтобы не спорить с динамическим сегментом [id].
//
// Зовётся из /production-app/my-queue: раскрытие карточки заказа (via='open',
// автоматически) и кнопка «Взял» (via='button'). Best-effort: ошибка тут никогда
// не должна мешать рабочему — он пришёл смотреть, что делать, а не отмечаться.

const SHOP_ROLES = ['production', 'admin', 'ceo', 'buyer'] as const
const MAX_TASKS = 200

export async function POST(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  const guard = await requireRole([...SHOP_ROLES])
  if (guard instanceof NextResponse) return guard

  const body = await req.json().catch(() => ({}))
  const via: StartVia = body.via === 'button' ? 'button' : 'open'
  const keepOrderId = typeof body.order_id === 'number' ? body.order_id : null
  const ids = (Array.isArray(body.task_ids) ? body.task_ids : [])
    .filter((n: unknown): n is number => typeof n === 'number' && Number.isFinite(n))
    .slice(0, MAX_TASKS)

  const svc = createServiceClient()
  const now = new Date().toISOString()
  const { data: prof } = await supabase.from('users').select('name').eq('id', user.id).maybeSingle()
  const actor = { id: user.id, name: actorName((prof as { name: string | null } | null)?.name, user.email) }

  let started = 0
  if (ids.length > 0) {
    const { data: rows } = await svc.from('production_tasks')
      .select('id, order_id, status, blocked_by_task_id, started_at, assigned_to, started_via')
      .in('id', ids)
    const candidates = (rows ?? []) as StartCandidate[]

    // Готовность проверяем здесь, а не по списку из браузера: иначе автостарт
    // открыл бы этап, до которого деталь физически ещё не доехала.
    const blockerIds = [...new Set(candidates.map(t => t.blocked_by_task_id).filter((x): x is number => x != null))]
    const doneBlockers = new Set<number>()
    if (blockerIds.length) {
      const { data: blk } = await svc.from('production_tasks').select('id, status').in('id', blockerIds)
      for (const b of (blk ?? []) as { id: number; status: string }[]) if (b.status === 'done') doneBlockers.add(b.id)
    }

    // Уже начатые и закрытые отсеиваются в pickStartable — повторный вызов
    // (рабочий свернул и снова раскрыл карточку) ничего не сдвигает.
    const startable = pickStartable(candidates, doneBlockers)

    // Патч отличается только там, где уже есть started_at / assigned_to, —
    // группируем, чтобы не слать по запросу на задачу.
    const buckets = new Map<string, { patch: Record<string, unknown>; ids: number[] }>()
    for (const t of startable) {
      const patch = buildStartPatch(actor, t, now, via)
      const key = JSON.stringify(patch)
      const b = buckets.get(key) ?? { patch, ids: [] }
      b.ids.push(t.id)
      buckets.set(key, b)
    }
    for (const b of buckets.values()) {
      const { error } = await svc.from('production_tasks').update(b.patch).in('id', b.ids)
      if (!error) started += b.ids.length
    }
  }

  // Рабочий делает один заказ за раз: раскрыл другой — прежний автостарт снимаем.
  // Ищем по started_by, а не по assigned_to: автостарт assigned_to не трогает,
  // чтобы просмотр заказа не уводил работу из общего пула станции.
  // Явный «Взял» не трогаем никогда, это его осознанное решение.
  let released = 0
  if (via === 'open') {
    const { data: mine } = await svc.from('production_tasks')
      .select('id, order_id, status, blocked_by_task_id, started_at, assigned_to, started_via')
      .eq('started_by', user.id).eq('status', 'in_progress').eq('started_via', 'open')
    const releaseIds = pickAutoRelease((mine ?? []) as StartCandidate[], keepOrderId)
    if (releaseIds.length) {
      const { error } = await svc.from('production_tasks').update({ ...RELEASE_TASK_PATCH }).in('id', releaseIds)
      if (!error) released = releaseIds.length
    }
  }

  return NextResponse.json({ ok: true, started, released })
}
