import Link from 'next/link'
import { redirect } from 'next/navigation'
import { canAccessRoute, getRole } from '@/lib/getRole'
import { createServiceClient } from '@/lib/supabase-service'
import { buildProductReport, launchMonths, marginTone, type Agg, type ReportOrder } from '@/lib/cfo/productReport'
import ExportXlsx, { type ExportRow } from './ExportXlsx'

// Отчёт по изделиям производства (B2B) — блок 2 docs/ERP_PROPOSAL_TAKEAWAYS.md.
// Только чтение. Финансовая деталь — только /cfo.

export const dynamic = 'force-dynamic'

const PATH = '/cfo/products'
const TONE = { red: 'text-red-600', amber: 'text-amber-600', green: 'text-emerald-700', none: 'text-[#9a9a95]' } as const
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
const RETAIL_TYPE_GAP_FROM = '2025-06-01'

const rub = (n: number) => Math.round(n).toLocaleString('ru-RU')
const pct1 = (n: number) => n.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const m2 = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 1 })
const monthLabel = (ym: string) => { const [y, m] = ym.split('-').map(Number); return `${MONTHS[m - 1]} ${y}` }
const perM2 = (a: Agg) => (a.areaM2 > 0 ? rub(a.revenueExVat / a.areaM2) : '—')

function Cells({ a, strong, defects }: { a: Agg; strong?: boolean; defects: boolean }) {
  return (
    <>
      <span className="text-right tabular-nums">{a.orders}</span>
      <span className="text-right tabular-nums">{rub(a.pieces)}</span>
      <span className="text-right tabular-nums">{m2(a.areaM2)}</span>
      <span className={`text-right tabular-nums ${strong ? 'font-semibold' : ''}`}>{rub(a.revenueExVat)}</span>
      <span className="text-right tabular-nums text-[#6b6b66]">{rub(a.costExVat)}</span>
      <span className="text-right tabular-nums">{rub(a.marginRub)}</span>
      <span className={`text-right tabular-nums font-medium ${TONE[marginTone(a.marginPct)]}`}
        title={a.noCostItems ? `${a.noCostItems} поз. без себестоимости — в процент не вошли` : undefined}>
        {a.marginPct == null ? '—' : pct1(a.marginPct) + '%'}{a.noCostItems ? ' ⚠' : ''}
      </span>
      <span className="text-right tabular-nums text-[#6b6b66]">{perM2(a)}</span>
      {defects && <span className="text-right tabular-nums">{a.reworkItems} из {a.lines}</span>}
    </>
  )
}

async function loadOrders(svc: ReturnType<typeof createServiceClient>): Promise<ReportOrder[]> {
  const rows: ReportOrder[] = []
  const page = 500
  for (let from = 0; ; from += page) {
    const { data, error } = await svc.from('b2b_orders')
      .select('id, launched_at, discount_percent, total_after_discount, total_sale_inc_vat, items')
      .is('archived_at', null).not('launched_at', 'is', null)
      .order('id', { ascending: true }).range(from, from + page - 1)
    if (error) throw new Error(`b2b_orders: ${error.message}`)
    rows.push(...((data ?? []) as ReportOrder[]))
    if (!data || data.length < page) break
  }
  return rows
}

export default async function CfoProductsPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  // Слой /cfo уже гейтит, но ниже service-role читает заказы в обход RLS — проверяем здесь же.
  const role = await getRole()
  if (!canAccessRoute(role, PATH)) redirect('/')

  const sp = await searchParams
  const svc = createServiceClient()

  let orders: ReportOrder[] = []
  let loadError: string | null = null
  try { orders = await loadOrders(svc) } catch (e) { loadError = e instanceof Error ? e.message : String(e) }

  const [rework, claims, retailAll, retailNoType] = await Promise.all([
    svc.from('production_rework').select('order_id, item_index'),
    svc.from('partner_claims').select('id', { count: 'exact', head: true }),
    svc.from('crm_sales').select('id', { count: 'exact', head: true }).eq('department', 'mglass').eq('voided', false).gte('sale_date', RETAIL_TYPE_GAP_FROM),
    svc.from('crm_sales').select('id', { count: 'exact', head: true }).eq('department', 'mglass').eq('voided', false).gte('sale_date', RETAIL_TYPE_GAP_FROM).is('product_type', null),
  ])
  const sideErrors = [
    rework.error && `переделки: ${rework.error.message}`,
    claims.error && `рекламации: ${claims.error.message}`,
    (retailAll.error || retailNoType.error) && `продажи розницы: ${(retailAll.error ?? retailNoType.error)!.message}`,
  ].filter(Boolean) as string[]

  const reworkRows = (rework.data ?? []) as { order_id: number; item_index: number | null }[]
  const reworkKeys = new Set(reworkRows.filter(r => r.item_index != null).map(r => `${r.order_id}:${r.item_index}`))
  const hasDefectData = reworkRows.length > 0

  const months = launchMonths(orders)
  const month = sp.m && months.includes(sp.m) ? sp.m : null
  const report = buildProductReport(orders, { month, reworkKeys })
  const t = report.total
  const reconDelta = report.itemsIncVat - report.ordersIncVat

  const exportRows: ExportRow[] = report.categories.flatMap(c => [c, ...c.materials].map((a, i) => ({
    'Категория': c.label,
    'Материал': i === 0 ? 'всего по категории' : a.label,
    'Заказов': a.orders,
    'Штук': a.pieces,
    'м²': a.areaM2,
    'Выручка без НДС, ₽': a.revenueExVat,
    'Себестоимость без НДС, ₽': a.costExVat,
    'Маржа без НДС, ₽': a.marginRub,
    'Маржа, %': a.marginPct,
    'Выручка за м², ₽': a.areaM2 > 0 ? Math.round(a.revenueExVat / a.areaM2) : null,
    'Позиций без себестоимости': a.noCostItems,
    ...(hasDefectData ? { 'Позиций с переделкой': a.reworkItems } : {}),
  })))
  const periodSlug = month ?? 'все-время'

  const grid = hasDefectData
    ? 'grid-cols-[minmax(220px,2fr)_repeat(9,minmax(72px,1fr))]'
    : 'grid-cols-[minmax(220px,2fr)_repeat(8,minmax(72px,1fr))]'

  return (
    <div className="bg-[#f5f5f3] min-h-screen">
      <div className="max-w-[1200px] mx-auto px-4 py-4 space-y-4">

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-sm font-semibold text-[#111110]">CFO Center — Отчёт по изделиям (B2B-производство)</h1>
            <p className="text-xs text-[#9a9a95]">Что продаём и сколько на этом остаётся — по категории и материалу. Все суммы без НДС 22%.</p>
          </div>
          <div className="flex items-center gap-2">
            <ExportXlsx rows={exportRows} fileName={`изделия-B2B-${periodSlug}.xlsx`} />
            <Link href="/cfo" className="px-3 py-1.5 text-xs border border-[#e4e4e0] rounded-lg text-[#6b6b66] hover:bg-white">← CFO</Link>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Link href={PATH} className={`px-2.5 py-1 text-xs rounded-lg border ${!month ? 'bg-[#111110] text-white border-[#111110]' : 'bg-white border-[#e4e4e0] text-[#6b6b66]'}`}>Всё время</Link>
          {months.map(m => (
            <Link key={m} href={`${PATH}?m=${m}`} className={`px-2.5 py-1 text-xs rounded-lg border ${month === m ? 'bg-[#111110] text-white border-[#111110]' : 'bg-white border-[#e4e4e0] text-[#6b6b66]'}`}>{monthLabel(m)}</Link>
          ))}
        </div>

        {loadError && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-700">Заказы не загрузились: {loadError}. Цифры ниже неполные.</div>
        )}
        {sideErrors.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">Не загрузилось: {sideErrors.join('; ')}.</div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { k: 'Заказов запущено', v: String(report.orders), h: month ? monthLabel(month) : 'все месяцы с позициями' },
            { k: 'Выручка без НДС', v: rub(t.revenueExVat) + ' ₽', h: `${rub(t.lines)} позиций, ${m2(t.areaM2)} м²` },
            { k: 'Маржа без НДС', v: rub(t.marginRub) + ' ₽', h: `выручка − себестоимость ${rub(t.costExVat)} ₽` },
            { k: 'Маржа, % от выручки без НДС', v: t.marginPct == null ? '—' : pct1(t.marginPct) + '%', h: 'по просчёту, без остатков раскроя', tone: TONE[marginTone(t.marginPct)] },
          ].map(c => (
            <div key={c.k} className="bg-white border border-[#e4e4e0] rounded-xl p-3">
              <div className="text-[11px] text-[#9a9a95]">{c.k}</div>
              <div className={`text-base font-semibold tabular-nums ${c.tone ?? 'text-[#111110]'}`}>{c.v}</div>
              <div className="text-[11px] text-[#9a9a95]">{c.h}</div>
            </div>
          ))}
        </div>

        <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-x-auto">
          <div className="min-w-[980px] text-xs">
            <div className={`grid ${grid} gap-2 px-3 py-2 border-b border-[#e4e4e0] text-[11px] text-[#9a9a95]`}>
              <span>Категория → материал</span>
              <span className="text-right">Заказов</span>
              <span className="text-right">Шт</span>
              <span className="text-right">м²</span>
              <span className="text-right">Выручка, ₽</span>
              <span className="text-right">Себест., ₽</span>
              <span className="text-right">Маржа, ₽</span>
              <span className="text-right">Маржа, %</span>
              <span className="text-right">₽ за м²</span>
              {hasDefectData && <span className="text-right">Переделки</span>}
            </div>

            {report.categories.length === 0 && (
              <div className="px-3 py-6 text-center text-[#9a9a95]">За период нет запущенных заказов с позициями.</div>
            )}

            {report.categories.map(c => (
              <details key={c.key} className="border-b border-[#f0f0ec] group">
                <summary className={`grid ${grid} gap-2 px-3 py-2 cursor-pointer list-none hover:bg-[#fafaf8]`}>
                  <span className="font-medium text-[#111110]">
                    <span className="inline-block w-3 text-[#9a9a95] group-open:rotate-90 transition-transform">›</span> {c.label}
                    <span className="text-[#9a9a95] font-normal"> · {c.materials.length} мат.</span>
                  </span>
                  <Cells a={c} strong defects={hasDefectData} />
                </summary>
                <div className="bg-[#fafaf8]">
                  {c.materials.map(m => (
                    <div key={m.key} className={`grid ${grid} gap-2 px-3 py-1.5 text-[#3a3a37]`}>
                      <span className="pl-4 truncate" title={m.label}>{m.label}</span>
                      <Cells a={m} defects={hasDefectData} />
                    </div>
                  ))}
                </div>
              </details>
            ))}

            {report.categories.length > 0 && (
              <div className={`grid ${grid} gap-2 px-3 py-2 bg-[#f5f5f3] font-semibold text-[#111110]`}>
                <span>Итого</span>
                <Cells a={t} strong defects={hasDefectData} />
              </div>
            )}
          </div>
        </div>

        <div className="bg-white border border-[#e4e4e0] rounded-xl p-3 text-xs text-[#6b6b66] space-y-1.5">
          <div className="font-medium text-[#111110]">Как читать</div>
          <p>Заказ — запуск в цех, месяц — по дате запуска. В отчёте только заказы с позициями: они идут с июля 2026 года, заказы до этого импортированы из таблицы без состава.</p>
          <p>Себестоимость — как в просчёте, без невозвратных остатков листа. Честная экономика с раскроем — <Link href="/cfo/order-economics" className="underline">Экономика заказа</Link>.</p>
          <p>
            Сверка: сумма позиций с НДС {rub(report.itemsIncVat)} ₽, сумма итогов заказов {rub(report.ordersIncVat)} ₽
            {reconDelta === 0 ? ' — сходится.' : ` — разница ${reconDelta > 0 ? '+' : '−'}${rub(Math.abs(reconDelta))} ₽ (округление позиций в отдельных заказах).`}
          </p>
          {!hasDefectData && (
            <p className="text-amber-800">
              Брак и переделки: отметок переделки в цехе 0, рекламаций партнёров {claims.count ?? '—'}. Это значит, что брак не записывается, а не что его нет, — колонка появится с первой отметкой.
            </p>
          )}
          {retailAll.count != null && retailNoType.count != null && retailNoType.count > 0 && (
            <p className="text-amber-800">
              Розница M-Glass в отчёт не входит: с июня 2025 года у {retailNoType.count} из {retailAll.count} продаж не записан тип изделия, разложить их по моделям не из чего.
            </p>
          )}
          <p>Сравнение с прошлым годом станет возможным с июля 2027 года — раньше позиций нет.</p>
        </div>
      </div>
    </div>
  )
}
