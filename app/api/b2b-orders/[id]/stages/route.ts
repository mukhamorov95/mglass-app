import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { createServiceClient } from '@/lib/supabase-service'
import { parseNotes } from '@/lib/b2b/publicQuote'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { consumeForOrder } from '@/lib/inventory/consumeHook'

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
  // чтобы экран не возвращался к записи блобом.
  const patch = (body?.patch ?? {}) as Record<string, unknown>

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

      const { data: row } = await svc.from('b2b_orders').select('notes').eq('id', orderId).maybeSingle()
      const notes = parseNotes((row?.notes as string | null) ?? null)
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
    // Атрибуция движения: реальный менеджер, отметивший упаковку. Без живого
    // актора (сервис-ключ/крон) — честный системный ярлык, не выдуманный человек.
    let by: { userId?: string; name?: string } = { name: 'b2b-orders (авто)' }
    try {
      const server = await createServerClient()
      const { data: { user } } = await server.auth.getUser()
      if (user?.id) {
        const { data: prof } = await server.from('users').select('name').eq('id', user.id).maybeSingle()
        by = { userId: user.id, name: (prof?.name as string | null) ?? user.email ?? undefined }
      }
    } catch { /* атрибуция не критична — списание всё равно выполняем */ }

    const consume = await consumeForOrder('b2b_order', String(orderId), by, 'plan')
    if (!consume.ok) {
      console.error(`[stages] consume failed order=${orderId}: ${consume.error}`)
    }
  }

  const { data: fresh } = await svc.from('b2b_orders').select('notes').eq('id', orderId).maybeSingle()
  return NextResponse.json({ ok: true, notes: parseNotes((fresh?.notes as string | null) ?? null) })
}
