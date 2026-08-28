'use client'

import { forwardRef } from 'react'
import { SELLER_B2B } from '@/lib/companyRequisites'
import { rublesInWords } from '@/lib/numToWords'
import { computeInvoiceTotals, type InvoiceOrder, type InvoiceOrderItem, type InvoiceRequisites } from '@/components/InvoiceDocument'

// A11: Универсальный передаточный документ (УПД, статус 1). Первая версия — общий
// каркас на реальных данных заказа (те же суммы, что в счёте A1). Формат для ЭДО
// (XML ФНС) формирует оператор при выгрузке (lib/edo). Здесь — печатная/PDF-форма.
// НДС выделяем из суммы с НДС (ставка 22%, как в счёте-спецификации).

const VAT_RATE = 22
const money2 = (n: number) => (n ?? 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = (s: string) => new Date(s).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric' })
function parseNotes(notes: string | null): Record<string, unknown> {
  if (!notes) return {}
  try { const p = JSON.parse(notes); if (typeof p === 'object' && p !== null) return p } catch {}
  return {}
}
function itemName(it: InvoiceOrderItem): string {
  const parts: string[] = [it.materialName || 'Стекло']
  if (it.thickness) parts.push(`${it.thickness} мм`)
  if (it.hasTempering) parts.push('закалённое')
  if (it.hasFacet) parts.push(it.facetTypeMm ? `фацет ${it.facetTypeMm} мм` : 'фацет')
  let base = parts.join(', ')
  if (it.width && it.height) base += `, ${it.width}×${it.height} мм`
  return base
}
const vatOut = (incVat: number) => Math.round((incVat - incVat / (1 + VAT_RATE / 100)) * 100) / 100

const UpdDocument = forwardRef<HTMLDivElement, {
  order: InvoiceOrder; requisites: InvoiceRequisites; buyerName: string
}>(function UpdDocument({ order, requisites: req, buyerName }, ref) {
  const totals = computeInvoiceTotals(order)
  const num = order.custom_number?.trim() || String(order.id).padStart(5, '0')
  const notes = parseNotes(order.notes)
  const docDate = (notes.shipped_date as string) || (notes.launched_at as string) || order.created_at

  const buyerLine = [
    req.full_name || buyerName,
    req.inn ? `ИНН ${req.inn}` : '', req.kpp ? `КПП ${req.kpp}` : '',
    req.legal_address ? `адрес: ${req.legal_address}` : '',
  ].filter(Boolean).join(', ')

  const totalIncVat = totals.totalPay
  const totalVat = vatOut(totalIncVat)
  const totalNoVat = Math.round((totalIncVat - totalVat) * 100) / 100

  return (
    <>
      <style>{`
        #upd-document, #upd-document * { font-family: Georgia, 'Times New Roman', serif; color: #111; }
        #upd-document table { border-collapse: collapse; width: 100%; }
        #upd-document .g td, #upd-document .g th { border: 1px solid #333; padding: 3px 5px; font-size: 10px; }
        #upd-document .g th { background: #f0f0ee; font-weight: 700; text-align: center; }
        @media print {
          body * { visibility: hidden !important; }
          #upd-document, #upd-document * { visibility: visible !important; }
          #upd-document { position: fixed; top: 0; left: 0; width: 100%; }
          .no-print { display: none !important; }
          @page { margin: 10mm; size: A4 landscape; }
        }
      `}</style>

      <div ref={ref} id="upd-document" className="max-w-[1040px] mx-auto my-6 bg-white shadow-xl px-8 py-6 text-[11px] leading-snug print:shadow-none print:my-0">
        <div className="flex items-start justify-between">
          <div className="text-[10px]">Приложение № 1<br />к постановлению Правительства РФ<br />от 26.12.2011 № 1137 (в ред. от 02.04.2021)</div>
          <div className="text-right">
            <div className="border border-[#333] inline-block px-3 py-1 text-[12px] font-bold">Статус: 1</div>
            <div className="text-[9px] mt-0.5">1 — счёт-фактура и передаточный документ</div>
          </div>
        </div>

        <h1 className="text-center text-[15px] font-bold mt-2 mb-2">
          Универсальный передаточный документ № {num} от {fmtDate(docDate)}
        </h1>

        <table className="text-[10px] mb-2">
          <tbody>
            <tr><td className="pr-2 font-semibold align-top" style={{ width: 150 }}>Продавец:</td>
              <td>{SELLER_B2B.nameFull}, ИНН {SELLER_B2B.inn}, КПП {SELLER_B2B.kpp}, {SELLER_B2B.legalAddress}</td></tr>
            <tr><td className="pr-2 font-semibold align-top">Грузоотправитель:</td><td>он же</td></tr>
            <tr><td className="pr-2 font-semibold align-top">Покупатель:</td>
              <td>{buyerLine || <span className="text-[#b00]">реквизиты покупателя не заполнены</span>}</td></tr>
            <tr><td className="pr-2 font-semibold align-top">Грузополучатель:</td><td>он же</td></tr>
            {req.supply_contract_no && <tr><td className="pr-2 font-semibold align-top">Основание:</td><td>Договор поставки № {req.supply_contract_no}</td></tr>}
          </tbody>
        </table>

        <table className="g">
          <thead>
            <tr>
              <th style={{ width: 24 }}>№</th>
              <th>Наименование товара (работ, услуг)</th>
              <th style={{ width: 34 }}>Ед.</th>
              <th style={{ width: 44 }}>Кол-во</th>
              <th style={{ width: 70 }}>Цена за ед.</th>
              <th style={{ width: 82 }}>Стоимость без НДС</th>
              <th style={{ width: 44 }}>Ставка НДС</th>
              <th style={{ width: 74 }}>Сумма НДС</th>
              <th style={{ width: 86 }}>Стоимость с НДС</th>
            </tr>
          </thead>
          <tbody>
            {totals.items.map((it, i) => {
              const qty = it.quantity || 1
              const sumIncVat = totals.lineSums[i]
              const vat = vatOut(sumIncVat)
              const noVat = Math.round((sumIncVat - vat) * 100) / 100
              const price = qty ? sumIncVat / qty : sumIncVat
              return (
                <tr key={i}>
                  <td className="text-center">{i + 1}</td>
                  <td>{itemName(it)}</td>
                  <td className="text-center">шт.</td>
                  <td className="text-center">{qty}</td>
                  <td className="text-right">{money2(price)}</td>
                  <td className="text-right">{money2(noVat)}</td>
                  <td className="text-center">{VAT_RATE}%</td>
                  <td className="text-right">{money2(vat)}</td>
                  <td className="text-right">{money2(sumIncVat)}</td>
                </tr>
              )
            })}
            <tr>
              <td colSpan={5} className="text-right font-bold">Итого:</td>
              <td className="text-right font-bold">{money2(totalNoVat)}</td>
              <td></td>
              <td className="text-right font-bold">{money2(totalVat)}</td>
              <td className="text-right font-bold">{money2(totalIncVat)}</td>
            </tr>
          </tbody>
        </table>

        <div className="mt-2 text-[10px]">
          Всего к оплате: <b>{money2(totalIncVat)}</b> руб., в т.ч. НДС ({VAT_RATE}%): {money2(totalVat)} руб.<br />
          <b>{rublesInWords(totalIncVat)}</b>
        </div>

        <div className="grid grid-cols-2 gap-8 mt-6 text-[10px]">
          <div>
            <div className="font-bold mb-1">Товар (груз) передал / услуги, результаты работ сдал</div>
            <img src="/seal-ooo.png" alt="Подпись и печать" style={{ height: 90, opacity: 0.94 }} />{/* eslint-disable-line @next/next/no-img-element */}
            <div className="mt-0.5">{SELLER_B2B.director}</div>
            <div className="mt-2">Дата отгрузки, передачи (сдачи) «___» __________ {new Date(docDate).getFullYear()} г.</div>
          </div>
          <div>
            <div className="font-bold mb-1">Товар (груз) получил / услуги, результаты работ принял</div>
            <div style={{ height: 90 }} />
            <div className="border-t border-[#333] pt-0.5">подпись / расшифровка</div>
            <div className="mt-2">Дата получения (приёмки) «___» __________ 20__ г.</div>
          </div>
        </div>
      </div>
    </>
  )
})

export default UpdDocument
