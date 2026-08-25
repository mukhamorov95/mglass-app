import { createClient } from '@/lib/supabase-server'
import Link from 'next/link'
import { getRole } from '@/lib/getRole'
import { redirect, notFound } from 'next/navigation'
import { ORDER_STATUS_LABELS } from '@/lib/types'
import type { OrderStatus } from '@/lib/types'
import { phoneKey, formatPhone, extractPhone } from '@/lib/b2c/phoneKey'
import NewCalcButtons from './NewCalcButtons'

// М1: единая карточка сделки B2C. Раньше здесь были только заказы и расчёты, и
// сопоставлялись они точным равенством строки телефона — «8(915)129-12-77» и
// «+79151291277» считались разными людьми. Теперь ключ сделки — последние 10 цифр
// (lib/b2c/phoneKey), и в карточке собран весь путь: заявка → замер → расчёт →
// договор → заказ → монтаж. Ничего не досочиняем: нет записи — нет строки.

function fmt(n: number) { return Math.round(n).toLocaleString('ru-RU') + ' ₽' }
const dt = (s: string | null | undefined) => s ? new Date(s).toLocaleDateString('ru-RU') : '—'

const PRODUCT_LABELS: Record<string, { label: string; emoji: string }> = {
  mirror:          { label: 'Зеркало', emoji: '🪞' },
  loft:            { label: 'Лофт',    emoji: '🏗️' },
  shower:          { label: 'Душевая', emoji: '🚿' },
  shower_standard: { label: 'Душевая', emoji: '🚿' },
  shower_budget:   { label: 'Душевая', emoji: '🚿' },
}

const CALC_STATUS: Record<string, string> = {
  draft: 'Черновик', sent: 'Отправлено', thinking: 'Думает',
  approved: 'Согласовано', launched: 'Запущено', rejected: 'Отказ',
}

const STATUS_STYLE: Record<OrderStatus, string> = {
  draft:            'bg-gray-100 text-gray-600',
  pending_approval: 'bg-red-100 text-red-700',
  approved:         'bg-amber-100 text-amber-700',
  in_work:          'bg-blue-100 text-blue-700',
  completed:        'bg-emerald-100 text-emerald-700',
  cancelled:        'bg-gray-100 text-gray-400',
}

type Row = Record<string, unknown>
const s = (v: unknown) => v == null ? null : String(v)
const n = (v: unknown) => Number(v) || 0

function Card({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-[#e4e4e0] overflow-hidden mb-4">
      <div className="px-5 py-3 bg-[#f8f8f7] border-b border-[#e4e4e0]">
        <p className="text-[12px] font-bold text-[#9a9a95] uppercase tracking-wider">
          {title}{count != null && ` (${count})`}
        </p>
      </div>
      {children}
    </div>
  )
}

export default async function ClientDetailPage({ params }: { params: Promise<{ phone: string }> }) {
  const supabase = await createClient()
  const role = await getRole()
  if (!role) redirect('/login')

  const { data: { user } } = await supabase.auth.getUser()
  const { phone: encodedKey } = await params
  const key = decodeURIComponent(encodedKey)
  const pk = phoneKey(key)

  const { data: profile } = await supabase.from('users').select('can_view_all_clients').eq('id', user!.id).maybeSingle()
  const seeAllClients = role === 'admin' || role === 'ceo' || profile?.can_view_all_clients === true

  // Телефоны в базе записаны как попало, поэтому сравниваем не в SQL, а по
  // нормализованному ключу. Таблицы B2C маленькие — выбираем свежий срез и
  // фильтруем в коде; иначе половина сделки просто не находилась бы.
  const matches = (row: Row, ...fields: string[]) =>
    pk == null
      ? fields.some(f => s(row[f]) === key) || s(row.client_name) === key
      : fields.some(f => phoneKey(row[f]) === pk)

  let ordersQuery = supabase.from('orders').select('*').order('created_at', { ascending: false }).limit(500)
  if (!seeAllClients) ordersQuery = ordersQuery.eq('manager_id', user!.id)

  const [{ data: ordersRaw }, { data: calcsRaw }, { data: leadsRaw }, { data: contractsRaw }, { data: measuresRaw }, { data: installsRaw }] =
    await Promise.all([
      ordersQuery,
      supabase.from('calculations')
        .select('id, product_type, final_price, margin, status, created_at, client_name, client_phone')
        .order('created_at', { ascending: false }).limit(500),
      supabase.from('crm_leads')
        .select('id, name, phone, source, product, stage, status, created_at, address, note, manager, est_amount')
        .order('created_at', { ascending: false }).limit(1000),
      supabase.from('contracts')
        .select('id, number, date, customer, total, status, product_kind, manager_name, created_at')
        .order('created_at', { ascending: false }).limit(500),
      supabase.from('measure_requests')
        .select('id, deal_number, client_name, phone, address, scope, scheduled_at, status, measurer_name, created_at')
        .order('created_at', { ascending: false }).limit(500),
      supabase.from('installations')
        .select('id, order_no, title, client_name, phone, address, scheduled_date, status, amount, created_at')
        .order('created_at', { ascending: false }).limit(500),
    ])

  const orders    = ((ordersRaw ?? []) as Row[]).filter(r => matches(r, 'client_phone'))
  const calcs     = ((calcsRaw ?? []) as Row[]).filter(r => matches(r, 'client_phone'))
  const leads     = ((leadsRaw ?? []) as Row[]).filter(r => matches(r, 'phone'))
  const measures  = ((measuresRaw ?? []) as Row[]).filter(r => matches(r, 'phone'))
  const installs  = ((installsRaw ?? []) as Row[]).filter(r => matches(r, 'phone'))
  const contracts = ((contractsRaw ?? []) as Row[]).filter(r =>
    pk != null && extractPhone(r.customer) === pk)

  if (!orders.length && !calcs.length && !leads.length && !contracts.length && !measures.length && !installs.length) {
    notFound()
  }

  const clientName =
    s(orders[0]?.client_name) ?? s(leads[0]?.name) ?? s(calcs[0]?.client_name) ??
    s(measures[0]?.client_name) ?? s(installs[0]?.client_name) ?? key
  const clientPhone =
    s(orders[0]?.client_phone) ?? s(leads[0]?.phone) ?? s(calcs[0]?.client_phone) ??
    s(measures[0]?.phone) ?? s(installs[0]?.phone) ?? (pk ? pk : null)
  const address =
    s(orders[0]?.object_address) ?? s(leads[0]?.address) ?? s(measures[0]?.address) ?? s(installs[0]?.address)

  const liveOrders = orders.filter(o => o.status !== 'cancelled')
  const totalRevenue = liveOrders.reduce((sum, o) => sum + n(o.total_sale_price), 0)
  const contractsSum = contracts.reduce((sum, c) => sum + n(c.total), 0)
  const activeOrders = orders.filter(o => ['in_work', 'approved', 'pending_approval'].includes(String(o.status)))

  // Лента сделки: всё, что реально произошло, в хронологии.
  const timeline: { at: string; icon: string; text: string }[] = [
    ...leads.map(l => ({ at: String(l.created_at), icon: '📥', text: `Заявка${l.source ? ` · ${l.source}` : ''}${l.product ? ` · ${l.product}` : ''}` })),
    ...measures.map(m => ({ at: String(m.scheduled_at ?? m.created_at), icon: '📐', text: `Замер · ${m.status ?? ''}${m.measurer_name ? ` · ${m.measurer_name}` : ''}` })),
    ...calcs.map(c => ({ at: String(c.created_at), icon: '🧮', text: `Расчёт ${PRODUCT_LABELS[String(c.product_type)]?.label ?? c.product_type} · ${fmt(n(c.final_price))}` })),
    ...contracts.map(c => ({ at: String(c.date ?? c.created_at), icon: '📃', text: `Договор № ${c.number} · ${fmt(n(c.total))}` })),
    ...orders.map(o => ({ at: String(o.created_at), icon: '📦', text: `Заказ ${o.number} · ${fmt(n(o.total_sale_price))}` })),
    ...installs.map(i => ({ at: String(i.scheduled_date ?? i.created_at), icon: '🔧', text: `Монтаж${i.status ? ` · ${i.status}` : ''}` })),
  ].filter(e => e.at && e.at !== 'null').sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())

  return (
    <div className="bg-[#f5f5f3] min-h-screen">
      <div className="max-w-[900px] mx-auto px-4 py-6">

        <div className="flex items-center gap-2 text-[13px] mb-5">
          <Link href="/clients" className="text-[#9a9a95] hover:text-[#6b6b66]">← Клиенты</Link>
          <span className="text-[#d4d4d0]">/</span>
          <span className="font-semibold text-[#111110]">{clientName}</span>
        </div>

        <div className="bg-white rounded-xl border border-[#e4e4e0] p-6 mb-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-[22px] font-bold text-[#111110]">{clientName}</h1>
              {clientPhone && (
                <a href={`tel:${clientPhone}`} className="text-[15px] text-blue-600 mt-1 block">{formatPhone(clientPhone)}</a>
              )}
              {address && <p className="text-[13px] text-[#9a9a95] mt-0.5">{address}</p>}
            </div>
            <div className="text-right">
              <p className="text-[22px] font-bold text-[#111110] font-mono">{fmt(totalRevenue || contractsSum)}</p>
              <p className="text-[12px] text-[#9a9a95]">{totalRevenue > 0 ? 'выручка по заказам' : 'сумма договоров'}</p>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-[#f0f0ec] grid grid-cols-3 sm:grid-cols-6 gap-3 text-center">
            {[
              { v: leads.length,     l: 'заявок' },
              { v: measures.length,  l: 'замеров' },
              { v: calcs.length,     l: 'расчётов' },
              { v: contracts.length, l: 'договоров' },
              { v: orders.length,    l: 'заказов' },
              { v: installs.length,  l: 'монтажей' },
            ].map(x => (
              <div key={x.l}>
                <p className="text-[20px] font-bold text-[#111110]">{x.v}</p>
                <p className="text-[11px] text-[#9a9a95]">{x.l}</p>
              </div>
            ))}
          </div>
          {activeOrders.length > 0 && (
            <p className="text-[12px] text-blue-700 mt-3">В работе сейчас: {activeOrders.length}</p>
          )}

          {/* М2: новый расчёт с уже подставленным клиентом */}
          <div className="mt-4 pt-4 border-t border-[#f0f0ec]">
            <p className="text-[11px] text-[#9a9a95] mb-2">Новый расчёт для клиента</p>
            <NewCalcButtons clientName={clientName} clientPhone={clientPhone} />
          </div>
        </div>

        {timeline.length > 0 && (
          <Card title="Ход сделки">
            <div className="divide-y divide-[#f0f0ec]">
              {timeline.map((e, i) => (
                <div key={i} className="px-5 py-2 flex items-center gap-3 text-[13px]">
                  <span className="w-16 text-[11px] text-[#9a9a95] font-mono">{dt(e.at)}</span>
                  <span>{e.icon}</span>
                  <span className="text-[#111110]">{e.text}</span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {leads.length > 0 && (
          <Card title="Заявки" count={leads.length}>
            <div className="divide-y divide-[#f0f0ec]">
              {leads.map(l => (
                <div key={String(l.id)} className="px-5 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[13px] text-[#111110]">
                      {s(l.product) ?? 'без продукта'}{l.source ? ` · ${l.source}` : ''}
                    </p>
                    <p className="text-[11px] text-[#9a9a95]">
                      {dt(s(l.created_at))}{l.stage ? ` · ${l.stage}` : ''}{l.manager ? ` · ${l.manager}` : ''}
                    </p>
                    {l.note != null && String(l.note).trim() !== '' && (
                      <p className="text-[11px] text-[#6b6b66] italic mt-0.5 truncate">{String(l.note)}</p>
                    )}
                  </div>
                  {n(l.est_amount) > 0 && (
                    <span className="text-[13px] font-mono text-[#6b6b66] whitespace-nowrap">≈ {fmt(n(l.est_amount))}</span>
                  )}
                </div>
              ))}
            </div>
          </Card>
        )}

        {measures.length > 0 && (
          <Card title="Замеры" count={measures.length}>
            <div className="divide-y divide-[#f0f0ec]">
              {measures.map(m => (
                <Link key={String(m.id)} href="/measure-requests"
                  className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-[#fafaf9] transition-colors">
                  <div className="min-w-0">
                    <p className="text-[13px] text-[#111110]">{s(m.scope) ?? 'замер'}</p>
                    <p className="text-[11px] text-[#9a9a95]">
                      {m.scheduled_at ? `на ${dt(s(m.scheduled_at))}` : `создан ${dt(s(m.created_at))}`}
                      {m.measurer_name ? ` · ${m.measurer_name}` : ''}
                      {m.status ? ` · ${m.status}` : ''}
                    </p>
                  </div>
                  {m.address != null && <span className="text-[11px] text-[#9a9a95] truncate max-w-[240px]">{String(m.address)}</span>}
                </Link>
              ))}
            </div>
          </Card>
        )}

        {calcs.length > 0 && (
          <Card title="Расчёты" count={calcs.length}>
            <div className="divide-y divide-[#f0f0ec]">
              {calcs.map(c => {
                const prod = PRODUCT_LABELS[String(c.product_type)] ?? { label: String(c.product_type), emoji: '📋' }
                return (
                  <Link key={String(c.id)} href={`/calculations/${c.id}`}
                    className="flex items-center justify-between px-5 py-3.5 hover:bg-[#fafaf9] transition-colors">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[13px]">{prod.emoji}</span>
                        <span className="text-[13px] font-semibold text-[#111110]">{prod.label}</span>
                        <span className="text-[11px] text-[#9a9a95] bg-[#f5f5f3] px-1.5 py-0.5 rounded">
                          {CALC_STATUS[String(c.status)] ?? String(c.status)}
                        </span>
                      </div>
                      <p className="text-[11px] text-[#9a9a95] mt-0.5">{dt(s(c.created_at))}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[14px] font-bold font-mono text-[#111110]">{fmt(n(c.final_price))}</p>
                      <p className="text-[11px] text-[#9a9a95]">Маржа {n(c.margin).toFixed(1)}%</p>
                    </div>
                  </Link>
                )
              })}
            </div>
          </Card>
        )}

        {contracts.length > 0 && (
          <Card title="Договоры" count={contracts.length}>
            <div className="divide-y divide-[#f0f0ec]">
              {contracts.map(c => (
                <Link key={String(c.id)} href={`/contracts/${c.id}/print`} target="_blank"
                  className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-[#fafaf9] transition-colors">
                  <div>
                    <p className="text-[13px] font-semibold text-[#111110]">№ {s(c.number)}</p>
                    <p className="text-[11px] text-[#9a9a95]">
                      {dt(s(c.date) ?? s(c.created_at))}{c.product_kind ? ` · ${c.product_kind}` : ''}
                      {c.manager_name ? ` · ${c.manager_name}` : ''}{c.status ? ` · ${c.status}` : ''}
                    </p>
                  </div>
                  <span className="text-[14px] font-bold font-mono text-[#111110] whitespace-nowrap">{fmt(n(c.total))}</span>
                </Link>
              ))}
            </div>
          </Card>
        )}

        <Card title="Заказы" count={orders.length}>
          {orders.length === 0 ? (
            <p className="px-5 py-4 text-[13px] text-[#9a9a95]">Нет заказов</p>
          ) : (
            <div className="divide-y divide-[#f0f0ec]">
              {orders.map(o => (
                <Link key={String(o.id)} href={`/orders/${o.id}`}
                  className="flex items-center justify-between px-5 py-3.5 hover:bg-[#fafaf9] transition-colors">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-bold font-mono text-[#111110]">{s(o.number)}</span>
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${STATUS_STYLE[o.status as OrderStatus]}`}>
                        {ORDER_STATUS_LABELS[o.status as OrderStatus]}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#9a9a95] mt-0.5">
                      {dt(s(o.created_at))}{o.order_type ? ` · ${o.order_type}` : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[14px] font-bold font-mono text-[#111110]">{fmt(n(o.total_sale_price))}</p>
                    <p className="text-[11px] text-[#9a9a95]">Маржа {n(o.margin_percent).toFixed(1)}%</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Card>

        {installs.length > 0 && (
          <Card title="Монтажи" count={installs.length}>
            <div className="divide-y divide-[#f0f0ec]">
              {installs.map(i => (
                <Link key={String(i.id)} href="/installations"
                  className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-[#fafaf9] transition-colors">
                  <div className="min-w-0">
                    <p className="text-[13px] text-[#111110]">{s(i.title) ?? `заказ ${s(i.order_no) ?? ''}`}</p>
                    <p className="text-[11px] text-[#9a9a95]">
                      {i.scheduled_date ? dt(s(i.scheduled_date)) : dt(s(i.created_at))}{i.status ? ` · ${i.status}` : ''}
                    </p>
                  </div>
                  {n(i.amount) > 0 && <span className="text-[13px] font-mono text-[#6b6b66] whitespace-nowrap">{fmt(n(i.amount))}</span>}
                </Link>
              ))}
            </div>
          </Card>
        )}

        <Link href="/clients" className="text-[13px] text-[#9a9a95] hover:text-[#6b6b66]">← Все клиенты</Link>
      </div>
    </div>
  )
}
