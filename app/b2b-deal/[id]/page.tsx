import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { getRole, isOwnerRole } from '@/lib/getRole'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { finalTotalOf, type PriceApproval } from '@/lib/b2b/priceOverride'
import { paidByOrder, remainderStatus } from '@/lib/b2b/orderPayments'
import { effectiveItemTotal, type B2BOrderItem } from '@/lib/b2bCalculator'
import { deadlineFor } from '@/lib/b2b/deadline'
import { buildClientTimeline } from '@/lib/b2b/clientTimeline'
import { parseNotes } from '@/lib/b2b/publicQuote'

// А4: одна карточка сделки. Раньше просчёт и заказ жили в двух списках, документы
// в третьем месте, деньги в четвёртом — менеджер собирал картину по вкладкам.
// Здесь всё про сделку на одном экране; списки остаются точками входа и фильтрами.

const ALLOWED = ['admin', 'ceo', 'manager', 'commercial', 'buyer', 'cfo']

const fmt = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`
const dt = (v: string | null | undefined) => v ? new Date(v).toLocaleDateString('ru-RU') : '—'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-[#e4e4e0] rounded-2xl px-5 py-4">
      <h2 className="text-[10px] font-semibold uppercase tracking-widest text-[#9a9a95] mb-2.5">{title}</h2>
      {children}
    </section>
  )
}

export default async function DealPage({ params }: { params: Promise<{ id: string }> }) {
  const role = await getRole()
  if (!role || !ALLOWED.includes(role)) redirect('/access-denied')
  const owner = isOwnerRole(role)

  const { id } = await params
  const dealId = Number(id)
  if (!Number.isFinite(dealId)) notFound()

  const sb = await createServerClient()
  const { data } = await sb.from('b2b_orders')
    .select('id, client_id, client_name, custom_number, client_order_number, discount_percent, margin_percent, items, total_area, total_weight, total_cost_net, total_sale_inc_vat, total_after_discount, notes, created_at, created_by_name, launched_at, launched_by_name, updated_by_name, updated_at')
    .eq('id', dealId).maybeSingle()
  if (!data) notFound()

  const order = data as Record<string, unknown>
  const notes = parseNotes(order.notes as string | null)
  const items = (Array.isArray(order.items) ? order.items : []) as B2BOrderItem[]
  const discount = Number(order.discount_percent) || 0
  const total = finalTotalOf(order as { total_after_discount?: number; total_sale_inc_vat?: number })
  const launched = !!order.launched_at || notes.status === 'sent' || notes.status === 'confirmed'
  const number = (order.custom_number as string | null)?.trim() || String(dealId).padStart(5, '0')
  const timeline = buildClientTimeline(notes)
  const approval = notes.price_approval as PriceApproval | undefined
  const claim = notes.claim as { status?: string; reason?: string; cost?: number; fault?: string } | undefined
  const delivery = notes.delivery as { method?: string; address?: string | null; status?: string } | undefined
  // A23: оплата — из payments (не из notes). Прямые платежи по заказу + доля от
  // оплаченных счетов, куда заказ входит. Считаем на сервере — деньги наружу
  // без себестоимости.
  const [{ data: pays }, { data: invs }] = await Promise.all([
    sb.from('payments').select('amount, b2b_order_id, invoice_id, voided_at').eq('b2b_order_id', dealId).is('voided_at', null),
    sb.from('invoices').select('id, order_ids, amount').overlaps('order_ids', [dealId]),
  ])
  let invPays: { amount: number; b2b_order_id: number | null; invoice_id: number | null; voided_at: string | null }[] = []
  const invIds = ((invs ?? []) as { id: number }[]).map(i => i.id)
  if (invIds.length) {
    const { data } = await sb.from('payments').select('amount, b2b_order_id, invoice_id, voided_at').in('invoice_id', invIds).is('voided_at', null)
    invPays = ((data ?? []) as Record<string, unknown>[])
      .filter(p => p.b2b_order_id == null)
      .map(p => ({ amount: Number(p.amount) || 0, b2b_order_id: null, invoice_id: Number(p.invoice_id) || null, voided_at: null }))
  }
  const paidMap = paidByOrder(
    [...((pays ?? []) as Record<string, unknown>[]).map(p => ({ amount: Number(p.amount) || 0, b2b_order_id: Number(p.b2b_order_id) || null, invoice_id: p.invoice_id == null ? null : Number(p.invoice_id), voided_at: (p.voided_at as string | null) ?? null })), ...invPays],
    ((invs ?? []) as Record<string, unknown>[]).map(i => ({ id: Number(i.id), order_ids: Array.isArray(i.order_ids) ? (i.order_ids as unknown[]).map(Number) : null, amount: Number(i.amount) || 0 })),
    new Map([[dealId, total]]),
  )
  const rem = remainderStatus(total, paidMap.get(dealId) ?? 0)
  const paid = rem.paid
  const history = (Array.isArray(notes.total_history) ? notes.total_history : []) as { old_total?: number; new_total?: number; changed_by?: string; changed_at?: string; reset?: boolean }[]

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-3">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[11px] text-[#9a9a95]">
            <Link href={launched ? '/b2b-orders' : '/b2b-quotes'} className="hover:underline">
              ‹ {launched ? 'Заказы' : 'Просчёты'}
            </Link>
          </p>
          <h1 className="text-[24px] font-bold text-[#111110] mt-0.5">№ {number} · {String(order.client_name ?? '')}</h1>
          <p className="text-[12px] text-[#9a9a95] mt-0.5">
            {launched ? `запущен ${dt(order.launched_at as string)}` : `просчёт от ${dt((notes.quote_date as string) ?? (order.created_at as string))}`}
            {order.created_by_name ? ` · ${order.created_by_name}` : ''}
            {order.client_order_number ? ` · № клиента ${order.client_order_number}` : ''}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[26px] font-bold font-mono text-[#111110]">{fmt(total)}</p>
          {discount > 0 && <p className="text-[12px] text-emerald-600">скидка {discount}% от {fmt(Number(order.total_sale_inc_vat) || 0)}</p>}
          {owner && (Number(order.margin_percent) || 0) > 0 && (
            <p className={`text-[12px] font-semibold ${Number(order.margin_percent) < 25 ? 'text-red-500' : Number(order.margin_percent) < 35 ? 'text-amber-600' : 'text-emerald-600'}`}>
              маржа {Number(order.margin_percent)}%
            </p>
          )}
        </div>
      </div>

      {(approval?.needed || claim?.status === 'open') && (
        <div className="flex flex-wrap gap-2">
          {approval?.needed && (
            <span className="text-[12px] font-semibold px-3 py-1.5 rounded-xl bg-amber-50 text-amber-700 border border-amber-200">
              ⚠️ Цена ждёт согласования владельца · маржа {approval.margin}%
            </span>
          )}
          {claim?.status === 'open' && (
            <span className="text-[12px] font-semibold px-3 py-1.5 rounded-xl bg-red-50 text-red-600 border border-red-200">
              ⚠️ Открыта рекламация · {claim.reason}{(claim.cost ?? 0) > 0 ? ` · переделка ${fmt(Number(claim.cost))}` : ''}
            </span>
          )}
        </div>
      )}

      <Section title="Документы">
        <div className="flex flex-wrap gap-2 text-[12px]">
          {[
            { href: `/b2b-quotes/${dealId}/kp`, label: '📄 КП' },
            { href: `/api/quotes/${dealId}/pdf`, label: '⬇ КП в PDF' },
            { href: `/b2b-quotes/${dealId}/invoice`, label: '🧾 Счёт' },
            { href: `/b2b-quotes/${dealId}/upd`, label: '📑 УПД' },
            { href: `/b2b-orders/${dealId}/packing`, label: '📦 Упаковочный лист' },
          ].map(l => (
            <a key={l.href} href={l.href} target="_blank" rel="noreferrer"
              className="px-3 py-1.5 rounded-xl border border-[#e4e4e0] text-[#6b6b66] hover:border-[#111110] hover:text-[#111110] transition-colors">
              {l.label}
            </a>
          ))}
        </div>
      </Section>

      <div className="grid gap-3 sm:grid-cols-2">
        <Section title="Деньги">
          <dl className="text-[12px] space-y-1">
            <div className="flex justify-between"><dt className="text-[#9a9a95]">К оплате</dt><dd className="font-mono font-semibold">{fmt(total)}</dd></div>
            <div className="flex justify-between"><dt className="text-[#9a9a95]">Оплачено</dt><dd className="font-mono">{rem.hasPayment ? fmt(paid) : '—'}</dd></div>
            <div className="flex justify-between">
              <dt className="text-[#9a9a95]">{rem.hasPayment ? 'Остаток' : 'Оплата'}</dt>
              <dd className={`font-mono font-semibold ${!rem.hasPayment ? 'text-[#9a9a95]' : rem.outstanding ? 'text-red-600' : 'text-emerald-600'}`}>
                {rem.hasPayment ? (rem.outstanding ? fmt(rem.remainder) : 'закрыт') : 'не заведена'}
              </dd>
            </div>
            {owner && (
              <div className="flex justify-between"><dt className="text-[#9a9a95]">Себестоимость</dt><dd className="font-mono text-[#6b6b66]">{fmt(Number(order.total_cost_net) || 0)}</dd></div>
            )}
          </dl>
        </Section>

        <Section title="Производство и отгрузка">
          <dl className="text-[12px] space-y-1">
            <div className="flex justify-between">
              <dt className="text-[#9a9a95]">Срок</dt>
              <dd className="font-mono">{dt(deadlineFor(notes, order.created_at as string).toISOString())}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[#9a9a95]">Отгрузка</dt>
              <dd>{notes.shipped_date ? `отгружено ${dt(notes.shipped_date as string)}` : delivery?.method === 'delivery' ? 'доставка' : delivery?.method === 'pickup' ? 'самовывоз' : 'не назначена'}</dd>
            </div>
            {delivery?.address && (
              <div className="flex justify-between gap-4"><dt className="text-[#9a9a95]">Адрес</dt><dd className="text-right">{delivery.address}</dd></div>
            )}
            <div className="flex justify-between">
              <dt className="text-[#9a9a95]">Объём</dt>
              <dd className="font-mono">{(Number(order.total_area) || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} м² · {(Number(order.total_weight) || 0).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} кг</dd>
            </div>
          </dl>
        </Section>
      </div>

      {timeline.length > 0 && (
        <Section title="Клиент">
          <div className="flex flex-wrap gap-1.5">
            {timeline.map((e, i) => (
              <span key={i} title={e.at ? new Date(e.at).toLocaleString('ru-RU') : undefined}
                className={`text-[11px] px-2 py-0.5 rounded-full border whitespace-nowrap ${
                  e.tone === 'good' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : e.tone === 'warn' ? 'bg-amber-50 text-amber-700 border-amber-200'
                  : 'bg-white text-[#6b6b66] border-[#e4e4e0]'}`}>
                {e.icon} {e.text}
              </span>
            ))}
          </div>
        </Section>
      )}

      <Section title={`Позиции · ${items.length}`}>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-widest text-[#9a9a95] border-b border-[#f0f0ec]">
                <th className="py-1.5">Изделие</th>
                <th className="py-1.5 text-right w-24">Размер</th>
                <th className="py-1.5 text-right w-12">Кол.</th>
                <th className="py-1.5 text-right w-24">Итого</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i} className="border-b border-[#f8f8f7]">
                  <td className="py-1.5">
                    {it.materialName ?? 'Стекло'}{it.thickness ? `, ${it.thickness} мм` : ''}{it.hasTempering ? ', закалка' : ''}
                    {it.manualTotal != null && <span className="ml-1 text-[10px] text-amber-600">✏️</span>}
                    {it.clientPriced && <span className="ml-1 text-[10px] text-blue-600" title="Цена из прайса клиента">₽</span>}
                    {it.comment && <span className="block text-[10px] text-[#9a9a95] italic">{it.comment}</span>}
                  </td>
                  <td className="py-1.5 text-right font-mono">{it.width}×{it.height}</td>
                  <td className="py-1.5 text-right font-mono">{it.quantity}</td>
                  <td className="py-1.5 text-right font-mono">{fmt(effectiveItemTotal(it, discount))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {history.length > 0 && (
        <Section title="История цены">
          <ul className="text-[11px] space-y-0.5 text-[#6b6b66]">
            {history.slice(-8).reverse().map((h, i) => (
              <li key={i}>
                {dt(h.changed_at)} · {h.reset ? 'возврат к прайсу' : `${fmt(Number(h.old_total) || 0)} → ${fmt(Number(h.new_total) || 0)}`}
                {h.changed_by ? ` · ${h.changed_by}` : ''}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  )
}
