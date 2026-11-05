// Содержимое акта сверки: один вид и на вкладке, и в сохранённом документе.
import { debtText, type ReconColumn, type ReconDoc } from '@/lib/production/clientReconciliation'
import { fmtDay } from './types'

export const fmtMoney = (n: number) => `${n.toLocaleString('ru-RU', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })} ₽`
const weekday = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('ru-RU', { weekday: 'short', timeZone: 'UTC' })
const STATE = { none: 'не отгружен', partial: 'частично', full: 'отгружен' } as const

function Debt({ n, client }: { n: number; client: string }) {
  return (
    <>
      <span className="font-semibold">{fmtMoney(Math.abs(n))}</span>
      <span className="block text-[11px] font-normal text-[#6b6b66]">{debtText(n, client)}</span>
    </>
  )
}

function Row({ label, whole, items, strong }: { label: string; whole: React.ReactNode; items: React.ReactNode; strong?: boolean }) {
  return (
    <tr className={`border-b border-[#e4e4e0] align-top ${strong ? 'bg-[#f5f5f3]' : ''}`}>
      <td className={`py-1.5 px-1.5 ${strong ? 'font-semibold' : ''}`}>{label}</td>
      <td className="py-1.5 px-1.5 text-right whitespace-nowrap">{whole}</td>
      <td className="py-1.5 px-1.5 text-right whitespace-nowrap">{items}</td>
    </tr>
  )
}

function unassignedLabel(c: ReconColumn) {
  return c.unassigned > 0 ? 'Деньги пришли, по заказам не разнесены' : 'На заказах отмечено больше, чем пришло денег'
}

export default function ReconciliationDoc({ doc, caption }: { doc: ReconDoc; caption: string }) {
  const { whole, items, launched, closedOrders, moneyInPeriod, notes, clientName: client } = doc
  const parts = Math.round((whole.closing - items.closing) * 100) / 100
  const hasUndated = whole.undated !== 0 || items.undated !== 0
  const hasUnassigned = whole.unassigned !== 0
  return (
    <div className="space-y-5 text-[#111110]">
      <div>
        <h2 className="text-[18px] font-semibold">Акт сверки с {client}</h2>
        <p className="text-[13px] text-[#4b4b47]">За период {fmtDay(doc.from)} — {fmtDay(doc.to)}. {caption}</p>
      </div>

      <div className="pdf-keep rounded-lg border border-[#e4e4e0] bg-white p-3 text-[13px] space-y-1">
        <p className="font-semibold">На {fmtDay(doc.to)}</p>
        <p>Считая только заказы, отгруженные целиком: {debtText(whole.closing, client).toLowerCase()} {fmtMoney(Math.abs(whole.closing))}.</p>
        <p>Считая и отгруженные части заказов: {debtText(items.closing, client).toLowerCase()} {fmtMoney(Math.abs(items.closing))}.</p>
        {parts !== 0 && <p className="text-[#6b6b66]">Разница {fmtMoney(Math.abs(parts))}: части заказов, которые уехали, а заказ ещё не закрыт.</p>}
      </div>

      <section className="space-y-1.5">
        <h3 className="text-[14px] font-semibold">За период</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px] border-collapse">
            <tbody>
              <tr className="border-b border-[#e4e4e0]"><td className="py-1.5 px-1.5 font-medium">Запущено в работу</td><td className="py-1.5 px-1.5 text-right whitespace-nowrap">{launched.orders} зак. · {launched.pieces} шт.</td><td className="py-1.5 px-1.5 text-right whitespace-nowrap font-medium">{fmtMoney(launched.amount)}</td></tr>
              <tr className="border-b border-[#e4e4e0]"><td className="py-1.5 px-1.5 pl-4">из них оплачено</td><td /><td className="py-1.5 px-1.5 text-right whitespace-nowrap">{fmtMoney(launched.paid)}</td></tr>
              <tr className="border-b border-[#e4e4e0]"><td className="py-1.5 px-1.5 pl-4">из них не оплачено</td><td /><td className="py-1.5 px-1.5 text-right whitespace-nowrap">{fmtMoney(launched.unpaid)}</td></tr>
              <tr className="border-b border-[#e4e4e0]"><td className="py-1.5 px-1.5 font-medium">Отгружено изделий</td><td className="py-1.5 px-1.5 text-right whitespace-nowrap">{items.shippedPieces} шт.</td><td className="py-1.5 px-1.5 text-right whitespace-nowrap font-medium">{fmtMoney(items.shipped)}</td></tr>
              <tr className="border-b border-[#e4e4e0]"><td className="py-1.5 px-1.5 pl-4">заказов закрыто целиком</td><td className="py-1.5 px-1.5 text-right whitespace-nowrap">{closedOrders.orders} зак.</td><td className="py-1.5 px-1.5 text-right whitespace-nowrap">{fmtMoney(closedOrders.amount)}</td></tr>
              <tr className="border-b border-[#e4e4e0]"><td className="py-1.5 px-1.5 font-medium">Поступило денег</td><td className="py-1.5 px-1.5 text-right whitespace-nowrap">{new Set(moneyInPeriod.rows.map(m => m.day)).size} дн.</td><td className="py-1.5 px-1.5 text-right whitespace-nowrap font-medium">{fmtMoney(moneyInPeriod.total)}</td></tr>
              <tr className="border-b border-[#e4e4e0]"><td className="py-1.5 px-1.5 text-[#4b4b47]">Все запущенные к концу периода, ещё не оплачено</td><td /><td className="py-1.5 px-1.5 text-right whitespace-nowrap">{fmtMoney(launched.openUnpaid)}</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-1.5">
        <h3 className="text-[14px] font-semibold">Кто кому должен</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px] border-collapse">
            <thead>
              <tr className="border-b-2 border-[#111110] text-left align-bottom">
                <th className="py-1.5 px-1.5" />
                <th className="py-1.5 px-1.5 text-right">Только заказы целиком</th>
                <th className="py-1.5 px-1.5 text-right">С отгруженными частями</th>
              </tr>
            </thead>
            <tbody>
              <Row label={`На начало, ${fmtDay(doc.from)}`} whole={<Debt n={whole.opening} client={client} />} items={<Debt n={items.opening} client={client} />} />
              <Row label="Поступило денег за период" whole={fmtMoney(moneyInPeriod.total)} items={fmtMoney(moneyInPeriod.total)} />
              <Row label="Отгружено за период" whole={fmtMoney(whole.shipped)} items={fmtMoney(items.shipped)} />
              {hasUndated && <Row label="Уехало, дата отгрузки не записана" whole={fmtMoney(whole.undated)} items={fmtMoney(items.undated)} />}
              <Row strong label={`На конец, ${fmtDay(doc.to)}`} whole={<Debt n={whole.closing} client={client} />} items={<Debt n={items.closing} client={client} />} />
              <Row label="Оплачено, не отгружено: должны мы" whole={fmtMoney(whole.weOwe)} items={fmtMoney(items.weOwe)} />
              <Row label={`Отгружено, не оплачено: должен ${client}`} whole={fmtMoney(whole.theyOwe)} items={fmtMoney(items.theyOwe)} />
              {hasUnassigned && <Row label={unassignedLabel(whole)} whole={fmtMoney(Math.abs(whole.unassigned))} items={fmtMoney(Math.abs(items.unassigned))} />}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-1.5">
        <h3 className="text-[14px] font-semibold">Поступления за период</h3>
        {moneyInPeriod.rows.length === 0
          ? <p className="text-[12px] text-[#6b6b66]">За период поступлений нет{notes.bankTo && doc.to > notes.bankTo ? `. Выписка загружена по ${fmtDay(notes.bankTo)}.` : '.'}</p>
          : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px] border-collapse">
                <tbody>
                  {moneyInPeriod.rows.map((m, i) => (
                    <tr key={`${m.day}-${i}`} className="border-b border-[#e4e4e0]">
                      <td className="py-1 px-1.5 whitespace-nowrap">{fmtDay(m.day)}, {weekday(m.day)}</td>
                      <td className="py-1 px-1.5 text-[#6b6b66]">{m.source === 'bank' ? 'выписка банка' : 'отметка, в выписке этого дня нет'}</td>
                      <td className="py-1 px-1.5 text-right whitespace-nowrap">{fmtMoney(m.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </section>

      <section className="space-y-1.5">
        <h3 className="text-[14px] font-semibold">Заказы · {doc.orders.length}</h3>
        <p className="text-[12px] text-[#6b6b66]">Запущены или двигались в периоде либо с долгом на конец периода. Остаток считается с отгруженными частями.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px] border-collapse">
            <thead>
              <tr className="border-b-2 border-[#111110] text-left">
                <th className="py-1.5 px-1.5">Заказ</th><th className="py-1.5 px-1.5">Запуск</th><th className="py-1.5 px-1.5 text-right">Сумма</th>
                <th className="py-1.5 px-1.5 text-right">Оплачено</th><th className="py-1.5 px-1.5 text-right">Отгружено</th><th className="py-1.5 px-1.5">Отгрузка</th><th className="py-1.5 px-1.5 text-right">Остаток</th>
              </tr>
            </thead>
            <tbody>
              {doc.orders.map(o => (
                <tr key={o.id} className="border-b border-[#e4e4e0]">
                  <td className="py-1 px-1.5 font-medium whitespace-nowrap">{o.no}</td>
                  <td className="py-1 px-1.5 whitespace-nowrap">{o.launchDay ? fmtDay(o.launchDay) : '—'}</td>
                  <td className="py-1 px-1.5 text-right whitespace-nowrap">{fmtMoney(o.amount)}</td>
                  <td className="py-1 px-1.5 text-right whitespace-nowrap">{fmtMoney(o.paid)}</td>
                  <td className="py-1 px-1.5 text-right whitespace-nowrap">{fmtMoney(o.shippedItems)}</td>
                  <td className="py-1 px-1.5 whitespace-nowrap">{STATE[o.state]}</td>
                  <td className="py-1 px-1.5 text-right whitespace-nowrap">{o.balance === 0 ? '—' : `${fmtMoney(Math.abs(o.balance))} ${o.balance > 0 ? 'мы' : 'они'}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="pdf-keep text-[12px] text-[#4b4b47] space-y-1">
        <h3 className="text-[14px] font-semibold text-[#111110]">На чём основан расчёт</h3>
        <p>Отгрузка считается по факту отгрузок в приложении, а не по УПД, поэтому бухгалтерский акт может отличаться.</p>
        {notes.bankFrom && notes.bankTo && <p>Деньги: выписка ООО с {fmtDay(notes.bankFrom)} по {fmtDay(notes.bankTo)}. До и после этих дат берутся отметки об оплате.{doc.to > notes.bankTo ? ` Переводы после ${fmtDay(notes.bankTo)} появятся, когда загрузят выписку.` : ''}</p>}
        {notes.ledgerFrom && <p>По изделиям отгрузка записывается с {fmtDay(notes.ledgerFrom)}. Раньше заказ отмечался отгруженным целиком.</p>}
        {notes.undatedOrders > 0 && <p>{notes.undatedOrders} зак. на {fmtMoney(notes.undatedAmount)} отмечены отгруженными без даты: в итог они входят, в отгрузку конкретного дня нет.</p>}
        {notes.settled && notes.settled.orders > 0 && <p>Заказы, запущенные до {fmtDay(notes.settled.before)}, считаются закрытыми: с этой даты начат акт бухгалтера, а оплат тех месяцев в приложении нет. Это {notes.settled.orders} зак. на {fmtMoney(notes.settled.amount)}.</p>}
        {notes.archived.orders > 0 && <p>Заказы в архиве не считаются: {notes.archived.orders} зак. на {fmtMoney(notes.archived.amount)}.</p>}
      </section>
    </div>
  )
}
