import Link from 'next/link'
import { redirect } from 'next/navigation'
import { canAccessRoute, getRole } from '@/lib/getRole'
import { createServiceClient } from '@/lib/supabase-service'
import { loadOrderFundSettings } from '@/lib/pricing/orderFundsStore'
import { orderFunds, RATE_LABELS, ZONE_LABELS, type ItemFunds, type OrderFundRates, type OrderFundsResult } from '@/lib/pricing/orderFunds'
import { retailCalcItems } from '@/lib/pricing/retailCalcItems'
import { contributionColor } from '@/lib/unitEconomics'

// Розничные расчёты по фондам (Э6). Цена — фактическая из расчёта, здесь она только раскладывается:
// закупка, сдельная, налог, продажи → «Остаётся с заказа». Только /cfo: менеджеру фонды не показываются.

export const dynamic = 'force-dynamic'

const PATH = '/cfo/order-economics/retail'
const COLOR = { red: 'text-red-600', amber: 'text-amber-600', green: 'text-emerald-600' } as const
const TYPE_LABEL: Record<string, string> = { build: '«Расчёт»', quick: '«Быстрый»' }
const DEFAULT_ZONE = 'moscow' as const

const rub = (n: number) => Math.round(n).toLocaleString('ru-RU')
const pct = (n: number) => n.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const dateRu = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric' })

type CalcRow = {
  id: number
  created_at: string
  product_type: string
  final_price: number | string | null
  input_data: unknown
  cost_breakdown: unknown
  financial_breakdown: unknown
}

type Order = { row: CalcRow; funds: OrderFundsResult; partnerSource: string | null }

export default async function RetailOrderFundsPage() {
  // Слой /cfo уже гейтит, но ниже service-role читает расчёты в обход RLS — проверяем здесь же.
  const role = await getRole()
  if (!canAccessRoute(role, PATH)) redirect('/')

  const settings = await loadOrderFundSettings()
  const svc = createServiceClient()
  const { data, error } = await svc.from('calculations')
    .select('id, created_at, product_type, final_price, input_data, cost_breakdown, financial_breakdown')
    .in('product_type', ['build', 'quick'])
    .is('archived_at', null)
    .order('created_at', { ascending: false })
    .limit(60)

  const orders: Order[] = ((data ?? []) as CalcRow[]).map(row => {
    const { items, partner, partnerSource } = retailCalcItems(row)
    return {
      row, partnerSource,
      funds: orderFunds(items, settings.rates, { deliveryZone: DEFAULT_ZONE, partner, targetPct: settings.targetPct }),
    }
  })
  const withShowers = orders.filter(o => o.funds.items.some(i => i.kind === 'shower'))
  const withoutShowers = orders.filter(o => !o.funds.items.some(i => i.kind === 'shower'))
  const showers = withShowers.flatMap(o => o.funds.items.filter(i => i.kind === 'shower'))
  const complete = showers.filter(s => s.remains != null).length
  const noCost = showers.filter(s => s.missing.includes('себестоимость не сохранена')).length
  const target = settings.targetPct

  return (
    <div className="bg-[#f5f5f3] min-h-screen">
      <div className="max-w-[1080px] mx-auto px-4 py-4 space-y-4">

        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-sm font-semibold text-[#111110]">Фонды розничного заказа — душевые</h1>
            <p className="text-[10px] text-[#9a9a95] mt-0.5">
              Сохранённые расчёты «Расчёта» и «Быстрого» при фактической цене · цены здесь не меняются
            </p>
          </div>
          <div className="flex gap-2 items-center">
            <Link href="/cfo/order-economics" className="px-3 py-1.5 text-xs border border-[#e4e4e0] rounded-lg text-[#6b6b66] hover:bg-white">B2B-заказы →</Link>
            <Link href="/cfo" className="px-3 py-1.5 text-xs bg-[#111110] text-white rounded-lg font-medium hover:bg-[#2a2a28]">CFO →</Link>
          </div>
        </div>

        <RatesCard rates={settings.rates} avgVariablePct={settings.avgVariablePct} targetPct={target} error={settings.error} />

        {error ? (
          <div className="bg-white rounded-lg border border-red-200 px-4 py-4 text-xs text-red-700">
            Расчёты не загрузились: {error.message}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Kpi label="Расчётов с душевыми" value={String(withShowers.length)} sub={`из ${orders.length} последних розничных`} />
              <Kpi label="Душевых" value={String(showers.length)} sub="каждая раскладывается отдельно" />
              <Kpi label="Разложено до остатка" value={String(complete)} sub="есть себестоимость и все ставки" />
              <Kpi label="Себестоимость не сохранена" value={String(noCost)} sub="фонд закупки не посчитать" warn={noCost > 0} />
            </div>

            {withShowers.length === 0 && (
              <div className="bg-white rounded-lg border border-[#e4e4e0] px-4 py-8 text-center text-xs text-[#9a9a95]">
                В сохранённых расчётах нет душевых.
              </div>
            )}

            {withShowers.map(o => <OrderCard key={o.row.id} order={o} targetPct={target} />)}

            {withoutShowers.length > 0 && (
              <div className="bg-white rounded-lg border border-[#e4e4e0] px-4 py-3">
                <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1.5">Расчёты без душевых — по фондам не раскладываются</p>
                <div className="space-y-1">
                  {withoutShowers.map(o => (
                    <p key={o.row.id} className="text-xs text-[#6b6b66]">
                      № {o.row.id} · {TYPE_LABEL[o.row.product_type] ?? o.row.product_type} · {dateRu(o.row.created_at)} · {rub(Number(o.row.final_price) || 0)} ₽
                      <span className="text-[#9a9a95]"> — {o.funds.items.map(i => i.label).join('; ') || 'пустая корзина'}</span>
                    </p>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <p className="text-[10px] text-[#9a9a95] leading-relaxed">
          Остаётся с заказа = чек − закупка материалов − сдельная оплата − налог − продажи и реализация; из этой суммы платятся оклады, аренда и прибыль.
          % — доля чека этой душевой, факт по сохранённому расчёту. Чек заказа делится на изделия в доле их итога (скидки и надбавка дизайнера — на весь чек), доставка — поровну на изделия заказа.
          Зона доставки в расчётах не сохраняется — считаем по ставке «{ZONE_LABELS[DEFAULT_ZONE]}». Число стёкол — по полотнам модели или по секциям монтажа.
          Цена для цели — справочно: (материалы + сдельная) ÷ (1 − налог − продажи − цель); менеджеру и клиенту она не показывается.
        </p>
      </div>
    </div>
  )
}

function RatesCard({ rates, avgVariablePct, targetPct, error }: { rates: OrderFundRates; avgVariablePct: number | null; targetPct: number | null; error: string | null }) {
  const money = (v: number | null) => v == null ? <span className="text-amber-700">нет ставки</span> : <>{rub(v)} ₽</>
  const share = (v: number | null) => v == null ? <span className="text-amber-700">нет ставки</span> : <>{pct(v)}%</>
  const rows: [string, React.ReactNode][] = [
    [RATE_LABELS.drawingPerShower, money(rates.drawingPerShower)],
    [RATE_LABELS.measurePerShower, money(rates.measurePerShower)],
    [RATE_LABELS.installPerGlass, money(rates.installPerGlass)],
    [RATE_LABELS.deliveryMoscow, money(rates.deliveryPerOrder.moscow)],
    [RATE_LABELS.deliveryRegion, money(rates.deliveryPerOrder.region)],
    [RATE_LABELS.taxPct, share(rates.taxPct)],
    [RATE_LABELS.managerPct, share(rates.managerPct)],
    [RATE_LABELS.realizationPct, share(rates.realizationPct)],
    [RATE_LABELS.partnerReservePct, share(rates.partnerReservePct)],
    [RATE_LABELS.partnerKnownPct, share(rates.partnerKnownPct)],
    [RATE_LABELS.otherPct, share(rates.otherPct)],
  ]
  return (
    <div className="bg-white rounded-lg border border-[#e4e4e0] p-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2 mb-2">
        <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Ставки фондов</p>
        <p className="text-[10px] text-[#9a9a95]">
          {rates.asOf ? <>ставки на {dateRu(rates.asOf)}</> : <span className="text-amber-700">дата ставок не записана</span>}
          {' · '}цель: остаётся {targetPct != null ? <b className="text-[#111110]">{pct(targetPct)}%</b> : <span className="text-amber-700">не задана</span>} чека
          {avgVariablePct != null && <> = 100 − средние переменные {pct(avgVariablePct)}% плана CFO</>}
        </p>
      </div>
      {error && <p className="text-[11px] text-red-700 mb-2">Настройки CFO не прочитались: {error}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-1">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3 text-xs border-b border-[#f5f5f3] py-1">
            <span className="text-[#6b6b66]">{label}</span>
            <span className="font-mono text-[#111110] whitespace-nowrap">{value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function OrderCard({ order, targetPct }: { order: Order; targetPct: number | null }) {
  const { row, funds, partnerSource } = order
  const others = funds.items.filter(i => i.kind === 'other')
  return (
    <div className="bg-white rounded-lg border border-[#e4e4e0] overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[#e4e4e0] flex items-baseline justify-between flex-wrap gap-2">
        <p className="text-xs font-semibold text-[#111110]">
          № {row.id} · {TYPE_LABEL[row.product_type] ?? row.product_type} · {dateRu(row.created_at)}
          <span className="font-mono"> · чек {rub(Number(row.final_price) || 0)} ₽</span>
        </p>
        <p className="text-[10px] text-[#9a9a95]">
          {funds.items.length} изд. · партнёр: {partnerSource ?? `не указан — резерв ${funds.partnerPct != null ? pct(funds.partnerPct) + '%' : 'без ставки'}`}
        </p>
      </div>
      <div className="divide-y divide-[#f5f5f3]">
        {funds.items.filter(i => i.kind === 'shower').map((it, i) => <ShowerFunds key={i} item={it} targetPct={targetPct} />)}
        {others.map((it, i) => (
          <p key={`o${i}`} className="px-4 py-2 text-[11px] text-[#9a9a95]">
            {it.label} · {rub(it.price)} ₽ в чеке — не душевая, по ставкам душевой не раскладывается
          </p>
        ))}
      </div>
    </div>
  )
}

function ShowerFunds({ item, targetPct }: { item: ItemFunds; targetPct: number | null }) {
  const noCost = item.missing.includes('себестоимость не сохранена')
  const otherMissing = item.missing.filter(m => m !== 'себестоимость не сохранена')
  return (
    <div className="px-4 py-3 space-y-2">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <p className="text-xs text-[#111110] font-medium">
          {item.label}
          <span className="font-mono text-[#6b6b66] font-normal"> · {rub(item.price)} ₽ в чеке</span>
        </p>
        <div className="flex items-baseline gap-4 text-xs">
          {item.remains != null && item.remainsPct != null ? (
            <span className={`font-mono font-bold ${COLOR[contributionColor(item.remainsPct)]}`}>
              Остаётся с заказа {rub(item.remains)} ₽ · {pct(item.remainsPct)}%
            </span>
          ) : (
            <span className="text-amber-700">Остаётся с заказа — не посчитать</span>
          )}
          <span className="text-[#9a9a95]">
            цена для цели {targetPct != null ? `${pct(targetPct)}%` : '—'}:{' '}
            <span className="font-mono text-[#6b6b66]">{item.priceForTarget != null ? `${rub(item.priceForTarget)} ₽` : '—'}</span>
            <span className="text-[10px]"> (справочно)</span>
          </span>
        </div>
      </div>
      {(noCost || otherMissing.length > 0) && (
        <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1">
          {noCost && 'Себестоимость не сохранена — в расчёте нет закупки стекла и фурнитуры. '}
          {otherMissing.length > 0 && `Не хватает: ${otherMissing.join(', ')}.`}
        </p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        {item.funds.map(f => (
          <div key={f.key} className="rounded-md border border-[#e4e4e0] px-3 py-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] font-semibold text-[#111110]">{f.label}</span>
              <span className="text-xs font-mono font-semibold text-[#111110] whitespace-nowrap">
                {f.amount != null ? `${rub(f.amount)} ₽` : <span className="text-amber-700">—</span>}
                {f.pct != null && <span className="text-[#9a9a95] font-normal"> · {pct(f.pct)}%</span>}
              </span>
            </div>
            <div className="mt-1 space-y-0.5">
              {f.lines.map(l => (
                <div key={l.key} className="flex items-baseline justify-between gap-2 text-[11px]">
                  <span className="text-[#6b6b66]">{l.label}{l.note && <span className="text-[#9a9a95]"> · {l.note}</span>}</span>
                  <span className="font-mono text-[#6b6b66] whitespace-nowrap">{l.amount != null ? `${rub(l.amount)} ₽` : <span className="text-amber-700">нет</span>}</span>
                </div>
              ))}
            </div>
            {f.key === 'materials' && (
              <p className="mt-1 text-[10px] text-[#9a9a95]">{item.materialsSource ?? 'источник: себестоимость не сохранена'}</p>
            )}
            {f.key === 'piecework' && item.glassCountSource && (
              <p className="mt-1 text-[10px] text-[#9a9a95]">стёкол — {item.glassCountSource}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function Kpi({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className="bg-white rounded-lg px-3 py-3 border border-[#e4e4e0]">
      <p className="text-[10px] text-[#9a9a95] font-medium">{label}</p>
      <p className={`text-lg font-bold font-mono mt-0.5 ${warn ? 'text-amber-700' : 'text-[#111110]'}`}>{value}</p>
      {sub && <p className="text-[10px] text-[#9a9a95] mt-0.5">{sub}</p>}
    </div>
  )
}
