import Link from 'next/link'
import { redirect } from 'next/navigation'
import { canMargin, getUserProfile } from '@/lib/getRole'
import MarginObjectRow from '@/components/sales/MarginObjectRow'
import { createServiceClient } from '@/lib/supabase-service'
import { mskDayKey } from '@/lib/time'
import { plural } from '@/lib/morning'
import { shiftMonth } from '@/lib/sales/period'
import { MontageFillAll, MontageFillButton, type FillItem } from '@/components/sales/MontageFill'
import { checkMontage, montageBookCached, orderKey, type MarginOrder, type MontageBook, type MontageCheck } from '@/lib/sales/montageBook'
import {
  COST_KEYS, COST_RU, MARGIN_SINCE, NO_TAX_DELIVERY_UNTIL, SALE_COLUMNS, costsComplete, fixLine, fromDb, loadEdits, monthGen, monthRu, needsFix, periodTotals, reconcileMonth, roundShares,
  type MarginDbRow, type MarginObject, type MarginSale, type PeriodTotals,
} from '@/lib/sales/marginBook'

// Маржа объектов M-Glass: книга «Маржа», сверенная с «Продажами M-Glass».
// Читается так, как владелец считает сам (05.10): месяц → все продажи → закрытые заказы
// → их прямые расходы → их маржа. Месяц раскрывается на месте, расходы — по статьям с
// долей от продаж закрытых. Владельцу и тому, кому выдано право «Маржа» (Вере — решение владельца 05.10):
// он же дописывает пустые ячейки объекта в карточке (MarginObjectRow). Витрина CFO
// /cfo/sales-ledger читает ту же себестоимость: её пишет та же утренняя сверка.

export const dynamic = 'force-dynamic'

type Mode = 'month' | 'quarter' | 'year'
type Sale = MarginSale & { ledger_month: string }

const rub = (n: number) => Math.round(n).toLocaleString('ru-RU')
const pct1 = (n: number) => Math.round(n * 10) / 10
const pct = (n: number | null) => (n == null ? '—' : `${pct1(n).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`)
const share = (part: number, whole: number) => (whole ? part / whole * 100 : null)
// Маржа — разность напечатанного: «продажи закрытых − расходы» сходится до рубля,
// доли расходов и маржи от продаж закрытых — до 100,0 %.
const marginRub = (t: PeriodTotals) => rub(Math.round(t.closed_sales) - Math.round(t.costs))
const costPct = (t: PeriodTotals) => share(t.costs, t.closed_sales)
const marginPct = (t: PeriodTotals) => { const c = costPct(t); return c == null ? null : 100 - pct1(c) }
const oldFormat = (m: string) => m >= MARGIN_SINCE && m <= NO_TAX_DELIVERY_UNTIL
const OLD_HINT = 'в книге «Маржа» за апрель–июль 2025 нет колонок «Доставка» и «Налог» — маржа без них, выше сопоставимой'
// Цвет — по напечатанному значению: 34,96 % показывается «35,0 %» и красится зелёным.
const mCls = (n: number | null) =>
  n == null ? 'text-[#9a9a95]' : pct1(n) < 25 ? 'text-red-600' : pct1(n) < 35 ? 'text-amber-600' : 'text-emerald-700'

function monthsOf(mode: Mode, anchor: string): string[] {
  const [y, m] = anchor.split('-').map(Number)
  if (mode === 'month') return [anchor]
  const first = mode === 'year' ? 1 : Math.floor((m - 1) / 3) * 3 + 1
  return Array.from({ length: mode === 'year' ? 12 : 3 }, (_, i) => `${y}-${String(first + i).padStart(2, '0')}`)
}
const periodLabel = (mode: Mode, anchor: string) => {
  const y = anchor.slice(0, 4)
  if (mode === 'year') return `${y} год`
  if (mode === 'quarter') return `${Math.floor((Number(anchor.slice(5, 7)) - 1) / 3) + 1} квартал ${y}`
  return `${monthRu(anchor)} ${y}`
}
const step = (mode: Mode) => (mode === 'year' ? 12 : mode === 'quarter' ? 3 : 1)

const GRID = 'grid grid-cols-[1fr_1fr_.6fr_.6fr_1fr_1fr_1fr_1fr_.7fr] gap-2 items-center'

export default async function MarginPage({ searchParams }: { searchParams: Promise<{ mode?: string; month?: string }> }) {
  const profile = await getUserProfile()
  if (!profile || !canMargin(profile.role, profile.permissions)) redirect('/sales')

  const sp = await searchParams
  const mode: Mode = sp.mode === 'month' || sp.mode === 'quarter' ? sp.mode : 'year'
  const anchor = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month ?? '') ? sp.month! : mskDayKey().slice(0, 7)
  const months = monthsOf(mode, anchor)
  const href = (p: { mode?: Mode; month?: string }) => `/sales/margin?${new URLSearchParams({ mode: p.mode ?? mode, month: p.month ?? anchor })}`

  // Service-role: право на маржу проверено выше.
  const svc = createServiceClient()
  const [{ data: rowsData }, { data: salesData }] = await Promise.all([
    svc.from('margin_book_rows').select('*').in('ledger_month', months).eq('voided', false).order('row_no').range(0, 4999),
    svc.from('crm_sales').select(SALE_COLUMNS).in('ledger_month', months).eq('voided', false).neq('department', 'b2b').range(0, 4999),
  ])
  const rows = (rowsData ?? []) as (MarginDbRow & { ledger_month: string; tab: string })[]
  const sales = (salesData ?? []) as unknown as Sale[]
  // Внесённое в приложении — поверх книги. Не загрузилось — говорим, а не показываем книгу молча.
  const loaded = await loadEdits(svc, sales.map(s => s.id)).then(map => ({ map, error: null }), (e: Error) => ({ map: new Map(), error: e.message }))
  const edits = loaded.map
  const editsError = loaded.error
  const byMonth = months.map(m => {
    const own = rows.filter(r => r.ledger_month === m)
    const objects = reconcileMonth(m, own.map(fromDb), sales.filter(s => s.ledger_month === m), edits)
    const tab = own[0]?.tab ?? `${monthRu(m)} ${m.slice(2, 4)}`
    return {
      month: m, tab, objects, t: periodTotals(objects),
      // До первой вкладки «Маржи» поправлять в книге нечего — этих месяцев в ней нет.
      fixes: m < MARGIN_SINCE ? [] : objects.flatMap(o => o.issues.filter(i => needsFix(o, i)).map(i => fixLine({ month: m, tab }, o, i))),
    }
  }).filter(x => x.objects.length > 0)
  const total = periodTotals(byMonth.flatMap(x => x.objects))
  const fixes = byMonth.flatMap(x => x.fixes)
  const beforeBook = months[0] < MARGIN_SINCE

  // Сверка с «Монтажами»: монтажник и «Дима РОР» по заказам периода. Заказ периода берём
  // с правками приложения; его строки в других месяцах (доплаты) — как в книге: связи
  // строки с продажей в таблице нет, она находится только при разборе своего месяца.
  // До первой вкладки «Маржи» сверять не с чем: пустая ячейка там — «книги не было», а не «не внесли».
  const periodObjects = byMonth.flatMap(x => x.objects).filter(o => o.order_no && o.month >= MARGIN_SINCE)
  const nos = [...new Set(periodObjects.map(o => o.order_no!))]
  const [orderRowsRes, montageRes] = await Promise.all([
    Promise.all(Array.from({ length: Math.ceil(nos.length / 150) }, (_, i) =>
      svc.from('margin_book_rows').select('order_no, ledger_month, installer, dima')
        .in('order_no', nos.slice(i * 150, i * 150 + 150)).eq('voided', false).range(0, 4999))),
    montageBookCached().then(b => ({ b, error: null }), (e: Error) => ({ b: null as MontageBook | null, error: e.message })),
  ])
  const orderRowsError = orderRowsRes.find(r => r.error)?.error?.message ?? null
  const marginOrders = new Map<string, MarginOrder>()
  const add = (k: string, installer: number | null, dima: number | null) => {
    const mo = marginOrders.get(k)!
    if (installer != null) mo.installer = (mo.installer ?? 0) + installer
    if (dima != null) mo.dima = (mo.dima ?? 0) + dima
  }
  for (const o of periodObjects) {
    const k = orderKey(o.order_no)
    if (!marginOrders.has(k)) marginOrders.set(k, { order_no: o.order_no!, month: o.month, installer: null, dima: null })
    add(k, o.costs?.installer ?? null, o.dima)
  }
  const outside = new Set<string>()
  for (const r of orderRowsRes.flatMap(x => (x.data ?? []) as { order_no: string; ledger_month: string; installer: number | null; dima: number | null }[])) {
    if (months.includes(r.ledger_month) || !marginOrders.has(orderKey(r.order_no))) continue
    outside.add(orderKey(r.order_no))
    add(orderKey(r.order_no), r.installer == null ? null : Number(r.installer), r.dima == null ? null : Number(r.dima))
  }
  const checks = montageRes.b ? checkMontage([...marginOrders.values()], montageRes.b.orders) : []

  // «Внести из «Монтажей»» — только когда у заказа ровно один объект с продажей и нет
  // строк в других месяцах: у доплат выплату не на кого однозначно положить.
  const objectsByOrder = new Map<string, typeof periodObjects>()
  for (const o of periodObjects) objectsByOrder.set(orderKey(o.order_no), [...(objectsByOrder.get(orderKey(o.order_no)) ?? []), o])
  const fillOf = new Map<string, FillItem | 'many'>()
  for (const c of checks) {
    if (c.installerState !== 'fill' || !c.montage) continue
    const k = orderKey(c.order_no)
    const objs = objectsByOrder.get(k) ?? []
    fillOf.set(k, objs.length === 1 && objs[0].sale_id != null && !outside.has(k)
      ? { saleId: objs[0].sale_id, orderNo: c.order_no, amount: c.montage.installers }
      : 'many')
  }
  const checkOf = new Map(checks.map(c => [orderKey(c.order_no), c]))
  const hasOld = byMonth.some(x => oldFormat(x.month) && x.t.closed > 0)

  const tile = 'bg-white border border-[#e4e4e0] rounded-xl px-4 py-3'
  const btn = (on: boolean) => `px-3 py-1.5 rounded-lg text-[12px] font-medium border ${on ? 'bg-[#111110] text-white border-[#111110]' : 'bg-white text-[#6b6b66] border-[#e4e4e0] hover:border-[#111110]'}`

  return (
    <div className="min-h-screen bg-[#f8f8f7] pb-20">
      <div className="max-w-[1180px] mx-auto px-4 py-5">
        <div className="flex items-center gap-3 flex-wrap mb-1">
          <h1 className="text-[18px] font-semibold text-[#111110]">📐 Маржа</h1>
          <Link href="/sales" className="text-[12px] text-[#0071e3] hover:underline">→ Продажи M-Glass</Link>
          <Link href="/sales/managers" className="text-[12px] text-[#0071e3] hover:underline">→ Показатели менеджеров</Link>
        </div>
        <p className="text-[12px] text-[#9a9a95] mb-3">
          Продажи — все заказы периода. Расходы и маржа — только по закрытым: закрыт в «Продажах» или отмечен в карточке, и внесены все расходы.
          Закрытый без какой-то статьи стоит в «Не закрыто» с пометкой «дописать». Маржа = продажи закрытых − их прямые расходы. Расходы — из книги «Маржа» и внесённые здесь, продажи — из «Продаж M-Glass»; сверка с книгой каждое утро в 8:10.
          Нажмите на объект — откроются все его ячейки: пустое можно дописать и сохранить.
        </p>

        <div className="flex items-center gap-2 flex-wrap mb-4">
          <div className="flex items-center gap-1.5">
            <Link href={href({ month: shiftMonth(anchor, -step(mode)) })} className="w-8 h-8 grid place-items-center rounded-lg border border-[#e4e4e0] bg-white text-[#6b6b66] hover:bg-[#f5f5f3]">‹</Link>
            <span className="text-[13px] font-semibold text-[#111110] min-w-[150px] text-center">{periodLabel(mode, anchor)}</span>
            <Link href={href({ month: shiftMonth(anchor, step(mode)) })} className="w-8 h-8 grid place-items-center rounded-lg border border-[#e4e4e0] bg-white text-[#6b6b66] hover:bg-[#f5f5f3]">›</Link>
          </div>
          <Link href={href({ mode: 'month' })} className={btn(mode === 'month')}>Месяц</Link>
          <Link href={href({ mode: 'quarter' })} className={btn(mode === 'quarter')}>Квартал</Link>
          <Link href={href({ mode: 'year' })} className={btn(mode === 'year')}>Год</Link>
        </div>

        {editsError && (
          <p role="alert" className="text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">
            Правки, внесённые в приложении, не загрузились ({editsError}) — ниже только книга «Маржа».
          </p>
        )}
        {beforeBook && (
          <p className="text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
            Книга «Маржа» ведётся с {monthGen(MARGIN_SINCE)} {MARGIN_SINCE.slice(0, 4)} года — расходов за более ранние месяцы нет, их заказы в маржу не входят и «дописать» не помечаются.
          </p>
        )}

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
          <div className={tile}>
            <p className="text-[11px] text-[#9a9a95] uppercase tracking-wide">Продажи</p>
            <p className="text-[20px] font-semibold text-[#111110] mt-0.5">{rub(total.sales)} ₽</p>
            <p className="text-[12px] text-[#6b6b66]">{total.objects} заказов за период</p>
          </div>
          <div className={tile}>
            <p className="text-[11px] text-[#9a9a95] uppercase tracking-wide">Закрыто заказов</p>
            <p className="text-[20px] font-semibold text-[#111110] mt-0.5">{total.closed} <span className="text-[14px] font-normal text-[#9a9a95]">из {total.objects}</span></p>
            <p className="text-[12px] text-[#6b6b66]">
              на {rub(total.closed_sales)} ₽ · не закрыто {total.open}
              {total.to_fill > 0 && <span className="text-amber-700">, из них {total.to_fill} — дописать расходы</span>}
            </p>
          </div>
          <div className={tile}>
            <p className="text-[11px] text-[#9a9a95] uppercase tracking-wide">Расходы по закрытым</p>
            <p className="text-[20px] font-semibold text-[#111110] mt-0.5">{rub(total.costs)} ₽</p>
            <p className="text-[12px] text-[#6b6b66]">{pct(costPct(total))} от продаж закрытых</p>
          </div>
          <div className={tile}>
            <p className="text-[11px] text-[#9a9a95] uppercase tracking-wide">Маржа по закрытым</p>
            <p className="text-[20px] font-semibold text-[#111110] mt-0.5">{marginRub(total)} ₽</p>
            <p className="text-[12px] text-[#6b6b66]">
              <span className={`font-semibold ${mCls(marginPct(total))}`}>{pct(marginPct(total))}</span> от продаж закрытых
              {hasOld && <span className="text-amber-700" title={OLD_HINT}> · * апрель–июль 2025 — без налога и доставки</span>}
            </p>
          </div>
          <a href="#fixes" className={`${tile} hover:border-[#111110]`}>
            <p className="text-[11px] text-[#9a9a95] uppercase tracking-wide">Поправить в книгах</p>
            <p className={`text-[20px] font-semibold mt-0.5 ${fixes.length ? 'text-amber-600' : 'text-emerald-700'}`}>{fixes.length}</p>
            <p className="text-[12px] text-[#6b6b66]">{fixes.length ? 'список внизу ↓' : 'книги сходятся'}</p>
          </a>
        </div>

        <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-x-auto mb-4">
          <div className="min-w-[960px]">
            <div className={`${GRID} px-4 pt-2 text-[11px] text-[#9a9a95]`}>
              <span className="col-start-6 col-span-4 text-center border-b border-[#e4e4e0] pb-1">только закрытые заказы</span>
            </div>
            <div className={`${GRID} px-4 py-2 border-b border-[#e4e4e0] text-[11px] text-[#9a9a95]`}>
              <span>Месяц</span>
              <span className="text-right">Продажи, ₽</span>
              <span className="text-right">Заказов</span>
              <span className="text-right">Закрыто</span>
              <span className="text-right">Не закрыто</span>
              <span className="text-right">Продажи, ₽</span>
              <span className="text-right">Расходы, ₽</span>
              <span className="text-right">Маржа, ₽</span>
              <span className="text-right">Маржа</span>
            </div>
            {byMonth.length === 0 && <p className="text-[13px] text-[#9a9a95] py-6 text-center">За этот период продаж нет.</p>}
            {byMonth.map(m => (
              <details key={m.month} open={mode === 'month'} className="group border-b border-[#f0f0ec] last:border-0">
                <summary className={`${GRID} px-4 py-2.5 text-[13px] cursor-pointer list-none hover:bg-[#fafaf8] [&::-webkit-details-marker]:hidden`}>
                  <span className="font-medium text-[#111110]"><span className="inline-block w-4 text-[#9a9a95] transition-transform group-open:rotate-90">▸</span>{monthRu(m.month)}</span>
                  <span className="text-right">{rub(m.t.sales)}</span>
                  <span className="text-right">{m.t.objects}</span>
                  <span className="text-right">{m.t.closed}</span>
                  <OpenCell t={m.t} />
                  <span className="text-right">{rub(m.t.closed_sales)}</span>
                  <span className="text-right">{rub(m.t.costs)}</span>
                  <span className="text-right font-semibold">{marginRub(m.t)}</span>
                  <span className={`text-right font-semibold ${mCls(marginPct(m.t))}`}>{pct(marginPct(m.t))}{oldFormat(m.month) && m.t.closed > 0 && <span className="text-amber-700" title={OLD_HINT}>*</span>}</span>
                </summary>
                <MonthBody m={m} checkOf={checkOf} />
              </details>
            ))}
            {byMonth.length > 1 && (
              <div className={`${GRID} px-4 py-2.5 text-[13px] border-t border-[#e4e4e0] bg-[#fafaf8] font-semibold`}>
                <span className="pl-4">Итого</span>
                <span className="text-right">{rub(total.sales)}</span>
                <span className="text-right">{total.objects}</span>
                <span className="text-right">{total.closed}</span>
                <OpenCell t={total} />
                <span className="text-right">{rub(total.closed_sales)}</span>
                <span className="text-right">{rub(total.costs)}</span>
                <span className="text-right">{marginRub(total)}</span>
                <span className={`text-right ${mCls(marginPct(total))}`}>{pct(marginPct(total))}</span>
              </div>
            )}
          </div>
        </div>

        <MontageBlock checks={checks} book={montageRes.b} error={montageRes.error ?? orderRowsError} open={mode === 'month'} beforeBook={beforeBook} fillOf={fillOf} />

        {fixes.length > 0 && (
          <div id="fixes" className="bg-white border border-[#e4e4e0] rounded-xl px-4 py-3 mb-4">
            <p className="text-[13px] font-semibold text-[#111110] mb-2">✏️ Поправить в книгах · {fixes.length}</p>
            <ul className="space-y-1 text-[12px] text-[#3a3a37]">
              {fixes.map((f, i) => <li key={i}>• {unesc(f)}</li>)}
            </ul>
          </div>
        )}

        <div className="text-[11px] text-[#9a9a95] space-y-1">
          <p>Продажи — сумма всех заказов месяца из «Продаж M-Glass». Закрытый — «закрыт» там или отмечен закрытым в карточке объекта, и у него внесены стекло, фурнитура, конструктор, замерщик, монтажник и доставка. Расходы и маржа — только закрытых, процент маржи — от их продаж. Расходы — прямые по заказам из «Маржи»: стекло, фурнитура, конструктор, замерщик, монтажник, доставка, партнёры, рекламации, налог и бонусы. Статьи складываются здесь, а не берутся из итога книги: число, набранное текстом, книга не считает.</p>
          <p>«Дописать» — заказ закрыт по статусу, но в «Марже» пусто хотя бы в одной из этих шести статей или его там ещё нет. Он в «Не закрыто» и в маржу не входит, пока статью не заполнят. Если расхода не было — поставьте 0 (в книге или в карточке объекта): заказ сразу перейдёт в закрытые. </p>
          <p>* Апрель–июль 2025: в книге «Маржа» нет колонок «Доставка» и «Налог» — доставка считается 0, налог не учтён, поэтому маржа этих месяцев выше сопоставимой с последующими. Добавьте колонки в книгу — сверка прочитает их сама.</p>
          <p>🔧 Сверка с «Монтажами»: монтажник — сумма выплат по колонкам с именами во всех вкладках книги «Монтажи» (с января 2025), «Дима РОР» — 5 % от маржинального дохода руководителю отдела реализации. В «Марже» — сумма всех строк заказа, с правками из приложения. Книга «Монтажи» только читается, раз в 10 минут.</p>
          <p>✎ — у объекта есть ячейки, внесённые в приложении: они сильнее книги, книга не меняется. Если книга потом заполнит ячейку по-другому, карточка покажет оба значения. Каждая правка — в журнале действий у владельца.</p>
        </div>
      </div>
    </div>
  )
}

function MonthBody({ m, checkOf }: { m: { month: string; objects: MarginObject[]; t: PeriodTotals; fixes: string[] }; checkOf: Map<string, MontageCheck> }) {
  const rows = COST_KEYS.map(k => ({ k, sum: m.t.byCost[k] })).filter(x => x.sum !== 0).sort((a, b) => b.sum - a.sum)
  const shares = roundShares(rows.map(x => x.sum), m.t.closed_sales)
  const sold = m.objects.filter(o => o.sale_id != null)
  return (
    <div className="px-4 pb-4 pt-1 space-y-2 bg-[#fcfcfb]">
      <details className="group/c bg-white border border-[#e4e4e0] rounded-lg">
        <summary className="flex items-center justify-between px-3 py-2 text-[13px] cursor-pointer list-none [&::-webkit-details-marker]:hidden">
          <span className="font-medium"><span className="inline-block w-4 text-[#9a9a95] transition-transform group-open/c:rotate-90">▸</span>Расходы закрытых по статьям</span>
          <span><b>{rub(m.t.costs)} ₽</b> <span className="text-[#9a9a95]">· {pct(costPct(m.t))} от продаж закрытых</span></span>
        </summary>
        <div className="px-3 pb-2">
          {rows.length === 0 && <p className="text-[12px] text-[#9a9a95] py-1">{m.t.closed ? 'Расходы закрытых в «Марже» не внесены.' : 'Закрытых заказов в этом месяце пока нет.'}</p>}
          {rows.map((x, i) => (
            <div key={x.k} className="grid grid-cols-[1fr_auto_4.5rem] gap-3 py-1 text-[12px] border-t border-[#f0f0ec] first:border-0">
              <span>{COST_RU[x.k][0].toUpperCase() + COST_RU[x.k].slice(1)}</span>
              <span className="text-right tabular-nums">{rub(x.sum)} ₽</span>
              <span className="text-right tabular-nums text-[#6b6b66]">{m.t.closed_sales ? pct(shares[i]) : '—'}</span>
            </div>
          ))}
        </div>
      </details>

      {m.t.to_fill > 0 && (
        <p className="text-[12px] text-amber-700">✎ {m.t.to_fill} {plural(m.t.to_fill, 'заказ закрыт', 'заказа закрыты', 'заказов закрыто')} без всех расходов — в маржу месяца не вошли. В списке объектов ниже они помечены «дописать».</p>
      )}

      <details className="group/o bg-white border border-[#e4e4e0] rounded-lg">
        <summary className="flex items-center justify-between px-3 py-2 text-[13px] cursor-pointer list-none [&::-webkit-details-marker]:hidden">
          <span className="font-medium"><span className="inline-block w-4 text-[#9a9a95] transition-transform group-open/o:rotate-90">▸</span>Объекты · {sold.length}</span>
          <span className="text-[#9a9a95]">закрыто {m.t.closed} · не закрыто {m.t.open}</span>
        </summary>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px] whitespace-nowrap">
            <thead className="text-[#9a9a95] text-left">
              <tr className="border-y border-[#f0f0ec]">
                <th className="px-3 py-1.5 font-medium">Заказ</th>
                <th className="px-3 py-1.5 font-medium">Клиент · менеджер</th>
                <th className="px-3 py-1.5 font-medium">Статус</th>
                <th className="px-3 py-1.5 font-medium text-right">Продажа</th>
                <th className="px-3 py-1.5 font-medium text-right">Расходы</th>
                <th className="px-3 py-1.5 font-medium text-right">Маржа</th>
                <th className="px-3 py-1.5 font-medium text-right">%</th>
                <th className="px-3 py-1.5 font-medium">Что не так</th>
              </tr>
            </thead>
            <tbody>
              {m.objects.map(o => (
                <MarginObjectRow key={`${o.order_no}-${o.row ?? o.sale_id}`} d={{
                  saleId: o.sale_id, orderNo: o.order_no, client: o.client, manager: o.manager,
                  closed: o.closed, needsCosts: o.closed && !costsComplete(o) && o.month >= MARGIN_SINCE, bookClosed: o.book_closed, amount: o.amount, partnerFee: o.partner_fee,
                  varTotal: o.var_total, md: o.md, mdPct: o.md_pct, issue: withMontage(issueText(o), o.order_no ? checkOf.get(orderKey(o.order_no)) : undefined),
                  book: o.book_costs, edits: o.edits,
                }} />
              ))}
            </tbody>
          </table>
        </div>
      </details>

      {m.fixes.length > 0 && (
        <ul className="text-[12px] text-[#6b6b66] space-y-0.5">
          {m.fixes.map((f, i) => <li key={i}>✏️ {unesc(f)}</li>)}
        </ul>
      )}
    </div>
  )
}

function OpenCell({ t }: { t: PeriodTotals }) {
  return (
    <span className="text-right">
      {t.open}
      {t.to_fill > 0 && <span className="text-[11px] font-normal text-amber-700" title="закрыты по статусу, но расходы внесены не все — допишите, и заказ войдёт в маржу"> · {t.to_fill} дописать</span>}
    </span>
  )
}

function withMontage(issue: string, c: MontageCheck | undefined): string {
  if (!c?.montage) return issue
  const extra: string[] = []
  if (c.installerState === 'diff') extra.push(`«Монтажи»: монтажник ${rub(c.montage.installers)}`)
  if (c.installerState === 'fill') extra.push(`«Монтажи»: монтажник ${rub(c.montage.installers)} — можно внести`)
  if (c.dimaState === 'diff') extra.push(`«Монтажи»: Дима ${rub(c.montage.dima ?? 0)}`)
  if (!extra.length) return issue
  return issue === '—' ? extra.join('; ') : `${issue}; ${extra.join('; ')}`
}

function MontageBlock({ checks, book, error, open, beforeBook, fillOf }: { checks: MontageCheck[]; book: MontageBook | null; error: string | null; open: boolean; beforeBook: boolean; fillOf: Map<string, FillItem | 'many'> }) {
  if (error) {
    return <p role="alert" className="text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">Сверка с «Монтажами» не сделана: {error}</p>
  }
  if (!book || checks.length === 0) return null
  const n = (f: (c: MontageCheck) => boolean) => checks.filter(f).length
  const bad = checks.filter(c => c.installerState === 'diff' || c.installerState === 'fill' || c.dimaState === 'diff')
    .sort((a, b) => a.month.localeCompare(b.month) || a.order_no.localeCompare(b.order_no))
  const who = (c: MontageCheck) => Object.entries(c.montage?.byName ?? {}).map(([k, v]) => `${k} ${rub(v)}`).join(', ')
  const cell = (v: number | null | undefined) => (v == null ? <span className="text-[#9a9a95]">пусто</span> : rub(v))
  const fillItems = [...fillOf.values()].filter((f): f is FillItem => f !== 'many')
  return (
    <details open={open || bad.length <= 15} className="group/m bg-white border border-[#e4e4e0] rounded-xl mb-4">
      <summary className="px-4 py-3 cursor-pointer list-none [&::-webkit-details-marker]:hidden flex items-start justify-between gap-3">
        <div>
        <p className="text-[13px] font-semibold text-[#111110]">
          <span className="inline-block w-4 text-[#9a9a95] transition-transform group-open/m:rotate-90">▸</span>
          🔧 Сверка с «Монтажами» · {checks.length} {plural(checks.length, 'заказ', 'заказа', 'заказов')}
        </p>
        <p className="text-[12px] text-[#6b6b66] pl-4 mt-0.5">
          Монтажник: совпало {n(c => c.installerState === 'ok')} · <span className={n(c => c.installerState === 'diff') ? 'text-red-700' : ''}>расходится {n(c => c.installerState === 'diff')}</span>
          {' '}· <span className={n(c => c.installerState === 'fill') ? 'text-amber-700' : ''}>в «Марже» пусто, в «Монтажах» есть {n(c => c.installerState === 'fill')}</span>
          {' '}· в «Монтажах» нет {n(c => c.installerState === 'none')}
          <br />Дима РОР: совпало {n(c => c.dimaState === 'ok')} · <span className={n(c => c.dimaState === 'diff') ? 'text-red-700' : ''}>расходится {n(c => c.dimaState === 'diff')}</span>
          {book.missing.length > 0 && <span className="text-amber-700"> · не прочитаны вкладки: {book.missing.join(', ')}</span>}
          {beforeBook && <><br />Заказы до {monthGen(MARGIN_SINCE)} {MARGIN_SINCE.slice(0, 4)} не сверяются: книги «Маржа» тогда не было.</>}
        </p>
        </div>
        <MontageFillAll items={fillItems} />
      </summary>
      {bad.length > 0 && (
        <div className="overflow-x-auto border-t border-[#f0f0ec]">
          <table className="w-full text-[12px] whitespace-nowrap">
            <thead className="text-[#9a9a95] text-left">
              <tr>
                <th className="px-3 py-1.5 font-medium">Заказ</th>
                <th className="px-3 py-1.5 font-medium text-right">Монтажник: «Маржа»</th>
                <th className="px-3 py-1.5 font-medium text-right">«Монтажи»</th>
                <th className="px-3 py-1.5 font-medium">кто</th>
                <th className="px-3 py-1.5 font-medium text-right">Дима: «Маржа»</th>
                <th className="px-3 py-1.5 font-medium text-right">«Монтажи»</th>
                <th className="px-3 py-1.5 font-medium">вкладки «Монтажей»</th>
                <th className="px-3 py-1.5 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {bad.map(c => (
                <tr key={c.order_no} className="border-t border-[#f0f0ec]">
                  <td className="px-3 py-1.5">{c.order_no} <span className="text-[#9a9a95]">· {monthRu(c.month).toLowerCase()} {c.month.slice(2, 4)}</span></td>
                  <td className={`px-3 py-1.5 text-right ${c.installerState === 'diff' ? 'text-red-700' : c.installerState === 'fill' ? 'text-amber-700' : ''}`}>{cell(c.installer)}</td>
                  <td className="px-3 py-1.5 text-right">{c.montage?.installers ? rub(c.montage.installers) : <span className="text-[#9a9a95]">—</span>}</td>
                  <td className="px-3 py-1.5 text-[#6b6b66]">{who(c) || '—'}</td>
                  <td className={`px-3 py-1.5 text-right ${c.dimaState === 'diff' ? 'text-red-700' : ''}`}>{cell(c.dima)}</td>
                  <td className="px-3 py-1.5 text-right">{c.montage?.dima != null ? rub(c.montage.dima) : <span className="text-[#9a9a95]">—</span>}</td>
                  <td className="px-3 py-1.5 text-[#9a9a95]">{c.montage?.tabs.join(', ')}</td>
                  <td className="px-3 py-1.5">
                    {(() => {
                      const f = fillOf.get(orderKey(c.order_no))
                      if (!f) return null
                      if (f === 'many') return <span className="text-[11px] text-[#9a9a95]" title="У заказа несколько строк в «Марже» (доплаты) — на какую положить выплату, решает человек">несколько строк — в карточке</span>
                      return <MontageFillButton item={f} />
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  )
}

const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

function issueText(o: MarginObject): string {
  const parts: string[] = []
  for (const i of o.issues) {
    if (i.kind === 'no_sale') parts.push(`нет в «Продажах»${i.hint ? ` (может, ${i.hint}?)` : ''}`)
    if (i.kind === 'no_margin') parts.push('нет в «Марже» — расходов нет')
    if (i.kind === 'amount') parts.push(`в «Марже» сумма ${rub(i.margin)}`)
    if (i.kind === 'text_cells') parts.push(`текстом: ${i.keys.map(k => COST_RU[k]).join(', ')} — книга занизила расходы на ${rub(i.cells - i.book)}`)
    if (i.kind === 'book_total') parts.push(`итог книги ${rub(i.book)} ≠ статьям`)
    if (i.kind === 'missing_costs') parts.push(`не внесено: ${i.keys.map(k => COST_RU[k]).join(', ')}`)
    if (i.kind === 'partners') parts.push(i.sale > i.margin ? `партнёрские в «Продажах» ${rub(i.sale)}, в «Марже» ${rub(i.margin)}` : `в «Продажах» партнёрские ${rub(i.sale)}`)
  }
  return parts.join('; ') || '—'
}
