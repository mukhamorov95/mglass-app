'use client'

import { forwardRef, useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { SELLER_B2B } from '@/lib/companyRequisites'
import { paymentQrStringFor } from '@/lib/paymentQr'
import { rublesInWords } from '@/lib/numToWords'

// Единый рендер «Счёт-спецификации» — один источник правды для документа.
// Используют менеджерская страница (/b2b-quotes/[id]/invoice) и кабинет партнёра
// (/partner/order/[id]/invoice). Числа берутся из сохранённого заказа b2b_orders —
// поэтому счёт клиента и наш счёт идентичны по построению. Компонент чистый:
// принимает заказ + реквизиты покупателя, сам считает итоги и QR оплаты.

export type InvoiceOrderItem = {
  materialName?: string; category?: string; thickness?: number; width?: number; height?: number
  quantity?: number; saleIncVat?: number; hasTempering?: boolean; hasFacet?: boolean
  facetTypeMm?: number; shape?: string; comment?: string; services?: { id: number; name: string; cost: number }[]
  // Договорная цена строки (вкл. НДС, ПОСЛЕ скидки). Если стоит — скидка к ней не применяется.
  manualTotal?: number | null
}
export type InvoiceOrder = {
  id: number; custom_number: string | null; discount_percent: number
  items: InvoiceOrderItem[]; total_sale_inc_vat: number; total_after_discount: number
  notes: string | null; created_at: string
}
export type InvoiceRequisites = {
  full_name: string; inn: string; kpp: string; ogrn: string; legal_address: string
  bank_account: string; bank_name: string; bik: string; corr_account: string
  supply_contract_no: string; supply_contract_date: string
}

const money2 = (n: number) => (n ?? 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = (s: string) => new Date(s).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
const fmtDateLong = (s: string) => new Date(s).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) + ' г.'
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
  const svc = (it.services ?? []).map(s => s.name).filter(Boolean)
  let base = parts.join(', ')
  if (it.width && it.height) base += `, ${it.width}×${it.height} мм`
  if (svc.length) base += `; ${svc.join(', ')}`
  return base
}

// Те же итоги, что в менеджерском счёте: разницу округления сажаем в последнюю строку.
export function computeInvoiceTotals(order: InvoiceOrder) {
  const items = order.items || []
  const discount = order.discount_percent || 0
  const totalBase = order.total_sale_inc_vat || items.reduce((s, i) => s + (i.saleIncVat ?? 0), 0)
  const totalPay = order.total_after_discount || totalBase
  const vat = Math.round(totalPay * 22 / 122 * 100) / 100
  // Договорная цена строки важнее прайса со скидкой — иначе счёт разойдётся
  // с просчётом там, где менеджер правил цены руками (или корректировал итог).
  const lineSums = items.map(it => it.manualTotal != null
    ? Math.round(Number(it.manualTotal) * 100) / 100
    : Math.round((it.saleIncVat ?? 0) * (1 - discount / 100) * 100) / 100)
  if (lineSums.length) {
    const raw = Math.round(lineSums.reduce((a, b) => a + b, 0) * 100) / 100
    lineSums[lineSums.length - 1] = Math.round((lineSums[lineSums.length - 1] + (totalPay - raw)) * 100) / 100
  }
  return { items, discount, totalBase, totalPay, vat, lineSums, discountSum: totalBase - totalPay }
}

const InvoiceDocument = forwardRef<HTMLDivElement, {
  order: InvoiceOrder; requisites: InvoiceRequisites; buyerName: string
}>(function InvoiceDocument({ order, requisites: req, buyerName }, ref) {
  const totals = useMemo(() => computeInvoiceTotals(order), [order])
  const [qr, setQr] = useState('')

  const num = order.custom_number?.trim() || String(order.id).padStart(5, '0')
  useEffect(() => {
    const s = paymentQrStringFor(SELLER_B2B, totals.totalPay, `Оплата по счёту-спецификации № ${num}`)
    QRCode.toDataURL(s, { margin: 0, width: 240 }).then(setQr).catch(() => {})
  }, [totals.totalPay, num])

  const notes = parseNotes(order.notes)
  const quoteDate = (notes.quote_date as string) || order.created_at
  const prodDays = (notes.production_days as string) || '7'
  const buyerLine = [
    req.full_name || buyerName,
    req.inn ? `ИНН ${req.inn}` : '', req.kpp ? `КПП ${req.kpp}` : '', req.ogrn ? `ОГРН ${req.ogrn}` : '',
    req.legal_address ? `адрес: ${req.legal_address}` : '', req.bank_account ? `р/с ${req.bank_account}` : '',
    req.bank_name ? `${req.bank_name}` : '', req.bik ? `БИК ${req.bik}` : '', req.corr_account ? `к/с ${req.corr_account}` : '',
  ].filter(Boolean).join(', ')

  return (
    <>
      <style>{`
        #invoice-document, #invoice-document * { font-family: Georgia, 'Times New Roman', serif; color: #111; }
        #invoice-document table { border-collapse: collapse; width: 100%; }
        #invoice-document .bank td, #invoice-document .items th, #invoice-document .items td { border: 1px solid #333; padding: 4px 6px; }
        #invoice-document .items th { background: #f0f0ee; font-weight: 700; font-size: 11px; text-align: center; }
        #invoice-document .items td { font-size: 11px; vertical-align: top; }
        @media print {
          body * { visibility: hidden !important; }
          #invoice-document, #invoice-document * { visibility: visible !important; }
          #invoice-document { position: fixed; top: 0; left: 0; width: 100%; }
          .no-print { display: none !important; }
          @page { margin: 12mm; size: A4; }
        }
      `}</style>

      <div ref={ref} id="invoice-document" className="max-w-[820px] mx-auto my-6 bg-white shadow-xl px-9 py-8 text-[12px] leading-snug print:shadow-none print:my-0">
        <div className="text-[10px] text-[#333] mb-3 leading-tight">
          <b>ВНИМАНИЕ!</b> Счёт-спецификация действительна в течение 5 банковских дней. Оплата настоящего счёта означает согласие Покупателя с условиями и подтверждение правильности его оформления (акцепт).
        </div>

        <div className="mb-2">
          <b className="text-[13px] uppercase">{SELLER_B2B.nameFull}</b><br />
          <span className="text-[11px]">{SELLER_B2B.legalAddress}</span>
        </div>

        <div className="relative">
          <div className="text-center text-[11px] font-bold mb-1">Реквизиты Поставщика для оплаты Покупателем</div>
          <table className="bank text-[11px]" style={{ width: '68%' }}>
            <tbody>
              <tr>
                <td style={{ width: '42%' }}>Банк получателя<br /><b>{SELLER_B2B.bankName}</b></td>
                <td style={{ width: '20%' }}>БИК</td>
                <td>{SELLER_B2B.bik}</td>
              </tr>
              <tr>
                <td rowSpan={2} />
                <td>Корр. сч. №</td>
                <td>{SELLER_B2B.corrAccount}</td>
              </tr>
              <tr>
                <td>Сч. №</td>
                <td>{SELLER_B2B.account}</td>
              </tr>
              <tr>
                <td>Получатель<br />ИНН {SELLER_B2B.inn} КПП {SELLER_B2B.kpp}<br />{SELLER_B2B.name}</td>
                <td>Сч. №</td>
                <td>{SELLER_B2B.account}</td>
              </tr>
            </tbody>
          </table>
          {qr && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt="QR оплаты" className="absolute top-5 right-0" style={{ width: 110, height: 110 }} />
          )}
        </div>

        <h1 className="text-center text-[16px] font-bold mt-4 mb-1">
          СЧЁТ-СПЕЦИФИКАЦИЯ № {num} <span className="text-red-600">от {fmtDate(quoteDate)}</span>
        </h1>
        {req.supply_contract_no && (
          <div className="text-center text-[12px] mb-2">
            к Договору поставки № {req.supply_contract_no}{req.supply_contract_date ? ` от ${fmtDateLong(req.supply_contract_date)}` : ''}
          </div>
        )}

        <table className="mt-3 text-[11px]">
          <tbody>
            <tr>
              <td className="align-top pr-2 font-semibold" style={{ width: 90 }}>Поставщик:</td>
              <td>{SELLER_B2B.name}, ИНН {SELLER_B2B.inn}, КПП {SELLER_B2B.kpp}, ОГРН {SELLER_B2B.ogrn}. Адрес: {SELLER_B2B.legalAddress}. Р/с {SELLER_B2B.account} в {SELLER_B2B.bankName}, БИК {SELLER_B2B.bik}, к/с {SELLER_B2B.corrAccount}.</td>
            </tr>
            <tr>
              <td className="align-top pr-2 font-semibold pt-1">Покупатель:</td>
              <td className="pt-1">{buyerLine || <span className="text-[#b00]">реквизиты покупателя не заполнены</span>}</td>
            </tr>
          </tbody>
        </table>

        <table className="items mt-3">
          <thead>
            <tr>
              <th style={{ width: 26 }}>№</th>
              <th>Наименование товара</th>
              <th style={{ width: 40 }}>Ед.</th>
              <th style={{ width: 44 }}>Кол-во</th>
              <th style={{ width: 74 }}>Цена</th>
              <th style={{ width: 84 }}>Сумма без скидки</th>
              <th style={{ width: 52 }}>Скидка</th>
              <th style={{ width: 84 }}>Сумма</th>
            </tr>
          </thead>
          <tbody>
            {totals.items.map((it, i) => {
              const qty = it.quantity || 1
              const sumNoDisc = it.saleIncVat ?? 0
              const price = qty ? sumNoDisc / qty : sumNoDisc
              const sum = totals.lineSums[i]
              return (
                <tr key={i}>
                  <td className="text-center">{i + 1}</td>
                  <td>{itemName(it)}{it.comment ? <span className="block text-[9px] text-[#666] italic mt-0.5">{it.comment}</span> : null}</td>
                  <td className="text-center">шт.</td>
                  <td className="text-center">{qty}</td>
                  <td className="text-right">{money2(price)}</td>
                  <td className="text-right">{money2(sumNoDisc)}</td>
                  {/* Скидка строки считается из фактических сумм: договорные цены дают свой процент */}
                  <td className="text-center">{sumNoDisc > 0 && sum < sumNoDisc ? `${Math.round((1 - sum / sumNoDisc) * 1000) / 10}%` : '—'}</td>
                  <td className="text-right">{money2(sum)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>

        <table className="mt-1 text-[12px]" style={{ width: '48%', marginLeft: 'auto' }}>
          <tbody>
            <tr><td className="text-right pr-3 py-0.5">Итого:</td><td className="text-right font-semibold" style={{ width: 110 }}>{money2(totals.totalPay)}</td></tr>
            <tr><td className="text-right pr-3 py-0.5">В том числе НДС (22%):</td><td className="text-right">{money2(totals.vat)}</td></tr>
            <tr><td className="text-right pr-3 py-0.5 font-bold">Всего к оплате:</td><td className="text-right font-bold">{money2(totals.totalPay)}</td></tr>
          </tbody>
        </table>

        <div className="mt-2 text-[11px]">
          Всего наименований {totals.items.length}, на сумму {money2(totals.totalPay)} руб.<br />
          <b>{rublesInWords(totals.totalPay)}</b>
        </div>

        <ol className="mt-3 text-[10px] text-[#333] leading-snug list-decimal pl-4 space-y-0.5">
          <li>Общая стоимость Товара по Спецификации: {money2(totals.totalPay)} руб., в т.ч. НДС 22%.</li>
          <li>Предоплата за Товар производится в размере 100% от суммы настоящей Счёт-Спецификации.</li>
          <li>Срок изготовления: {prodDays} рабочих дней с даты поступления оплаты.</li>
          <li>Счёт-Спецификация составлена в двух идентичных экземплярах, имеющих равную юридическую силу, по одному для каждой из Сторон.</li>
          <li>Стороны признают юридическую силу сканированной копии Спецификации с подписями Сторон, направленной по электронной почте либо через сервис обмена сообщениями (мессенджер), до даты получения оригинала.</li>
        </ol>

        <div className="mt-6 flex items-end justify-between text-[11px]">
          <div>
            <div className="font-semibold mb-1">Поставщик</div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/seal-ooo.png" alt="Подпись и печать" style={{ height: 118, marginLeft: 6, opacity: 0.94 }} />
            <div className="mt-0.5">/ {SELLER_B2B.director} /</div>
          </div>
          <div>
            <div className="font-semibold mb-6">Покупатель</div>
            <span className="border-b border-[#333] inline-block" style={{ width: 200 }}>&nbsp;</span>
            <div className="mt-1">/ ________________ /</div>
          </div>
        </div>
      </div>
    </>
  )
})

export default InvoiceDocument
