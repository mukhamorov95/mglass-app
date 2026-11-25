import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { denyUnless, resolvePartnerMember } from '@/lib/partnerClient'
import { parseNotes } from '@/lib/orderFlags'
import { isLaunched } from '@/lib/partner/orderProgress'
import { loadPaidByOrders, paymentView } from '@/lib/partner/orderMoney'
import { isSettledOrder } from '@/lib/b2b/settledBefore'
import { partnerOrderNo } from '@/lib/partner/format'
import { canonicalOrderIds } from '@/lib/b2b/invoiceRegistry'
import { loadInvoicesWithOrders } from '@/lib/money/invoiceSync'
import { attachInvoicePayments, asInvoiceRows } from '@/lib/money/invoicePayments'
import { combinedInvoiceNo, planCombined, type RelatedInvoice } from '@/lib/partner/combinedInvoice'
import { entityTitle, type B2BLegalEntity } from '@/lib/b2bLegalEntities'
import { finalTotalOf } from '@/lib/b2b/priceOverride'
import { writeLogForCurrentUser } from '@/lib/activityLog'
import { previewWriteGuard } from '@/lib/partnerPreview'

// Объединённые счета кабинета (владелец 25.11.2026). GET — счета клиента на несколько заказов
// со статусом оплаты по деньгам; POST { orderIds } — собрать неоплаченные заказы в один счёт.
// Сервис-ключ: invoices закрыта RLS финконтуром, клиента и права проверяем здесь до чтения.

type Client = { id: number; name: string; can_self_invoice: boolean | null }

async function partner() {
  const sb = await createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Не авторизован' }, { status: 401 }) }
  const svc = createServiceClient()
  const pm = await resolvePartnerMember<Client>(svc, user.id, 'id,name,can_self_invoice')
  if (!pm) return { error: NextResponse.json({ error: 'Аккаунт не привязан' }, { status: 403 }) }
  const denied = denyUnless(pm.role, 'finance')
  if (denied) return { error: denied }
  return { svc, client: pm.client, user, preview: pm.preview }
}

export async function GET() {
  const p = await partner()
  if ('error' in p) return p.error
  const { svc, client } = p
  const { data: rows, error } = await svc.from('invoices')
    .select('id, invoice_no, order_ids, amount, status, issued_at, created_by_name, payment_doc_path, payment_doc_name, payment_doc_at')
    .eq('payer_client_id', client.id).neq('status', 'cancelled').order('id', { ascending: false }).limit(200)
  if (error) return NextResponse.json({ error: `Счета не прочитаны: ${error.message}` }, { status: 500 })
  const multi = (rows ?? []).filter(r => Array.isArray(r.order_ids) && r.order_ids.length > 1)
  const ids = [...new Set(multi.flatMap(r => (r.order_ids as number[]).map(Number)))]
  const { data: own } = ids.length ? await svc.from('b2b_orders').select('id, client_id, custom_number, launched_at, notes, total_after_discount, total_sale_inc_vat').in('id', ids) : { data: [] }
  const ownMap = new Map((own ?? []).map(o => [Number(o.id), o]))
  // Только счета, где все заказы — этого клиента: чужой заказ в счёте не показываем.
  const mine = multi.filter(r => (r.order_ids as number[]).every(id => ownMap.get(Number(id))?.client_id === client.id))
  let withPay
  try { withPay = await attachInvoicePayments(svc, asInvoiceRows(mine)) }
  catch (e) { return NextResponse.json({ error: `Оплаты счетов не прочитаны: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 }) }
  // Статус счёта — тот же, что у его заказов в кабинете: заказ мог быть закрыт без денег по счёту
  // (отметкой или старым расчётом), и «Не оплачен» над оплаченными заказами было бы неправдой.
  let paidMap: Map<number, number>
  try { paidMap = await loadPaidByOrders(svc, ids) }
  catch (e) { return NextResponse.json({ error: `Оплаты не прочитаны: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 }) }
  const orderPaid = (id: number) => {
    const o = ownMap.get(id)
    if (!o) return false
    const n = parseNotes(o.notes)
    const v = paymentView({ total: finalTotalOf(o as { total_after_discount?: number; total_sale_inc_vat?: number }), paidFromPayments: paidMap.get(id) ?? 0, notes: n, due: true, settled: isSettledOrder(client.id, o.launched_at, n) })
    return v?.status === 'paid' || v?.status === 'own_cost'
  }
  return NextResponse.json({
    canCombine: !!client.can_self_invoice,
    invoices: withPay.map(r => ({
      id: r.id, no: String(r.invoice_no), issuedAt: r.issued_at as string, amount: Number(r.amount) || 0,
      ...((r.order_ids ?? []).every(id => orderPaid(Number(id)))
        ? { paid: Number(r.amount) || 0, remainder: 0, status: 'paid' as const }
        : { paid: r.paid, remainder: r.remainder, status: r.derivedStatus }),
      orders: (r.order_ids ?? []).map(id => ({ id, no: partnerOrderNo({ id, custom_number: (ownMap.get(id)?.custom_number as string | null) ?? null }) })),
      paymentDoc: r.payment_doc_path ? { name: (r.payment_doc_name as string | null) ?? 'платёжное поручение', at: r.payment_doc_at as string | null } : null,
    })),
  })
}

export async function POST(req: Request) {
  const p = await partner()
  if ('error' in p) return p.error
  const { svc, client, user, preview } = p
  if (!client.can_self_invoice) return NextResponse.json({ error: 'Счета вам выставляет менеджер — попросите его объединить заказы.' }, { status: 403 })
  if (preview) { const blocked = await previewWriteGuard(svc, user.id, { allowOnTest: true }); if (blocked) return blocked }

  const body = await req.json().catch(() => ({})) as { orderIds?: unknown }
  const orderIds = canonicalOrderIds(body.orderIds)
  if (orderIds.length < 2) return NextResponse.json({ error: 'Выберите хотя бы два заказа' }, { status: 400 })
  if (orderIds.length > 60) return NextResponse.json({ error: 'Не больше 60 заказов в одном счёте' }, { status: 400 })

  const { data: orders, error: oErr } = await svc.from('b2b_orders')
    .select('id, client_id, custom_number, launched_at, notes, total_after_discount, total_sale_inc_vat').in('id', orderIds)
  if (oErr) return NextResponse.json({ error: `Заказы не прочитаны: ${oErr.message}` }, { status: 500 })
  if ((orders ?? []).length !== orderIds.length || orders!.some(o => o.client_id !== client.id)) {
    return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 })
  }

  // Только запущенные и полностью неоплаченные: цифры финальные, деньги ещё не приходили.
  let paidMap: Map<number, number>
  try { paidMap = await loadPaidByOrders(svc, orderIds) }
  catch (e) { return NextResponse.json({ error: `Оплаты не прочитаны: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 }) }
  const bad: string[] = []
  for (const o of orders!) {
    const n = parseNotes(o.notes)
    const no = partnerOrderNo({ id: o.id as number, custom_number: o.custom_number as string | null })
    if (!isLaunched({ launched_at: o.launched_at as string | null }, n)) { bad.push(`${no} — ещё не в работе`); continue }
    const v = paymentView({ total: finalTotalOf(o as { total_after_discount?: number; total_sale_inc_vat?: number }), paidFromPayments: paidMap.get(o.id as number) ?? 0, notes: n, due: true, settled: isSettledOrder(client.id, o.launched_at, n) })
    if (v?.status !== 'awaiting') bad.push(`${no} — ${v?.status === 'partial' ? 'уже частично оплачен' : v?.status === 'own_cost' ? 'за наш счёт' : 'уже оплачен'}`)
  }
  if (bad.length) return NextResponse.json({ error: `Не войдут в счёт: ${bad.join('; ')}.` }, { status: 409 })

  let related: RelatedInvoice[]
  try {
    related = (await loadInvoicesWithOrders(svc, orderIds)).map(r => ({
      id: r.id, invoice_no: String(r.invoice_no ?? r.id), order_ids: (r.order_ids ?? []).map(Number), status: r.status, derivedStatus: r.derivedStatus,
    }))
  } catch (e) { return NextResponse.json({ error: `Счета заказов не прочитаны: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 }) }
  const plan = planCombined(orderIds, related)
  if (plan.same) return NextResponse.json({ ok: true, id: plan.same.id, existing: true })
  if (plan.blocked.length) {
    const why = plan.blocked.map(b => `счёт № ${b.invoice.invoice_no} ${b.reason === 'paid' ? 'уже частично оплачен' : 'включает и другие заказы'}`)
    return NextResponse.json({ error: `Часть заказов уже в другом счёте: ${why.join('; ')}. Объединить их может ваш менеджер.` }, { status: 409 })
  }

  const { data: ents } = await svc.from('b2b_client_legal_entities').select('id, full_name, inn, is_default')
    .eq('client_id', client.id).eq('active', true).order('is_default', { ascending: false }).order('id')
  const ent = (ents ?? [])[0] as Pick<B2BLegalEntity, 'id' | 'full_name' | 'inn'> | undefined
  const amount = Math.round(orders!.reduce((s, o) => s + finalTotalOf(o as { total_after_discount?: number; total_sale_inc_vat?: number }), 0) * 100) / 100
  const nos = orders!.map(o => partnerOrderNo({ id: o.id as number, custom_number: o.custom_number as string | null }))
  const { data: me } = await svc.from('users').select('name').eq('id', user.id).maybeSingle()

  // Прежние неоплаченные счета этих же заказов заменяются новым — иначе долг задвоится.
  for (const r of plan.replace) {
    const { data: done, error } = await svc.from('invoices')
      .update({ status: 'cancelled', comment: `Заменён объединённым счётом из кабинета (${combinedInvoiceNo(nos)})`, updated_at: new Date().toISOString() })
      .eq('id', r.id).eq('status', 'issued').select('id')
    if (error || !done?.length) return NextResponse.json({ error: `Прежний счёт № ${r.invoice_no} не заменён${error ? `: ${error.message}` : ''}` }, { status: 500 })
  }

  const { data: created, error } = await svc.from('invoices').insert({
    invoice_no: combinedInvoiceNo(nos), payer_client_id: client.id,
    payer_entity_id: ent?.id ?? null, payer_name: ent ? entityTitle(ent) : client.name,
    order_ids: orderIds, amount, vat: Math.round(amount * 22 / 122 * 100) / 100,
    comment: 'Объединённый счёт из кабинета заказчика',
    created_by: user.id, created_by_name: `${(me?.name as string | undefined) || client.name} (кабинет)`,
  }).select('id').single()
  if (error) return NextResponse.json({ error: `Счёт не создан: ${error.message}` }, { status: 500 })
  await writeLogForCurrentUser('partner.invoice.combine', { entityType: 'invoice', entityId: String(created.id), details: { order_ids: orderIds, amount, replaced: plan.replace.map(r => r.id) } }).catch(() => {})
  return NextResponse.json({ ok: true, id: created.id, existing: false, replaced: plan.replace.map(r => r.invoice_no) })
}
