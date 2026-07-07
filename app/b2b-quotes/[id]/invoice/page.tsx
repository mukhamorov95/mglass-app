'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import QRCode from 'qrcode'
import { SELLER_B2B } from '@/lib/companyRequisites'
import { paymentQrStringFor } from '@/lib/paymentQr'
import { rublesInWords } from '@/lib/numToWords'

// ─── Types ──────────────────────────────────────────────────────────────────
type OrderItem = {
  materialName?: string
  category?: string
  thickness?: number
  width?: number
  height?: number
  quantity?: number
  totalAreaNet?: number
  saleIncVat?: number
  hasTempering?: boolean
  hasFacet?: boolean
  facetTypeMm?: number
  shape?: string
  comment?: string
  services?: { id: number; name: string; cost: number }[]
}
type Order = {
  id: number
  client_id: number | null
  client_name: string
  custom_number: string | null
  client_order_number: string | null
  discount_percent: number
  items: OrderItem[]
  total_sale_inc_vat: number
  total_after_discount: number
  notes: string | null
  created_at: string
}
type Client = {
  id: number
  name: string
  full_name?: string | null
  inn?: string | null
  kpp?: string | null
  ogrn?: string | null
  legal_address?: string | null
  bank_account?: string | null
  bank_name?: string | null
  bik?: string | null
  corr_account?: string | null
  supply_contract_no?: string | null
  supply_contract_date?: string | null
}
type Requisites = {
  full_name: string; inn: string; kpp: string; ogrn: string; legal_address: string
  bank_account: string; bank_name: string; bik: string; corr_account: string
  supply_contract_no: string; supply_contract_date: string
}

// ─── Helpers ────────────────────────────────────────────────────────────────
const EMPTY: Requisites = { full_name: '', inn: '', kpp: '', ogrn: '', legal_address: '', bank_account: '', bank_name: '', bik: '', corr_account: '', supply_contract_no: '', supply_contract_date: '' }

function money2(n: number): string {
  return (n ?? 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function fmtDateLong(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) + ' г.'
}
function parseNotes(notes: string | null): Record<string, unknown> {
  if (!notes) return {}
  try { const p = JSON.parse(notes); if (typeof p === 'object' && p !== null) return p } catch {}
  return {}
}
function itemName(it: OrderItem): string {
  const parts: string[] = []
  parts.push(it.materialName || 'Стекло')
  if (it.thickness) parts.push(`${it.thickness} мм`)
  if (it.hasTempering) parts.push('закалённое')
  if (it.hasFacet) parts.push(it.facetTypeMm ? `фацет ${it.facetTypeMm} мм` : 'фацет')
  const svc = (it.services ?? []).map(s => s.name).filter(Boolean)
  let base = parts.join(', ')
  if (it.width && it.height) base += `, ${it.width}×${it.height} мм`
  if (svc.length) base += `; ${svc.join(', ')}`
  return base
}

// ─── Component ──────────────────────────────────────────────────────────────
export default function InvoicePage() {
  const params = useParams()
  const id = Number(params.id)

  const [order, setOrder] = useState<Order | null>(null)
  const [req, setReq] = useState<Requisites>(EMPTY)
  const [buyerName, setBuyerName] = useState('')
  const [qr, setQr] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [parseText, setParseText] = useState('')
  const [parsing, setParsing] = useState(false)
  const [showEditor, setShowEditor] = useState(true)
  const docRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!id) return
    fetch(`/api/quotes/${id}/invoice-data`)
      .then(async r => {
        if (!r.ok) { setError(r.status === 403 ? 'Нет доступа к этому расчёту' : 'Расчёт не найден'); setLoading(false); return }
        const { order: o, client } = await r.json() as { order: Order; client: Client | null }
        setOrder(o)
        setBuyerName(o.client_name || client?.name || 'Клиент')
        if (client) {
          setReq({
            full_name: client.full_name || client.name || '',
            inn: client.inn || '', kpp: client.kpp || '', ogrn: client.ogrn || '',
            legal_address: client.legal_address || '',
            bank_account: client.bank_account || '', bank_name: client.bank_name || '',
            bik: client.bik || '', corr_account: client.corr_account || '',
            supply_contract_no: client.supply_contract_no || '',
            supply_contract_date: client.supply_contract_date || '',
          })
        }
        setLoading(false)
      })
  }, [id])

  const totals = useMemo(() => {
    if (!order) return null
    const items = order.items || []
    const discount = order.discount_percent || 0
    const totalBase = order.total_sale_inc_vat || items.reduce((s, i) => s + (i.saleIncVat ?? 0), 0)
    const totalPay = order.total_after_discount || totalBase
    const vat = Math.round(totalPay * 22 / 122 * 100) / 100
    // Построчные суммы со скидкой; разницу округления сажаем в последнюю строку, чтобы столбец = Итого.
    const lineSums = items.map(it => Math.round((it.saleIncVat ?? 0) * (1 - discount / 100) * 100) / 100)
    if (lineSums.length) {
      const raw = Math.round(lineSums.reduce((a, b) => a + b, 0) * 100) / 100
      lineSums[lineSums.length - 1] = Math.round((lineSums[lineSums.length - 1] + (totalPay - raw)) * 100) / 100
    }
    return { items, discount, totalBase, totalPay, vat, lineSums, discountSum: totalBase - totalPay }
  }, [order])

  useEffect(() => {
    if (!order || !totals) return
    const num = order.custom_number?.trim() || String(order.id).padStart(5, '0')
    const s = paymentQrStringFor(SELLER_B2B, totals.totalPay, `Оплата по счёту-спецификации № ${num}`)
    QRCode.toDataURL(s, { margin: 0, width: 240 }).then(setQr).catch(() => {})
  }, [order, totals])

  async function save() {
    setSaving(true); setSaved(false)
    try {
      const r = await fetch(`/api/quotes/${id}/invoice-data`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      })
      if (r.ok) { setSaved(true); setTimeout(() => setSaved(false), 1800) }
    } finally { setSaving(false) }
  }

  function applyCustomer(c: Record<string, string | undefined>) {
    setReq(prev => ({
      ...prev,
      full_name: c.name || c.fio || prev.full_name,
      inn: c.inn || prev.inn, kpp: c.kpp || prev.kpp, ogrn: c.ogrn || prev.ogrn,
      legal_address: c.legal_address || c.address || prev.legal_address,
      bank_account: c.account || prev.bank_account, bank_name: c.bank || prev.bank_name,
      bik: c.bik || prev.bik, corr_account: c.corr_account || prev.corr_account,
    }))
  }

  async function aiParse() {
    if (!parseText.trim()) return
    setParsing(true)
    try {
      const r = await fetch('/api/ai/parse-customer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: parseText }),
      }).then(x => x.json())
      if (r.customer) applyCustomer(r.customer)
    } finally { setParsing(false) }
  }

  // Карточка предприятия файлом (PDF/фото): разбор → поля → автосохранение к клиенту,
  // дальше все счета по этому клиенту заполняются сами.
  async function parseCardFile(file: File) {
    setParsing(true)
    try {
      const readB64 = (f: Blob) => new Promise<string>((res, rej) => {
        const rd = new FileReader()
        rd.onload = () => res(String(rd.result).split(',')[1] || '')
        rd.onerror = rej
        rd.readAsDataURL(f)
      })
      let payload: Record<string, string>
      if (file.type === 'application/pdf') payload = { pdf: await readB64(file) }
      else {
        const url = URL.createObjectURL(file)
        try {
          const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url })
          const MAX = 2000
          const scale = Math.min(1, MAX / Math.max(img.width, img.height))
          if (scale >= 1 && file.size < 2_500_000) payload = { image: await readB64(file), image_type: file.type }
          else {
            const c = document.createElement('canvas')
            c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale)
            c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
            payload = { image: c.toDataURL('image/jpeg', 0.85).split(',')[1] || '', image_type: 'image/jpeg' }
          }
        } finally { URL.revokeObjectURL(url) }
      }
      const r = await fetch('/api/ai/parse-customer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then(x => x.json())
      if (r.customer) {
        applyCustomer(r.customer)
        // сразу привязываем к карточке клиента
        setSaving(true)
        const c = r.customer as Record<string, string | undefined>
        const merged = {
          ...req,
          full_name: c.name || c.fio || req.full_name,
          inn: c.inn || req.inn, kpp: c.kpp || req.kpp, ogrn: c.ogrn || req.ogrn,
          legal_address: c.legal_address || c.address || req.legal_address,
          bank_account: c.account || req.bank_account, bank_name: c.bank || req.bank_name,
          bik: c.bik || req.bik, corr_account: c.corr_account || req.corr_account,
        }
        const sr = await fetch(`/api/quotes/${id}/invoice-data`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(merged),
        })
        setSaving(false)
        if (sr.ok) { setSaved(true); setTimeout(() => setSaved(false), 2500) }
      }
    } finally { setParsing(false) }
  }

  async function downloadPdf() {
    if (!docRef.current) return
    try {
      // html2canvas-pro: классический html2canvas не понимает oklch-цвета Tailwind v4.
      const [h2c, jspdf] = await Promise.all([import('html2canvas-pro'), import('jspdf')])
      const canvas = await h2c.default(docRef.current, { scale: 2, useCORS: true, backgroundColor: '#ffffff' })
      const pdf = new jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
      const pw = 210, ph = 297
      const imgH = pw * canvas.height / canvas.width
      let pos = 0, left = imgH
      const img = canvas.toDataURL('image/jpeg', 0.94)
      // многостраничность, если контент длиннее A4
      pdf.addImage(img, 'JPEG', 0, pos, pw, imgH)
      left -= ph
      while (left > 0) { pos -= ph; pdf.addPage(); pdf.addImage(img, 'JPEG', 0, pos, pw, imgH); left -= ph }
      pdf.save(`Счёт-спецификация-${order?.custom_number?.trim() || String(order?.id ?? '').padStart(5, '0')}.pdf`)
    } catch (e) {
      alert('Не удалось сформировать PDF: ' + (e instanceof Error ? e.message : 'ошибка') + '. Используйте «Печать» → Сохранить как PDF.')
    }
  }

  if (loading) return <div className="flex items-center justify-center min-h-screen text-[#6b6b66] text-sm">Загрузка…</div>
  if (error || !order || !totals) return <div className="flex items-center justify-center min-h-screen text-red-500 text-sm">{error ?? 'Ошибка загрузки'}</div>

  const notes = parseNotes(order.notes)
  const quoteDate = (notes.quote_date as string) || order.created_at
  const prodDays = (notes.production_days as string) || '7'
  const num = order.custom_number?.trim() || String(order.id).padStart(5, '0')
  const buyerLine = [
    req.full_name || buyerName,
    req.inn ? `ИНН ${req.inn}` : '',
    req.kpp ? `КПП ${req.kpp}` : '',
    req.ogrn ? `ОГРН ${req.ogrn}` : '',
    req.legal_address ? `адрес: ${req.legal_address}` : '',
    req.bank_account ? `р/с ${req.bank_account}` : '',
    req.bank_name ? `${req.bank_name}` : '',
    req.bik ? `БИК ${req.bik}` : '',
    req.corr_account ? `к/с ${req.corr_account}` : '',
  ].filter(Boolean).join(', ')
  const reqMissing = !req.inn

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
        body { background: #ececea; }
      `}</style>

      {/* Toolbar + requisites editor — screen only */}
      <div className="no-print max-w-[820px] mx-auto pt-6 px-4 flex flex-wrap items-center gap-2">
        <button onClick={downloadPdf} className="bg-[#111110] text-white text-[13px] font-semibold px-4 py-2 rounded-lg hover:bg-[#2a2a28]">⬇ Скачать PDF</button>
        <button onClick={() => document.fonts.ready.then(() => window.print())} className="border border-[#d4d4cf] text-[#333] text-[13px] px-4 py-2 rounded-lg hover:bg-white">🖨 Печать</button>
        <button onClick={() => setShowEditor(v => !v)} className="border border-[#d4d4cf] text-[#333] text-[13px] px-4 py-2 rounded-lg hover:bg-white ml-auto">{showEditor ? 'Скрыть реквизиты' : 'Реквизиты покупателя'}</button>
      </div>

      {showEditor && (
        <div className="no-print max-w-[820px] mx-auto mt-3 px-4">
          <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[13px] font-bold text-[#111110]">Реквизиты покупателя (для счёта)</h3>
              {reqMissing && <span className="text-[11px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded">заполните — ИНН, банк, счёт</span>}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {([
                ['full_name', 'Полное наименование'], ['inn', 'ИНН'], ['kpp', 'КПП'],
                ['ogrn', 'ОГРН / ОГРНИП'], ['legal_address', 'Юр. адрес'], ['bank_name', 'Банк'],
                ['bank_account', 'Р/С'], ['bik', 'БИК'], ['corr_account', 'К/С'],
                ['supply_contract_no', 'Договор поставки №'],
              ] as [keyof Requisites, string][]).map(([k, label]) => (
                <label key={k} className={`flex flex-col gap-0.5 ${k === 'full_name' || k === 'legal_address' ? 'col-span-2 md:col-span-3' : ''}`}>
                  <span className="text-[10px] uppercase tracking-wide text-[#9a9a95]">{label}</span>
                  <input value={req[k]} onChange={e => setReq(p => ({ ...p, [k]: e.target.value }))}
                    className="border border-[#e4e4e0] rounded-lg px-2 py-1 text-[12px] outline-none focus:border-[#111110]" />
                </label>
              ))}
              <label className="flex flex-col gap-0.5">
                <span className="text-[10px] uppercase tracking-wide text-[#9a9a95]">Дата договора</span>
                <input type="date" value={req.supply_contract_date} onChange={e => setReq(p => ({ ...p, supply_contract_date: e.target.value }))}
                  className="border border-[#e4e4e0] rounded-lg px-2 py-1 text-[12px] outline-none focus:border-[#111110]" />
              </label>
            </div>

            <div className="mt-3 flex flex-col md:flex-row gap-2">
              <textarea value={parseText} onChange={e => setParseText(e.target.value)} rows={2}
                placeholder="Вставьте реквизиты из карточки клиента одним куском — распознаю автоматически"
                className="flex-1 border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[12px] outline-none focus:border-[#111110] resize-none" />
              <div className="flex md:flex-col gap-2">
                <button onClick={aiParse} disabled={parsing || !parseText.trim()}
                  className="text-[12px] px-3 py-1.5 rounded-lg border border-[#e4e4e0] text-[#333] hover:bg-[#f5f5f4] disabled:opacity-40 whitespace-nowrap">
                  {parsing ? '…' : '🤖 Распознать'}
                </button>
                <label className={`text-[12px] px-3 py-1.5 rounded-lg border border-[#e4e4e0] text-[#333] hover:bg-[#f5f5f4] whitespace-nowrap text-center ${parsing ? 'opacity-40 cursor-default' : 'cursor-pointer'}`}>
                  {parsing ? '…' : '📎 Карточка (PDF/фото)'}
                  <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/gif" className="hidden" disabled={parsing}
                    onChange={e => { const f = e.target.files?.[0]; if (f) parseCardFile(f); e.target.value = '' }} />
                </label>
                <button onClick={save} disabled={saving}
                  className="text-[12px] px-3 py-1.5 rounded-lg bg-[#111110] text-white hover:bg-[#2a2a28] disabled:opacity-40 whitespace-nowrap">
                  {saving ? '…' : saved ? '✓ Сохранено' : '💾 Сохранить к клиенту'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Document */}
      <div ref={docRef} id="invoice-document" className="max-w-[820px] mx-auto my-6 bg-white shadow-xl px-9 py-8 text-[12px] leading-snug print:shadow-none print:my-0">

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
              <td className="pt-1">{buyerLine || <span className="text-[#b00]">заполните реквизиты покупателя выше</span>}</td>
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
                  <td className="text-center">{totals.discount ? `${totals.discount}%` : '—'}</td>
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
}
