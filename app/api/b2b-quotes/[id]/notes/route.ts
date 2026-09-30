import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { canAccessRoute } from '@/lib/getRole'
import { isMGlassClient, MGLASS_SCOPE_ERROR } from '@/lib/b2bScope'
import { writeFailure } from '@/lib/rlsWrite'
import { actorName } from '@/lib/production/executor'
import {
  parseOrderNotes, statusPatch, launchPatch, isOrderStatus,
  KP_PAYMENT_TERMS, KP_PRICE_MODES, type Notes,
} from '@/lib/b2b/orderNotes'
import type { OrderNotesAction } from '@/lib/b2b/orderNotesClient'

// Правка notes просчёта/заказа со списка просчётов, воронки и печати КП. Экран шлёт
// намерение, патч собирается здесь из свежих notes (lib/b2b/orderNotes.ts): копия
// вкладки больше не затирает ответ клиента по ссылке, согласование, этапы и оплату.
//
// Право — то же, что было у экрана: калитка страницы /b2b-quotes, скоуп «только M GLASS»
// и запись строки под RLS вошедшего (.select('id') — ноль строк значит «нет прав»).
// Только после неё патч сервис-клиентом: patch_order_notes_shallow пускает лишь цех и
// владельца, менеджера — нет. Между свежим чтением и патчем — миллисекунды одного
// запроса; одновременная запись в тот же status_history в этом окне может потеряться.

type Body = OrderNotesAction

const DATE = /^\d{4}-\d{2}-\d{2}/
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const orderId = Number(id)
  if (!Number.isInteger(orderId) || orderId <= 0) return bad('Некорректный id')

  const sb = await createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return bad('Нужно войти', 401)
  const { data: prof, error: profErr } = await sb.from('users')
    .select('name, role, permissions').eq('id', user.id).maybeSingle()
  if (profErr) return bad(`Профиль не прочитан: ${profErr.message}`, 500)
  const p = prof as { name: string | null; role: string | null; permissions: { b2b_client_scope?: string | null } | null } | null
  const scope = p?.permissions?.b2b_client_scope ?? null
  if (!canAccessRoute(p?.role, '/b2b-quotes', { b2bScope: scope })) return bad('Нет доступа к просчётам', 403)

  const body = await req.json().catch(() => null) as Body | null
  if (!body || typeof body !== 'object') return bad('Пустой запрос')

  const { data: order, error: readErr } = await sb.from('b2b_orders')
    .select('id, client_id, client_name').eq('id', orderId).maybeSingle()
  if (readErr) return bad(`Заказ не прочитан: ${readErr.message}`, 500)
  if (!order) return bad('Заказ не найден', 404)
  const o = order as { id: number; client_id: number | null; client_name: string | null }
  if (scope === 'mglass_only' && !isMGlassClient({ id: o.client_id, name: o.client_name })) return bad(MGLASS_SCOPE_ERROR, 403)

  const at = new Date().toISOString()
  const who = actorName(p?.name, user.email)
  const columns: Record<string, unknown> = { updated_by_user_id: user.id, updated_by_name: who, updated_at: at }
  let build: (fresh: Notes) => Notes

  switch (body.action) {
    case 'status': {
      if (!isOrderStatus(body.to)) return bad('Неизвестный статус')
      const to = body.to
      const revert = body.revertToDraft === true && to === 'quote'
      if (revert) columns.launched_at = null
      const comment = typeof body.comment === 'string' ? body.comment.slice(0, 1000) : body.comment === null ? null : undefined
      build = fresh => statusPatch(fresh, to, { at, comment, revertToDraft: revert })
      break
    }
    case 'launch': {
      if (typeof body.workDate !== 'string' || !DATE.test(body.workDate)) return bad('Нужна дата запуска')
      if (body.deadline != null && (typeof body.deadline !== 'string' || !DATE.test(body.deadline))) return bad('Некорректный срок')
      const drawing = typeof body.drawingUrl === 'string' && body.drawingUrl.startsWith(`order-drawings/${orderId}.`) ? body.drawingUrl : null
      if (body.drawingUrl && !drawing) return bad('Чертёж не этого заказа')
      const num = typeof body.customNumber === 'string' ? body.customNumber.trim().slice(0, 40) : ''
      Object.assign(columns, {
        launched_at: body.workDate,
        launched_by_user_id: user.id, launched_by_name: who,
        converted_by_user_id: user.id, converted_by_name: who,
        ...(num ? { custom_number: num } : {}),
      })
      const workDate = body.workDate
      build = fresh => launchPatch(fresh, { at, workDate, deadline: body.deadline ?? null, drawingUrl: drawing })
      break
    }
    case 'template': {
      if (typeof body.value !== 'boolean') return bad('Нужно value')
      const value = body.value
      build = () => ({ is_template: value || null })
      break
    }
    case 'kp-options': {
      const patch: Notes = {}
      if (body.kp_payment_terms !== undefined) {
        if (!(KP_PAYMENT_TERMS as readonly string[]).includes(body.kp_payment_terms)) return bad('Неизвестные условия оплаты')
        patch.kp_payment_terms = body.kp_payment_terms
      }
      if (body.kp_price_mode !== undefined) {
        if (!(KP_PRICE_MODES as readonly string[]).includes(body.kp_price_mode)) return bad('Неизвестный вид цены')
        patch.kp_price_mode = body.kp_price_mode
      }
      if (!Object.keys(patch).length) return bad('Нечего менять')
      build = () => patch
      break
    }
    default:
      return bad('Неизвестное действие')
  }

  // Право на строку — под RLS вошедшего, как раньше делал экран.
  const fail = writeFailure(await sb.from('b2b_orders').update(columns).eq('id', orderId).select('id'))
  if (fail) return bad(fail, 403)

  const svc = createServiceClient()
  const { data: freshRow, error: freshErr } = await svc.from('b2b_orders').select('notes').eq('id', orderId).maybeSingle()
  // Без свежего чтения не пишем: патч из пустого объекта потерял бы историю статусов.
  if (freshErr || !freshRow) return bad(`Заказ не прочитан: ${freshErr?.message ?? 'нет строки'}`, 500)
  const fresh = parseOrderNotes((freshRow as { notes: unknown }).notes)
  const patch = build(fresh)
  const { error: patchErr } = await svc.rpc('patch_order_notes_shallow', { p_order_id: orderId, p_patch: patch })
  if (patchErr) return bad(`Не сохранено: ${patchErr.message}`, 500)

  // Экран берёт notes из ответа; не перечиталось — отдаём свежие с патчем, а не null.
  const { data: after } = await svc.from('b2b_orders').select('notes').eq('id', orderId).maybeSingle()
  const notes = (after as { notes: string | null } | null)?.notes ?? JSON.stringify({ ...fresh, ...patch })
  return NextResponse.json({ ok: true, notes, columns })
}
