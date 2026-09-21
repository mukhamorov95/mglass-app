import Link from 'next/link'
import { Suspense } from 'react'
import { loadSalesLeads, CHANNELS_SINCE } from '@/lib/leadgen/loadSalesLeads'
import {
  buildChannelTable, buildMonthly, daysToWin, thousandsTable, roundPreservingSum, monthsBetween,
  moscowMonth, nowUnix, GROUP_LABEL, RECORDING_CHANGE_MONTH, type Stats,
} from '@/lib/leadgen/channels'

// Маршрут docs/LEADGEN_ROUTE.md, этап Л1: по каждому каналу — сделки, замер, оплата, деньги.
export const maxDuration = 60

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const MONTH_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const nf = new Intl.NumberFormat('ru-RU')

function shiftMonth(m: string, delta: number): string {
  const [y, mm] = m.split('-').map(Number)
  const d = new Date(Date.UTC(y, mm - 1 + delta, 1))
  return d.toISOString().slice(0, 7)
}

function monthLabel(m: string): string {
  const [y, mm] = m.split('-').map(Number)
  return `${MONTH_SHORT[mm - 1]} ${String(y).slice(2)}`
}

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 1000) / 10}%`.replace('.', ',') : '—')
const avgK = (s: Stats) => (s.paid ? nf.format(Math.round(s.paidSum / s.paid / 1000)) : '—')

export default async function ChannelsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const sp = await searchParams
  const now = moscowMonth(nowUnix())
  let to = sp.to && MONTH_RE.test(sp.to) && sp.to <= now ? sp.to : now
  let from = sp.from && MONTH_RE.test(sp.from) ? sp.from : shiftMonth(now, -5)
  if (from < CHANNELS_SINCE) from = CHANNELS_SINCE
  if (from > to) [from, to] = [to, from]

  const presets = [
    { label: '3 месяца', from: shiftMonth(now, -2), to: now },
    { label: '6 месяцев', from: shiftMonth(now, -5), to: now },
    { label: '12 месяцев', from: shiftMonth(now, -11), to: now },
    { label: `С апреля 2026`, from: RECORDING_CHANGE_MONTH, to: now },
    { label: '2025 год', from: '2025-01', to: '2025-12' },
  ]

  return (
    <div className="min-h-screen bg-[#f5f5f3] px-4 py-6 md:px-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-5">
          <h1 className="text-[20px] font-semibold text-[#111110]">Откуда деньги</h1>
          <p className="text-[12px] text-[#9a9a95] mt-1">
            Каналы B2C: сколько сделок пришло, сколько дошло до замера и оплаты, сколько денег.
            Сделки воронки «Продажи» AmoCRM по месяцу создания, канал — поле «Источник сделки».
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 mb-5">
          {presets.map(p => {
            const active = p.from === from && p.to === to
            return (
              <Link key={p.label} href={`/commercial/channels?from=${p.from}&to=${p.to}`}
                className={`text-[12px] px-3 py-1.5 rounded-lg border ${active ? 'bg-[#111110] text-white border-[#111110]' : 'bg-white text-[#111110] border-[#e4e4e0] hover:border-[#9a9a95]'}`}>
                {p.label}
              </Link>
            )
          })}
          <span className="text-[12px] text-[#9a9a95] ml-2">{monthLabel(from)} — {monthLabel(to)}</span>
        </div>

        <Suspense fallback={<div className="bg-white border border-[#e4e4e0] rounded-xl px-5 py-6 text-[13px] text-[#9a9a95]">Загружаю сделки из AmoCRM — до 10 секунд при первом открытии за час…</div>}>
          <ChannelsData from={from} to={to} now={now} />
        </Suspense>
      </div>
    </div>
  )
}

async function ChannelsData({ from, to, now }: { from: string; to: string; now: string }) {
  let data: Awaited<ReturnType<typeof loadSalesLeads>>
  try {
    data = await loadSalesLeads()
  } catch (e) {
    return (
      <div className="bg-white border border-red-200 rounded-xl px-5 py-4 text-[13px] text-red-600">
        AmoCRM не ответила: {e instanceof Error ? e.message : 'ошибка'}. Обновите страницу через минуту.
      </div>
    )
  }
  const { leads, zoneOf } = data
  const table = buildChannelTable(leads, zoneOf, from, to)
  const money = thousandsTable(table)
  const monthly = buildMonthly(leads, zoneOf, from, to)
  const lag = daysToWin(leads)
  const crossesRecordingChange = from < RECORDING_CHANGE_MONTH && to >= RECORDING_CHANGE_MONTH
  const unknown = table.groups.find(g => g.group === 'unknown')?.stats.deals ?? 0
  // Месяц «молодой», если от его конца до сегодня меньше медианы пути до оплаты.
  const youngFrom = lag ? moscowMonth(nowUnix() - lag.median * 86400) : now

  if (!table.total.deals) {
    return <div className="bg-white border border-[#e4e4e0] rounded-xl px-5 py-6 text-[13px] text-[#9a9a95]">За выбранные месяцы сделок нет.</div>
  }

  const monthMoney = new Map<string, number[]>()
  const monthGroups = table.groups.map(g => g.group)
  for (const m of monthly.months) {
    const total = Math.round(monthly.cell('total', m).paidSum / 1000)
    monthMoney.set(m, roundPreservingSum(monthGroups.map(g => monthly.cell(g, m).paidSum / 1000), total))
  }

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Tile label="Сделок" value={nf.format(table.total.deals)} hint={perMonthLabel(from, to, table.total.deals)} />
        <Tile label="Оплачено" value={nf.format(table.total.paid)} hint={`конверсия ${pct(table.total.paid, table.total.deals)}`} />
        <Tile label="Деньги, тыс ₽" value={nf.format(money.total)} hint={`средний чек ${avgK(table.total)} тыс`} />
        <Tile label="Без источника" value={nf.format(unknown)} hint={`${pct(unknown, table.total.deals)} сделок`} />
      </div>

      <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-x-auto mb-5">
        <table className="w-full text-[12px] tabular-nums">
          <thead>
            <tr className="text-[#9a9a95] border-b border-[#e4e4e0]">
              <th className="text-left font-medium px-4 py-2.5">Канал</th>
              <th className="text-right font-medium px-3 py-2.5">Сделок</th>
              <th className="text-right font-medium px-3 py-2.5">До замера</th>
              <th className="text-right font-medium px-3 py-2.5">Оплачено</th>
              <th className="text-right font-medium px-3 py-2.5">Конверсия</th>
              <th className="text-right font-medium px-3 py-2.5">Чек, тыс</th>
              <th className="text-right font-medium px-3 py-2.5">Деньги, тыс ₽</th>
              <th className="text-right font-medium px-4 py-2.5">Доля денег</th>
            </tr>
          </thead>
          <tbody>
            {table.groups.map((g, gi) => (
              <GroupRows key={g.group} label={GROUP_LABEL[g.group]} stats={g.stats} money={money.groups[gi]} totalMoney={money.total}
                rows={g.rows.map((r, ri) => ({ ...r, money: money.rows[gi][ri] }))} />
            ))}
            <tr className="border-t-2 border-[#111110] font-semibold text-[#111110]">
              <td className="px-4 py-2.5">Итого</td>
              <StatCells s={table.total} money={money.total} totalMoney={money.total} />
            </tr>
            <tr className="text-[#9a9a95] border-t border-[#e4e4e0]">
              <td className="px-4 py-2.5">в т.ч. с меткой Яндекс.Директа — уже внутри строк выше</td>
              <StatCells s={table.direct} money={Math.round(table.direct.paidSum / 1000)} totalMoney={money.total} />
            </tr>
          </tbody>
        </table>
      </div>

      <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-x-auto mb-5">
        <div className="px-4 pt-3 pb-1 text-[13px] font-semibold text-[#111110]">По месяцам создания сделки</div>
        <div className="px-4 pb-2 text-[11px] text-[#9a9a95]">Деньги, тыс ₽ · оплачено из сделок</div>
        <table className="w-full text-[12px] tabular-nums">
          <thead>
            <tr className="text-[#9a9a95] border-b border-[#e4e4e0]">
              <th className="text-left font-medium px-4 py-2">Группа</th>
              {monthly.months.map(m => (
                <th key={m} className={`text-right font-medium px-3 py-2 whitespace-nowrap ${m >= youngFrom ? 'italic' : ''}`}>
                  {monthLabel(m)}{m >= youngFrom ? '*' : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.groups.map((g, gi) => (
              <tr key={g.group} className="border-b border-[#f0f0ec]">
                <td className="px-4 py-2 text-[#111110] whitespace-nowrap">{GROUP_LABEL[g.group]}</td>
                {monthly.months.map(m => {
                  const c = monthly.cell(g.group, m)
                  return <MonthCellView key={m} money={monthMoney.get(m)![gi]} paid={c.paid} deals={c.deals} young={m >= youngFrom} />
                })}
              </tr>
            ))}
            <tr className="font-semibold">
              <td className="px-4 py-2 text-[#111110]">Итого</td>
              {monthly.months.map(m => {
                const c = monthly.cell('total', m)
                return <MonthCellView key={m} money={Math.round(c.paidSum / 1000)} paid={c.paid} deals={c.deals} young={m >= youngFrom} />
              })}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="bg-white border border-[#e4e4e0] rounded-xl px-5 py-4 text-[12px] text-[#111110] space-y-2">
        {lag && (
          <p>
            <b>Путь до оплаты.</b> От создания сделки до «реализовано успешно» — медиана {lag.median} дн.
            (у половины сделок {lag.p25}–{lag.p75} дн., по {nf.format(lag.n)} сделкам). Месяцы со звёздочкой ещё
            доходят до оплаты — их конверсия и деньги будут расти.
          </p>
        )}
        {crossesRecordingChange && (
          <p>
            <b>Граница апреля 2026.</b> До апреля сделку заводили, когда клиент почти куплен; с апреля — каждое
            обращение, включая Авито. Конверсию до и после не сравнивать — сравнивать число оплат и деньги.
          </p>
        )}
        <p className="text-[#9a9a95]">
          «Оплачено» — этап зоны 3 (оплата получена … оплата дизайнером) или «реализовано успешно»; «до замера» —
          зона 2 и дальше. Деньги — бюджет сделки в AmoCRM. Канал ставит менеджер в поле «Источник сделки»; если оно
          пустое — берётся тег. AmoCRM только читается, данные обновляются раз в час.
        </p>
      </div>
    </>
  )
}

function perMonthLabel(from: string, to: string, deals: number): string {
  const months = monthsBetween(from, to).length
  return `${nf.format(Math.round(deals / months))} в месяц · ${months} мес`
}

function Tile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="bg-white border border-[#e4e4e0] rounded-xl px-4 py-3">
      <div className="text-[11px] text-[#9a9a95]">{label}</div>
      <div className="text-[20px] font-semibold text-[#111110] tabular-nums">{value}</div>
      <div className="text-[11px] text-[#9a9a95]">{hint}</div>
    </div>
  )
}

function StatCells({ s, money, totalMoney }: { s: Stats; money: number; totalMoney: number }) {
  return (
    <>
      <td className="text-right px-3 py-2">{nf.format(s.deals)}</td>
      <td className="text-right px-3 py-2">{nf.format(s.measured)}</td>
      <td className="text-right px-3 py-2">{nf.format(s.paid)}</td>
      <td className="text-right px-3 py-2">{pct(s.paid, s.deals)}</td>
      <td className="text-right px-3 py-2">{avgK(s)}</td>
      <td className="text-right px-3 py-2">{nf.format(money)}</td>
      <td className="text-right px-4 py-2">{pct(money, totalMoney)}</td>
    </>
  )
}

function GroupRows({ label, stats, money, totalMoney, rows }: {
  label: string; stats: Stats; money: number; totalMoney: number
  rows: { source: string; stats: Stats; money: number }[]
}) {
  return (
    <>
      <tr className="bg-[#fafaf8] border-t border-[#e4e4e0] font-semibold text-[#111110]">
        <td className="px-4 py-2">{label}</td>
        <StatCells s={stats} money={money} totalMoney={totalMoney} />
      </tr>
      {rows.length > 1 && rows.map(r => (
        <tr key={r.source} className="text-[#111110] border-t border-[#f0f0ec]">
          <td className="pl-8 pr-4 py-1.5 text-[#555550]">{r.source}</td>
          <StatCells s={r.stats} money={r.money} totalMoney={totalMoney} />
        </tr>
      ))}
    </>
  )
}

function MonthCellView({ money, paid, deals, young }: { money: number; paid: number; deals: number; young: boolean }) {
  return (
    <td className={`text-right px-3 py-2 whitespace-nowrap ${young ? 'text-[#9a9a95]' : 'text-[#111110]'}`}>
      <div>{deals ? nf.format(money) : '—'}</div>
      {deals > 0 && <div className="text-[10px] text-[#9a9a95]">{paid} из {deals}</div>}
    </td>
  )
}
