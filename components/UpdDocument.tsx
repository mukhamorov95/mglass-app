'use client'

import { forwardRef } from 'react'
import { SELLER_B2B } from '@/lib/companyRequisites'
import { itemName, type InvoiceOrder, type InvoiceRequisites } from '@/components/InvoiceDocument'
import { updDocDate, updLines } from '@/lib/b2b/updLines'
import type { UpdRegistered } from '@/lib/b2b/updRegistry'

// A11: Универсальный передаточный документ (статус 1). Раскладка — по подписанным УПД
// компании (№ 455, 463, 519, 532, 08–09.2026; форма в ред. ПП от 23.01.2026 № 26): те же строки,
// графы, подписи. Строки и итоги — lib/b2b/updLines.ts. Факсимиле не ставим (решение 07.10).

const money2 = (n: number) => (n ?? 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = (s: string) => new Date(s).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric' })
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
function longDate(s: string) {
  const [d, m, y] = fmtDate(s).split('.')
  return `«${d}» ${MONTHS[Number(m) - 1]} ${y} г.`
}
function parseNotes(notes: string | null): Record<string, unknown> {
  if (!notes) return {}
  try { const p = JSON.parse(notes); if (typeof p === 'object' && p !== null) return p } catch {}
  return {}
}

const UpdDocument = forwardRef<HTMLDivElement, {
  order: InvoiceOrder; requisites: InvoiceRequisites; buyerName: string
  // Сквозной номер из реестра (этап 5, не включён: серию ведёт бухгалтерская программа).
  registered?: UpdRegistered | null
}>(function UpdDocument({ order, requisites: req, buyerName, registered = null }, ref) {
  const orderNum = order.custom_number?.trim() || String(order.id).padStart(5, '0')
  const num = registered ? String(registered.number) : orderNum
  const notes = parseNotes(order.notes)
  const live = updDocDate(notes, order.created_at)
  const docDate = registered?.doc_date ?? live.date
  const source = registered ? 'shipped' : live.source
  const { lines, totals } = updLines(order, docDate)

  const buyer = req.full_name || buyerName
  const buyerInnKpp = [req.inn, req.kpp].filter(Boolean).join('/')
  const sellerInnKpp = `${SELLER_B2B.inn}/${SELLER_B2B.kpp}`
  const contract = req.supply_contract_no
    ? `Договор поставки № ${req.supply_contract_no}${req.supply_contract_date ? ` от ${fmtDate(req.supply_contract_date)}` : ''}`
    // Без рамочного договора бухгалтерия пишет так (УПД № 532: «Договор поставки № 05544 от 25.09.2026»
    // — номер заказа и дата просчёта/счёта-спецификации).
    : `Договор поставки № ${orderNum} от ${fmtDate((notes.quote_date as string) || order.created_at)}`

  const field = (label: string, value: React.ReactNode, n: string) => (
    <tr>
      <td className="pr-2 font-semibold align-top whitespace-nowrap">{label}</td>
      <td className="border-b border-[#999] align-top w-full">{value}</td>
      <td className="pl-1 align-top text-[9px] whitespace-nowrap">({n})</td>
    </tr>
  )
  const sign = (who: string, name: string, n: string) => (
    <div>
      <div className="grid grid-cols-3 gap-2 items-end mt-3">
        <span className="border-b border-[#333] text-center">{who || ' '}</span>
        <span className="border-b border-[#333]">&nbsp;</span>
        <span className="border-b border-[#333] text-center">{name || ' '}</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-[8px] text-[#555] text-center">
        <span>(должность)</span><span>(подпись)</span><span>(ф.и.о.) [{n}]</span>
      </div>
    </div>
  )

  return (
    <>
      <style>{`
        #upd-document, #upd-document * { font-family: Arial, Helvetica, sans-serif; color: #111; }
        #upd-document table { border-collapse: collapse; }
        #upd-document .g { width: 100%; }
        #upd-document .g td, #upd-document .g th { border: 1px solid #333; padding: 2px 3px; font-size: 9px; vertical-align: top; }
        #upd-document .g th { font-weight: 400; text-align: center; vertical-align: middle; }
        @media print {
          body * { visibility: hidden !important; }
          #upd-document, #upd-document * { visibility: visible !important; }
          #upd-document { position: fixed; top: 0; left: 0; width: 100%; }
          .no-print { display: none !important; }
          @page { margin: 8mm; size: A4 landscape; }
        }
      `}</style>

      {registered && registered.doc_date.slice(0, 10) !== live.date.slice(0, 10) && (
        <div className="no-print max-w-[1100px] mx-auto mt-3 px-4 py-2 rounded-lg border border-[#e4e4e0] bg-white text-[12px] text-[#6b6b66]">
          УПД № {registered.number} уже выдан с датой {fmtDate(registered.doc_date)} — номер и дата закреплены. По заказу сейчас дата {fmtDate(live.date)}.
        </div>
      )}
      {source !== 'shipped' && (
        <div className="no-print max-w-[1100px] mx-auto mt-3 px-4 py-2 rounded-lg border border-amber-300 bg-amber-50 text-[12px] text-amber-800">
          Заказ не отмечен «Отгружен» — дата УПД взята из даты {source === 'launched' ? 'запуска' : 'просчёта'} ({fmtDate(docDate)}).
          Отметьте отгрузку в заказах, и дата станет датой отгрузки.
        </div>
      )}

      <div ref={ref} id="upd-document" className="max-w-[1100px] mx-auto my-6 bg-white shadow-xl px-6 py-5 text-[10px] leading-snug print:shadow-none print:my-0">
        <div className="flex gap-3">
          <div className="w-[120px] shrink-0 border-r border-[#333] pr-2">
            <div className="font-bold leading-tight">Универсальный передаточный документ</div>
            <div className="mt-3">Статус: <span className="inline-block border border-[#333] px-2 font-bold">1</span></div>
            <div className="mt-2 text-[8px] leading-tight">1 – счет-фактура и передаточный документ (акт)<br />2 – передаточный документ (акт)</div>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[13px] font-bold">Счет-фактура № {num} от {fmtDate(docDate)} <span className="text-[9px] font-normal">(1)</span></div>
                <div className="mt-0.5">Исправление № ____ от ________ <span className="text-[9px]">(1а)</span></div>
              </div>
              <div className="text-[8px] text-right max-w-[360px] leading-tight">
                Приложение № 1 к постановлению Правительства Российской Федерации от 26 декабря 2011 г. № 1137
                (в редакции постановления Правительства Российской Федерации от 23 января 2026 г. № 26)
              </div>
            </div>

            <div className="grid grid-cols-2 gap-x-6 mt-2">
              <table><tbody>
                {field('Продавец:', SELLER_B2B.nameFull, '2')}
                {field('Адрес:', SELLER_B2B.legalAddressFull, '2а')}
                {field('ИНН/КПП продавца:', sellerInnKpp, '2б')}
                {field('Грузоотправитель и его адрес:', 'он же', '3')}
                {field('Грузополучатель и его адрес:', [buyer, req.legal_address].filter(Boolean).join(' '), '4')}
                {field('К платежно-расчетному документу', '№ ______ от ______', '5')}
                {field('Документ об отгрузке:', `Универсальный передаточный документ, № ${num} от ${fmtDate(docDate)}`, '5а')}
              </tbody></table>
              <table><tbody>
                {field('Покупатель:', buyer || <span className="text-[#b00]">реквизиты покупателя не заполнены</span>, '6')}
                {field('Адрес:', req.legal_address || '', '6а')}
                {field('ИНН/КПП покупателя:', buyerInnKpp, '6б')}
                {field('Валюта: наименование, код', 'российский рубль, 643', '7')}
                {field('Идентификатор государственного контракта, договора (соглашения) (при наличии):', '', '8')}
              </tbody></table>
            </div>
            <div className="mt-1 text-[9px]">
              К счету-фактуре (счетам-фактурам), выставленному (выставленным) при получении оплаты, частичной оплаты или иных платежей
              в счет предстоящих поставок товаров (выполнения работ, оказания услуг), передачи имущественных прав № ______ от ______
              исправление № ______ от ______ (5б)
            </div>
          </div>
        </div>

        <table className="g mt-2">
          <thead>
            <tr>
              <th rowSpan={2} style={{ width: 44 }}>Код товара/ работ, услуг</th>
              <th rowSpan={2} style={{ width: 22 }}>№ п/п</th>
              <th rowSpan={2}>Наименование товара (описание выполненных работ, оказанных услуг), имущественного права</th>
              <th rowSpan={2} style={{ width: 36 }}>Код вида товара</th>
              <th colSpan={2}>Единица измерения</th>
              <th rowSpan={2} style={{ width: 38 }}>Коли-чество (объем)</th>
              <th rowSpan={2} style={{ width: 62 }}>Цена (тариф) за единицу измерения</th>
              <th rowSpan={2} style={{ width: 70 }}>Стоимость товаров (работ, услуг), имущественных прав без налога – всего</th>
              <th rowSpan={2} style={{ width: 40 }}>В том числе сумма акциза</th>
              <th rowSpan={2} style={{ width: 34 }}>Нало-говая ставка</th>
              <th rowSpan={2} style={{ width: 62 }}>Сумма налога, предъяв-ляемая покупателю</th>
              <th rowSpan={2} style={{ width: 70 }}>Стоимость товаров (работ, услуг), имущественных прав с налогом – всего</th>
              <th colSpan={2}>Страна происхождения товара</th>
              <th rowSpan={2} style={{ width: 70 }}>Регистрационный номер декларации на товары или регистрационный номер партии товара, подлежащего прослеживаемости</th>
            </tr>
            <tr>
              <th style={{ width: 28 }}>код</th>
              <th style={{ width: 36 }}>условное обозна-чение (нацио-нальное)</th>
              <th style={{ width: 32 }}>Цифро-вой код</th>
              <th style={{ width: 40 }}>Краткое наиме-нование</th>
            </tr>
            <tr>
              {['А', '1', '1а', '1б', '2', '2а', '3', '4', '5', '6', '7', '8', '9', '10', '10а', '11'].map(c => <th key={c}>{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td></td>
                <td className="text-center">{i + 1}</td>
                <td>{itemName(order.items[i])}</td>
                <td></td>
                <td className="text-center">796</td>
                <td className="text-center">шт</td>
                <td className="text-center">{l.qty}</td>
                <td className="text-right">{money2(l.priceNoVat)}</td>
                <td className="text-right">{money2(l.sumNoVat)}</td>
                <td className="text-center">без акциза</td>
                <td className="text-center">{l.vatRate}%</td>
                <td className="text-right">{money2(l.vat)}</td>
                <td className="text-right">{money2(l.sumIncVat)}</td>
                <td></td><td></td><td></td>
              </tr>
            ))}
            <tr>
              <td colSpan={8} className="font-bold">Всего к оплате (9)</td>
              <td className="text-right font-bold">{money2(totals.sumNoVat)}</td>
              <td colSpan={2} className="text-center">Х</td>
              <td className="text-right font-bold">{money2(totals.vat)}</td>
              <td className="text-right font-bold">{money2(totals.sumIncVat)}</td>
              <td colSpan={3}></td>
            </tr>
          </tbody>
        </table>

        <div className="flex gap-3 mt-3">
          <div className="w-[120px] shrink-0 border-r border-[#333] pr-2">Документ составлен на ____ листах</div>
          <div className="flex-1 grid grid-cols-2 gap-x-8">
            <div>
              <div>Руководитель организации или иное уполномоченное лицо</div>
              <div className="grid grid-cols-2 gap-2 items-end mt-3">
                <span className="border-b border-[#333]">&nbsp;</span>
                <span className="border-b border-[#333] text-center">{SELLER_B2B.directorShort}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[8px] text-[#555] text-center"><span>(подпись)</span><span>(ф.и.о.)</span></div>
            </div>
            <div>
              <div>Главный бухгалтер или иное уполномоченное лицо</div>
              <div className="grid grid-cols-2 gap-2 items-end mt-3">
                <span className="border-b border-[#333]">&nbsp;</span>
                <span className="border-b border-[#333]">&nbsp;</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[8px] text-[#555] text-center"><span>(подпись)</span><span>(ф.и.о.)</span></div>
            </div>
            <div className="col-span-2 mt-2">
              <div>Индивидуальный предприниматель или иное уполномоченное лицо</div>
              <div className="grid grid-cols-3 gap-2 items-end mt-3">
                <span className="border-b border-[#333]">&nbsp;</span><span className="border-b border-[#333]">&nbsp;</span><span className="border-b border-[#333]">&nbsp;</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-[8px] text-[#555] text-center">
                <span>(подпись)</span><span>(ф.и.о.)</span><span>(ОГРНИП и дата присвоения)</span>
              </div>
            </div>
          </div>
        </div>

        <table className="w-full mt-3"><tbody>
          <tr><td className="whitespace-nowrap pr-2">Основание передачи (сдачи) / получения (приемки)</td><td className="border-b border-[#999] w-full">{contract}</td><td className="pl-1 text-[9px]">[10]</td></tr>
          <tr><td className="whitespace-nowrap pr-2">Данные о транспортировке и грузе</td><td className="border-b border-[#999]">&nbsp;</td><td className="pl-1 text-[9px]">[11]</td></tr>
        </tbody></table>

        <div className="grid grid-cols-2 gap-x-8 mt-3">
          <div>
            <div className="font-semibold">Товар (груз) передал / услуги, результаты работ, права сдал</div>
            {sign(SELLER_B2B.directorTitle, SELLER_B2B.directorShort, '12')}
            <div className="mt-2">Дата отгрузки, передачи (сдачи) {source === 'shipped' ? longDate(docDate) : '«___» __________ 20__ г.'} [13]</div>
            <div className="mt-2">Иные сведения об отгрузке, передаче <span className="inline-block w-48 border-b border-[#999]">&nbsp;</span> [14]</div>
            <div className="mt-2">Ответственный за правильность оформления факта хозяйственной жизни</div>
            {sign(SELLER_B2B.directorTitle, SELLER_B2B.directorShort, '15')}
            <div className="mt-2">Наименование экономического субъекта – составителя документа (в т.ч. комиссионера / агента)</div>
            <div className="border-b border-[#999]">{SELLER_B2B.nameFull}, {sellerInnKpp} <span className="text-[9px]">[16]</span></div>
            <div className="mt-3 pl-24">М.П.</div>
          </div>
          <div>
            <div className="font-semibold">Товар (груз) получил / услуги, результаты работ, права принял</div>
            {sign('', '', '17')}
            <div className="mt-2">Дата получения (приемки) «___» __________ 20__ г. [18]</div>
            <div className="mt-2">Иные сведения о получении, приемке <span className="inline-block w-48 border-b border-[#999]">&nbsp;</span> [19]</div>
            <div className="mt-2">Ответственный за правильность оформления факта хозяйственной жизни</div>
            {sign('', '', '20')}
            <div className="mt-2">Наименование экономического субъекта – составителя документа</div>
            <div className="border-b border-[#999]">{buyer}{buyerInnKpp ? `, ${buyerInnKpp}` : ''} <span className="text-[9px]">[21]</span></div>
            <div className="mt-3 pl-24">М.П.</div>
          </div>
        </div>
      </div>
    </>
  )
})

export default UpdDocument
