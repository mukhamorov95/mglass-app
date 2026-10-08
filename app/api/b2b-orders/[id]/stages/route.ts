import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { createServiceClient } from '@/lib/supabase-service'
import { parseNotes } from '@/lib/b2b/publicQuote'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { consumeForOrder } from '@/lib/inventory/consumeHook'
import { orderMarkOf, orderUnmarksOf, CASCADE_FROM } from '@/lib/production/managerCascade'
import { closeOpenTasksOnOrderMark, reopenTasksOnOrderUnmark } from '@/lib/production/closeOnOrderMark'

// Единственный писатель notes.stages из менеджерского контура.
//
// Было: экран читал весь notes, правил и писал блоб обратно — две отметки по
// одному заказу теряли друг друга, а заодно могли снести оплату, доставку и
// рекламацию. Плюс два писателя писали дату по-разному: ручной тумблер
// YYYY-MM-DD, массовая отметка — полный ISO.
//
// Стало: дата всегда календарная (YYYY-MM-DD), запись — точечная по ключу этапа
// под блокировкой строки (RPC mark_order_stages). Оплату здесь не трогаем:
// «Счёт оплачен» пишет только /api/b2b-orders/[id]/payment (Д2).

const ALLOWED = ['admin', 'ceo', 'manager', 'commercial', 'buyer', 'production'] as const

// Ключи notes, которые экран заказов кладёт в patch (app/b2b-orders/page.tsx).
const STAGES_PATCH_KEYS: ReadonlySet<string> = new Set([
  'material_status', 'material_status_updated_at', 'material_status_updated_by',
  'deadline_control', 'bulk_actions',
])

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const toDateOnly = (v: unknown): string | null => {
  if (v === null || v === false) return null
  if (v === true) return new Date().toISOString().slice(0, 10)
  const s = String(v ?? '').trim()
  if (!s) return null
  if (DATE_ONLY.test(s)) return s
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireRole([...ALLOWED])
  if (guard instanceof NextResponse) return guard

  const { id } = await params
  const orderId = Number(id)
  if (!Number.isFinite(orderId)) return NextResponse.json({ error: 'Некорректный id' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const rawStages = (body?.stages ?? {}) as Record<string, unknown>
  if (Object.prototype.hasOwnProperty.call(rawStages, 'invoice_paid')) {
    return NextResponse.json({ error: 'Оплата отмечается через /payment' }, { status: 400 })
  }
  // Прочие верхнеуровневые поля notes (например material_status) — тем же вызовом,
  // чтобы экран не возвращался к записи блобом. Только перечисленные: патч пишет
  // сервис-ключ, его триггер не проверяет, и до 02.10 сюда можно было прислать
  // payment_status: 'paid' и запустить неоплаченный заказ точки.
  const patch = (body?.patch ?? {}) as Record<string, unknown>
  const foreign = Object.keys(patch).filter(k => !STAGES_PATCH_KEYS.has(k))
  if (foreign.length) {
    return NextResponse.json({ error: `Поле «${foreign[0]}» здесь не пишется` }, { status: 400 })
  }

  const stages: Record<string, string | null> = {}
  for (const [k, v] of Object.entries(rawStages)) stages[k] = toDateOnly(v)
  if (Object.keys(stages).length === 0 && Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Нечего сохранять' }, { status: 400 })
  }

  const svc = createServiceClient()

  if (Object.keys(stages).length > 0) {
    const { error } = await svc.rpc('mark_order_stages', { p_order_id: orderId, p_stages: stages })
    if (error) {
      // Пока миграция 20260830 не применена — не ломаемся: тот же результат,
      // но stages пишется объектом целиком (как раньше), под блокировкой строки.
      const missing = error.code === '42883' || /mark_order_stages/i.test(error.message ?? '')
      if (!missing) return NextResponse.json({ error: error.message }, { status: 500 })

      // Без прочитанной строки не пишем: parseNotes(null) даёт {}, и патч { stages } из
      // пустоты стёр бы все остальные этапы заказа.
      const { data: row, error: readErr } = await svc.from('b2b_orders').select('notes').eq('id', orderId).maybeSingle()
      if (readErr || !row) return NextResponse.json({ error: `Заказ не прочитан: ${readErr?.message ?? 'нет строки'}` }, { status: 500 })
      const notes = parseNotes((row.notes as string | null) ?? null)
      const merged = { ...(notes.stages as Record<string, unknown> ?? {}) }
      for (const [k, v] of Object.entries(stages)) {
        if (v === null) delete merged[k]
        else merged[k] = v
      }
      const { error: fbErr } = await svc.rpc('patch_order_notes_shallow', {
        p_order_id: orderId, p_patch: { stages: merged },
      })
      if (fbErr) return NextResponse.json({ error: fbErr.message }, { status: 500 })
    }
  }

  if (Object.keys(patch).length > 0) {
    const { error } = await svc.rpc('patch_order_notes_shallow', { p_order_id: orderId, p_patch: patch })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Атрибуция: реальный менеджер, отметивший упаковку/отгрузку. Без живого актора
  // (сервис-ключ/крон) — честный системный ярлык, не выдуманный человек.
  const mark = orderMarkOf(stages)
  const unmarks = orderUnmarksOf(stages)
  let by: { userId?: string; name?: string } = { name: 'b2b-orders (авто)' }
  if (mark || unmarks.length) {
    try {
      const server = await createServerClient()
      const { data: { user } } = await server.auth.getUser()
      if (user?.id) {
        const { data: prof } = await server.from('users').select('name').eq('id', user.id).maybeSingle()
        by = { userId: user.id, name: (prof?.name as string | null) ?? user.email ?? undefined }
      }
    } catch { /* атрибуция не критична — закрытие и списание всё равно выполняем */ }
  }

  // Упакован/отгружен мимо цеха → открытые задачи цеха по заказу закрываются каскадом
  // (lib/production/managerCascade.ts). До этого отметка менеджера цех не трогала, и
  // уехавшие заказы месяцами висели в очередях. Снятие отметки (null) возвращает в очередь
  // то, что закрыл этот каскад, — «Упакован» ставится одним кликом, и ошибочный клик
  // иначе молча выкидывал заказ в работе из очередей рабочих.
  let shopClosed = 0
  let shopReopened = 0
  let shopError: string | undefined
  if (unmarks.length) {
    const r = await reopenTasksOnOrderUnmark(svc, orderId, unmarks.map(m => CASCADE_FROM.manager[m]), { id: by.userId })
    shopReopened = r.reopened
    shopError = r.error
    if (r.error) console.error(`[stages] shop reopen failed order=${orderId}: ${r.error}`)
  }
  if (mark) {
    const r = await closeOpenTasksOnOrderMark(svc, orderId, mark, CASCADE_FROM.manager[mark], { id: by.userId, name: by.name })
    shopClosed = r.closed
    shopError = r.error ?? shopError
    if (r.error) console.error(`[stages] shop cascade failed order=${orderId}: ${r.error}`)
  }

  // A25: ручная отметка «упаковано» списывает материал со склада так же, как
  // автосписание при закрытии упаковки в цехе — иначе заказы, упакованные мимо
  // цеха (треть за 60 дней), давали систематический недоучёт расхода → мнимая
  // недостача на инвентаризации. Единая точка consumeForOrder (её же зовёт цех):
  //   • origin='plan' — списываем по резерву, не выдаём за подтверждённый факт;
  //   • best-effort — функция не бросает, ошибка склада не роняет отметку этапа;
  //   • идемпотентность в БД — если цех уже списал, придёт alreadyConsumed без дубля,
  //     поэтому «кто первый» не проверяем.
  // ТОЛЬКО на переходе packaged в дату (установка флага); снятие (null) не списывает.
  if (typeof stages.packaged === 'string' && stages.packaged) {
    const consume = await consumeForOrder('b2b_order', String(orderId), by, 'plan')
    if (!consume.ok) {
      console.error(`[stages] consume failed order=${orderId}: ${consume.error}`)
    }
  }

  const { data: fresh } = await svc.from('b2b_orders').select('notes').eq('id', orderId).maybeSingle()
  return NextResponse.json({
    ok: true, notes: parseNotes((fresh?.notes as string | null) ?? null),
    shop_closed: shopClosed, shop_reopened: shopReopened, ...(shopError ? { shop_error: shopError } : {}),
  })
}
