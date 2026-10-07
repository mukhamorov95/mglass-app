'use client'

import { forwardRef } from 'react'
import { SELLER_B2B } from '@/lib/companyRequisites'
import { rublesInWords } from '@/lib/numToWords'
import { itemName, type InvoiceOrder, type InvoiceRequisites } from '@/components/InvoiceDocument'
import { updDocDate, updLines } from '@/lib/b2b/updLines'
import type { UpdRegistered } from '@/lib/b2b/updRegistry'

// A11: Универсальный передаточный документ (УПД, статус 1). Печатная/PDF-форма на данных
// заказа (те же суммы, что в счёте A1). Формат для ЭДО (XML ФНС) формирует оператор (lib/edo).
// Строки и итоги — lib/b2b/updLines.ts. Решения владельца 07.10: УПД клиенту выдаётся этой
// формой; факсимиле печати и подписи не ставим — статус 1 это ещё и счёт-фактура.

const money2 = (n: number) => (n ?? 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = (s: string) => new Date(s).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric' })
function parseNotes(notes: string | null): Record<string, unknown> {
  if (!notes) return {}
  try { const p = JSON.parse(notes); if (typeof p === 'object' && p !== null) return p } catch {}
  return {}
}

const UpdDocument = forwardRef<HTMLDivElement, {
  order: InvoiceOrder; requisites: InvoiceRequisites; buyerName: string
  // Даты оплат заказа. Оплаты до отгрузки — строка 5 «К платёжно-расчётному документу».
  // Номера платёжки в учёте нет, его вписывают от руки.
  paymentDates?: string[]
  // Сквозной номер из реестра: с ним номер и дата закреплены (повторная печать — тот же документ).
  registered?: UpdRegistered | null
}>(function UpdDocument({ order, requisites: req, buyerName, paymentDates = [], registered = null }, ref) {
  const orderNum = order.custom_number?.trim() || String(order.id).padStart(5, '0')
  const num = registered ? String(registered.number) : orderNum
  const live = updDocDate(parseNotes(order.notes), order.created_at)
  const docDate = registered?.doc_date ?? live.date
  const source = registered ? 'shipped' : live.source
  const prepaymentDates = [...new Set(paymentDates.filter(d => d.slice(0, 10) <= docDate.slice(0, 10)))].sort()
  const { lines, totals } = updLines(order, docDate)
  const vatRate = lines[0]?.vatRate ?? 22

  const buyerLine = [
    req.full_name || buyerName,
    req.inn ? `ИНН ${req.inn}` : '', req.kpp ? `КПП ${req.kpp}` : '',
    req.legal_address ? `адрес: ${req.legal_address}` : '',
  ].filter(Boolean).join(', ')
  const buyerInnKpp = [req.inn, req.kpp].filter(Boolean).join(' / ')
  const contract = req.supply_contract_no
    ? `Договор поставки № ${req.supply_contract_no}${req.supply_contract_date ? ` от ${fmtDate(req.supply_contract_date)}` : ''}`
    : null

  const row = (label: string, value: React.ReactNode, n?: string) => (
    <tr>
      <td className="pr-2 font-semibold align-top whitespace-nowrap" style={{ width: 210 }}>{label}</td>
      <td className="border-b border-[#999] align-top">{value}</td>
      <td className="pl-2 align-top text-[9px] text-[#555] whitespace-nowrap" style={{ width: 30 }}>{n ? `(${n})` : ''}</td>
    </tr>
  )

  return (
    <>
      <style>{`
        #upd-document, #upd-document * { font-family: Georgia, 'Times New Roman', serif; color: #111; }
        #upd-document table { border-collapse: collapse; width: 100%; }
        #upd-document .g td, #upd-document .g th { border: 1px solid #333; padding: 3px 4px; font-size: 9.5px; }
        #upd-document .g th { background: #f0f0ee; font-weight: 700; text-align: center; }
        @media print {
          body * { visibility: hidden !important; }
          #upd-document, #upd-document * { visibility: visible !important; }
          #upd-document { position: fixed; top: 0; left: 0; width: 100%; }
          .no-print { display: none !important; }
          @page { margin: 10mm; size: A4 landscape; }
        }
      `}</style>

      {registered && registered.doc_date.slice(0, 10) !== live.date.slice(0, 10) && (
        <div className="no-print max-w-[1040px] mx-auto mt-3 px-4 py-2 rounded-lg border border-[#e4e4e0] bg-white text-[12px] text-[#6b6b66]">
          УПД № {registered.number} уже выдан с датой {fmtDate(registered.doc_date)} — номер и дата закреплены. По заказу сейчас дата {fmtDate(live.date)}.
        </div>
      )}
      {source !== 'shipped' && (
        <div className="no-print max-w-[1040px] mx-auto mt-3 px-4 py-2 rounded-lg border border-amber-300 bg-amber-50 text-[12px] text-amber-800">
          Заказ не отмечен «Отгружен» — дата УПД взята из даты {source === 'launched' ? 'запуска' : 'просчёта'} ({fmtDate(docDate)}).
          Отметьте отгрузку в заказах, и дата станет датой отгрузки.
        </div>
      )}

      <div ref={ref} id="upd-document" className="max-w-[1040px] mx-auto my-6 bg-white shadow-xl px-8 py-6 text-[11px] leading-snug print:shadow-none print:my-0">
        <div className="flex items-start justify-between">
          <div className="text-[10px]">Приложение № 1<br />к постановлению Правительства РФ<br />от 26.12.2011 № 1137 (в ред. от 02.04.2021)</div>
          <div className="text-right">
            <div className="border border-[#333] inline-block px-3 py-1 text-[12px] font-bold">Статус: 1</div>
            <div className="text-[9px] mt-0.5">1 — счёт-фактура и передаточный документ</div>
          </div>
        </div>

        <h1 className="text-center text-[15px] font-bold mt-2 mb-2">
          Универсальный передаточный документ · Счёт-фактура № {num} от {fmtDate(docDate)} <span className="text-[10px] font-normal">(1)</span>
        </h1>
        <p className="text-center text-[10px] mb-2">Исправление № — от — <span className="text-[9px]">(1а)</span></p>

        <table className="text-[10px] mb-2">
          <tbody>
            {row('Продавец:', SELLER_B2B.nameFull, '2')}
            {row('Адрес:', SELLER_B2B.legalAddress, '2а')}
            {row('ИНН/КПП продавца:', `${SELLER_B2B.inn} / ${SELLER_B2B.kpp}`, '2б')}
            {row('Грузоотправитель и его адрес:', 'он же', '3')}
            {row('Грузополучатель и его адрес:', buyerLine || '—', '4')}
            {row('К платёжно-расчётному документу:',
              prepaymentDates.length ? prepaymentDates.map(d => `№ ______ от ${fmtDate(d)}`).join('; ') : '—', '5')}
            {row('Документ об отгрузке:', `№ п/п 1–${lines.length} № ${num} от ${fmtDate(docDate)}`, '5а')}
            {row('Покупатель:', req.full_name || buyerName || <span className="text-[#b00]">реквизиты покупателя не заполнены</span>, '6')}
            {row('Адрес:', req.legal_address || '—', '6а')}
            {row('ИНН/КПП покупателя:', buyerInnKpp || '—', '6б')}
            {row('Валюта: наименование, код:', 'Российский рубль, 643', '7')}
            {row('Идентификатор государственного контракта, договора (соглашения):', '—', '8')}
          </tbody>
        </table>

        <table className="g">
          <thead>
            <tr>
              <th rowSpan={2} style={{ width: 22 }}>№ п/п</th>
              <th rowSpan={2}>Наименование товара (описание выполненных работ, оказанных услуг), имущественного права</th>
              <th colSpan={2}>Единица измерения</th>
              <th rowSpan={2} style={{ width: 40 }}>Коли-чество (объём)</th>
              <th rowSpan={2} style={{ width: 66 }}>Цена (тариф) за единицу измерения без налога</th>
              <th rowSpan={2} style={{ width: 76 }}>Стоимость товаров без налога — всего</th>
              <th rowSpan={2} style={{ width: 42 }}>В том числе сумма акциза</th>
              <th rowSpan={2} style={{ width: 38 }}>Нало-говая ставка</th>
              <th rowSpan={2} style={{ width: 70 }}>Сумма налога, предъявляемая покупателю</th>
              <th rowSpan={2} style={{ width: 80 }}>Стоимость товаров с налогом — всего</th>
              <th colSpan={2}>Страна происхождения</th>
              <th rowSpan={2} style={{ width: 60 }}>Регистрационный номер декларации / партии</th>
            </tr>
            <tr>
              <th style={{ width: 28 }}>код</th>
              <th style={{ width: 34 }}>обозна-чение</th>
              <th style={{ width: 28 }}>код</th>
              <th style={{ width: 50 }}>наимено-вание</th>
            </tr>
            <tr className="text-[8px]">
              {['А', '1', '2', '2а', '3', '4', '5', '6', '7', '8', '9', '10', '10а', '11'].map(c => <th key={c}>{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="text-center">{i + 1}</td>
                <td>{itemName(order.items[i])}</td>
                <td className="text-center">796</td>
                <td className="text-center">шт</td>
                <td className="text-center">{l.qty}</td>
                <td className="text-right">{money2(l.priceNoVat)}</td>
                <td className="text-right">{money2(l.sumNoVat)}</td>
                <td className="text-center">без акциза</td>
                <td className="text-center">{l.vatRate}%</td>
                <td className="text-right">{money2(l.vat)}</td>
                <td className="text-right">{money2(l.sumIncVat)}</td>
                <td className="text-center">—</td>
                <td className="text-center">—</td>
                <td className="text-center">—</td>
              </tr>
            ))}
            <tr>
              <td colSpan={6} className="text-right font-bold">Всего к оплате:</td>
              <td className="text-right font-bold">{money2(totals.sumNoVat)}</td>
              <td className="text-center">×</td>
              <td></td>
              <td className="text-right font-bold">{money2(totals.vat)}</td>
              <td className="text-right font-bold">{money2(totals.sumIncVat)}</td>
              <td colSpan={3}></td>
            </tr>
          </tbody>
        </table>

        <div className="mt-2 text-[10px]">
          Всего к оплате: <b>{money2(totals.sumIncVat)}</b> руб., в т.ч. НДС ({vatRate}%): {money2(totals.vat)} руб.<br />
          <b>{rublesInWords(totals.sumIncVat)}</b>
        </div>

        <div className="grid grid-cols-2 gap-8 mt-4 text-[10px]">
          <div>
            <div>Руководитель организации или иное уполномоченное лицо</div>
            <div className="flex items-end gap-2 mt-4"><span className="flex-1 border-b border-[#333]" /><span>{SELLER_B2B.director}</span></div>
            <div className="text-[8px] text-[#555] text-center">(подпись) (ф.и.о.)</div>
          </div>
          <div>
            <div>Главный бухгалтер или иное уполномоченное лицо</div>
            <div className="flex items-end gap-2 mt-4"><span className="flex-1 border-b border-[#333]" /><span className="w-48 border-b border-[#333]">&nbsp;</span></div>
            <div className="text-[8px] text-[#555] text-center">(подпись) (ф.и.о.)</div>
          </div>
        </div>

        <table className="text-[10px] mt-3">
          <tbody>
            {row('Основание передачи (сдачи) / получения (приёмки):', contract ?? `Счёт-спецификация № ${orderNum}`, '8')}
            {row('Данные о транспортировке и грузе:', '—', '9')}
          </tbody>
        </table>

        <div className="grid grid-cols-2 gap-8 mt-4 text-[10px]">
          <div>
            <div className="font-bold mb-1">Товар (груз) передал / услуги, результаты работ сдал</div>
            <div className="flex items-end gap-2 mt-4"><span className="w-32 border-b border-[#333]">&nbsp;</span><span className="flex-1 border-b border-[#333]" /><span>{SELLER_B2B.director}</span></div>
            <div className="text-[8px] text-[#555] text-center">(должность) (подпись) (ф.и.о.) (10)</div>
            <div className="mt-2">Дата отгрузки, передачи (сдачи): {source === 'shipped' ? fmtDate(docDate) : '«___» __________ 20__ г.'} (11)</div>
            <div className="mt-2">Иные сведения об отгрузке, передаче: — (12)</div>
            <div className="mt-2">Ответственный за правильность оформления факта хозяйственной жизни:</div>
            <div className="flex items-end gap-2 mt-3"><span className="w-32 border-b border-[#333]">&nbsp;</span><span className="flex-1 border-b border-[#333]" /><span>{SELLER_B2B.director}</span></div>
            <div className="text-[8px] text-[#555] text-center">(должность) (подпись) (ф.и.о.) (13)</div>
            <div className="mt-2">Наименование экономического субъекта — составителя документа: {SELLER_B2B.name}, ИНН/КПП {SELLER_B2B.inn}/{SELLER_B2B.kpp} (14)</div>
            <div className="mt-6">М.П.</div>
          </div>
          <div>
            <div className="font-bold mb-1">Товар (груз) получил / услуги, результаты работ принял</div>
            <div className="flex items-end gap-2 mt-4"><span className="flex-1 border-b border-[#333]" /><span className="flex-1 border-b border-[#333]" /><span className="flex-1 border-b border-[#333]" /></div>
            <div className="text-[8px] text-[#555] text-center">(должность) (подпись) (ф.и.о.) (15)</div>
            <div className="mt-2">Дата получения (приёмки): «___» __________ 20__ г. (16)</div>
            <div className="mt-2">Иные сведения о получении, приёмке: — (17)</div>
            <div className="mt-2">Ответственный за правильность оформления факта хозяйственной жизни:</div>
            <div className="flex items-end gap-2 mt-3"><span className="flex-1 border-b border-[#333]" /><span className="flex-1 border-b border-[#333]" /><span className="flex-1 border-b border-[#333]" /></div>
            <div className="text-[8px] text-[#555] text-center">(должность) (подпись) (ф.и.о.) (18)</div>
            <div className="mt-2">Наименование экономического субъекта — составителя документа: {req.full_name || buyerName}{buyerInnKpp ? `, ИНН/КПП ${buyerInnKpp}` : ''} (19)</div>
            <div className="mt-6">М.П.</div>
          </div>
        </div>
      </div>
    </>
  )
})

export default UpdDocument
