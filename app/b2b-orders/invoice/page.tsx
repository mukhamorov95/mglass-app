'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { renderDocCanvas } from '@/lib/pdfCapture'
import { SELLER_B2B } from '@/lib/companyRequisites'
import { paymentQrStringFor } from '@/lib/paymentQr'
import { rublesInWords } from '@/lib/numToWords'
import { entityTitle, type B2BLegalEntity } from '@/lib/b2bLegalEntities'

// Единый счёт на несколько B2B-заказов. Заказы идут на своих заказчиков, но
// плательщик выбирается один (напр. MR GLASS выставляет счёт за заказы Дмитрия
// Воронеж). Все позиции всех заказов — в одной спецификации, одна сумма.

type OrderItem = {
  materialName?: string; category?: string; thickness?: number; width?: number; height?: number
  quantity?: number; saleIncVat?: number; hasTempering?: boolean; hasFacet?: boolean
  facetTypeMm?: number; comment?: string; services?: { id: number; name: string; cost: number }[]
}
type Order = {
  id: number; client_id: number | null; client_name: string; payer_client_id: number | null
  custom_number: string | null; client_order_number: string | null; discount_percent: number
  items: OrderItem[]; total_sale_inc_vat: number; total_after_discount: number
  notes: string | null; created_at: string
}
type Client = {
  id: number; name: string; full_name?: string | null; inn?: string | null; kpp?: string | null
  ogrn?: string | null; legal_address?: string | null; bank_account?: string | null
  bank_name?: string | null; bik?: string | null; corr_account?: string | null
  supply_contract_no?: string | null; supply_contract_date?: string | null
}

const money2 = (n: number) => (n ?? 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = (s: string) => new Date(s).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
const fmtDateLong = (s: string) => new Date(s).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) + ' г.'
const orderNo = (o: Order) => o.custom_number?.trim() || String(o.id).padStart(5, '0')

function itemName(it: OrderItem): string {
  const parts: string[] = [it.materialName || 'Стекло']
  if (it.thickness) parts.push(`${it.thickness} мм`)
  if (it.hasTempering) parts.push('закалённое')
  if (it.hasFacet) parts.push(it.facetTypeMm ? `фацет ${it.facetTypeMm} мм` : 'фацет')
  let base = parts.join(', ')
  if (it.width && it.height) base += `, ${it.width}×${it.height} мм`
  const svc = (it.services ?? []).map(s => s.name).filter(Boolean)
  if (svc.length) base += `; ${svc.join(', ')}`
  return base
}

// Построчные суммы одного заказа со скидкой; разницу округления сажаем в
// последнюю строку заказа, чтобы сумма строк = Итого заказа.
function orderLineSums(o: Order): number[] {
  const items = o.items || []
  const discount = o.discount_percent || 0
  const totalPay = o.total_after_discount || o.total_sale_inc_vat || items.reduce((s, i) => s + (i.saleIncVat ?? 0), 0)
  const sums = items.map(it => Math.round((it.saleIncVat ?? 0) * (1 - discount / 100) * 100) / 100)
  if (sums.length) {
    const raw = Math.round(sums.reduce((a, b) => a + b, 0) * 100) / 100
    sums[sums.length - 1] = Math.round((sums[sums.length - 1] + (totalPay - raw)) * 100) / 100
  }
  return sums
}

export default function BatchInvoicePage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [payers, setPayers] = useState<Client[]>([])
  const [entities, setEntities] = useState<B2BLegalEntity[]>([])
  const [ids, setIds] = useState<number[]>([])
  const [payerEntityId, setPayerEntityId] = useState<number | null>(null)
  const [invNo, setInvNo] = useState('')
  const [qr, setQr] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingPayer, setSavingPayer] = useState(false)
  const [savedPayer, setSavedPayer] = useState(false)
  const [savingInv, setSavingInv] = useState(false)
  const [savedInvId, setSavedInvId] = useState<number | null>(null)
  const docRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const qIds = (new URLSearchParams(window.location.search).get('ids') ?? '')
      .split(',').map(s => Number(s.trim())).filter(n => n > 0)
    if (!qIds.length) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError('Не выбраны заказы'); setLoading(false); return
    }
    setIds(qIds)
    fetch(`/api/b2b-orders/invoice-batch?ids=${qIds.join(',')}`)
      .then(async r => {
        if (!r.ok) { setError((await r.json().catch(() => ({}))).error ?? 'Ошибка загрузки'); setLoading(false); return }
        const d = await r.json() as { orders: Order[]; payers: Client[]; orderClients: Client[]; entities: B2BLegalEntity[] }
        setOrders(d.orders)
        // Клиенты (для имён групп в селекторе юрлиц).
        const map = new Map<number, Client>()
        for (const c of [...d.payers, ...d.orderClients]) map.set(c.id, c)
        setPayers([...map.values()].sort((a, b) => a.name.localeCompare(b.name)))
        const ents = d.entities ?? []
        setEntities(ents)
        // Юрлицо-плательщик по умолчанию: основное юрлицо сохранённого плательщика →
        // общего заказчика → первое доступное.
        const storedPayers = [...new Set(d.orders.map(o => o.payer_client_id).filter((x): x is number => x != null))]
        const commonClient = [...new Set(d.orders.map(o => o.client_id).filter((x): x is number => x != null))]
        const defFor = (cid: number) => ents.find(e => e.client_id === cid && e.is_default) ?? ents.find(e => e.client_id === cid)
        const def = (storedPayers.length === 1 && defFor(storedPayers[0]))
          || (commonClient.length === 1 && defFor(commonClient[0]))
          || ents[0] || null
        setPayerEntityId(def ? def.id : null)
        // № счёта по умолчанию — диапазон номеров заказов.
        const nums = d.orders.map(orderNo).sort()
        setInvNo(nums.length > 1 ? `${nums[0]}–${nums[nums.length - 1]}` : (nums[0] ?? ''))
        setLoading(false)
      })
      .catch(() => { setError('Ошибка сети'); setLoading(false) })
  }, [])

  const grandTotal = useMemo(() => orders.reduce((s, o) =>
    s + (o.total_after_discount || o.total_sale_inc_vat || 0), 0), [orders])
  const vat = Math.round(grandTotal * 22 / 122 * 100) / 100
  const itemCount = useMemo(() => orders.reduce((s, o) => s + (o.items?.length ?? 0), 0), [orders])
  const payerEntity = entities.find(e => e.id === payerEntityId) ?? null
  const payer = payerEntity

  useEffect(() => {
    if (!grandTotal) return
    const s = paymentQrStringFor(SELLER_B2B, grandTotal, `Оплата по счёту № ${invNo}`)
    QRCode.toDataURL(s, { margin: 0, width: 240 }).then(setQr).catch(() => {})
  }, [grandTotal, invNo])

  // Счёт становится записью: печать/PDF регистрируют единый счёт в реестре
  // побочным эффектом. API идемпотентен по НАБОРУ заказов, поэтому повторная
  // печать не плодит дубли, а правка номера менеджером не создаёт второй счёт.
  const registeredRef = useRef(false)
  async function postInvoice(): Promise<boolean> {
    if (!grandTotal || !ids.length) return false
    const r = await fetch('/api/invoices', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        invoice_no: invNo, payer_client_id: payerEntity?.client_id ?? null, payer_entity_id: payerEntityId,
        payer_name: payerEntity ? entityTitle(payerEntity) : null,
        order_ids: ids, amount: grandTotal, vat,
      }),
    })
    const d = await r.json().catch(() => ({}))
    if (r.ok && d.id) setSavedInvId(d.id as number)
    return r.ok
  }
  // Явная кнопка — с обратной связью.
  async function saveInvoice() {
    setSavingInv(true)
    try {
      const ok = await postInvoice()
      registeredRef.current = registeredRef.current || ok
    } finally { setSavingInv(false) }
  }
  // Тихая регистрация при печати/скачивании — один раз, best-effort.
  async function ensureRegistered() {
    if (registeredRef.current || !grandTotal || !ids.length) return
    registeredRef.current = true
    try { if (!(await postInvoice())) registeredRef.current = false }
    catch { registeredRef.current = false }
  }

  async function savePayerToOrders() {
    setSavingPayer(true); setSavedPayer(false)
    try {
      const r = await fetch('/api/b2b-orders/invoice-batch', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, payerId: payerEntity?.client_id ?? null }),
      })
      if (r.ok) { setSavedPayer(true); setTimeout(() => setSavedPayer(false), 2000) }
    } finally { setSavingPayer(false) }
  }

  async function downloadPdf() {
    if (!docRef.current) return
    void ensureRegistered()   // печать = документ выдан → в реестр
    try {
      // Снимок при десктопной ширине (renderDocCanvas) → PDF одинаков с телефона и ПК.
      const jspdf = await import('jspdf')
      const canvas = await renderDocCanvas(docRef.current)
      const pdf = new jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
      const pw = 210, ph = 297
      const imgH = pw * canvas.height / canvas.width
      let pos = 0, left = imgH
      const img = canvas.toDataURL('image/jpeg', 0.94)
      pdf.addImage(img, 'JPEG', 0, pos, pw, imgH); left -= ph
      while (left > 0) { pos -= ph; pdf.addPage(); pdf.addImage(img, 'JPEG', 0, pos, pw, imgH); left -= ph }
      pdf.save(`Счёт-${invNo || 'единый'}.pdf`)
    } catch {
      alert('Не удалось сформировать PDF. Используйте «Печать» → Сохранить как PDF.')
    }
  }

  if (loading) return <div className="flex items-center justify-center min-h-screen text-[#6b6b66] text-sm">Загрузка…</div>
  if (error) return <div className="flex items-center justify-center min-h-screen text-red-500 text-sm">{error}</div>

  const payerLine = payer ? [
    entityTitle(payer),
    payer.inn ? `ИНН ${payer.inn}` : '', payer.kpp ? `КПП ${payer.kpp}` : '',
    payer.ogrn ? `ОГРН ${payer.ogrn}` : '', payer.legal_address ? `адрес: ${payer.legal_address}` : '',
    payer.bank_account ? `р/с ${payer.bank_account}` : '', payer.bank_name || '',
    payer.bik ? `БИК ${payer.bik}` : '', payer.corr_account ? `к/с ${payer.corr_account}` : '',
  ].filter(Boolean).join(', ') : ''
  const contractNo = payer?.supply_contract_no
  const invDate = orders[0]?.created_at ?? new Date().toISOString()
  // Сквозная нумерация строк: стартовый номер каждого заказа = сумма позиций
  // предыдущих заказов. Без мутации счётчика во время рендера.
  const rowOffsets = orders.reduce<number[]>((acc, o, i) => {
    acc.push(i === 0 ? 0 : acc[i - 1] + (orders[i - 1].items?.length ?? 0))
    return acc
  }, [])

  return (
    <>
      <style>{`
        #invoice-document, #invoice-document * { font-family: Georgia, 'Times New Roman', serif; color: #111; }
        #invoice-document table { border-collapse: collapse; width: 100%; }
        #invoice-document .bank td, #invoice-document .items th, #invoice-document .items td { border: 1px solid #333; padding: 4px 6px; }
        #invoice-document .items th { background: #f0f0ee; font-weight: 700; font-size: 11px; text-align: center; }
        #invoice-document .items td { font-size: 11px; vertical-align: top; }
        #invoice-document .items .ordhead td { background: #eef3fa; font-weight: 700; font-size: 10.5px; }
        @media print {
          body * { visibility: hidden !important; }
          #invoice-document, #invoice-document * { visibility: visible !important; }
          #invoice-document { position: fixed; top: 0; left: 0; width: 100%; }
          .no-print { display: none !important; }
          @page { margin: 12mm; size: A4; }
        }
        body { background: #ececea; }
      `}</style>

      {/* Панель — только экран */}
      <div className="no-print max-w-[820px] mx-auto pt-6 px-4">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={downloadPdf} className="bg-[#111110] text-white text-[13px] font-semibold px-4 py-2 rounded-lg hover:bg-[#2a2a28]">⬇ Скачать PDF</button>
          <button onClick={() => { void ensureRegistered(); document.fonts.ready.then(() => window.print()) }} className="border border-[#d4d4cf] text-[#333] text-[13px] px-4 py-2 rounded-lg hover:bg-white">🖨 Печать</button>
          <button onClick={saveInvoice} disabled={savingInv || savedInvId != null}
            className="border border-[#d4d4cf] text-[#333] text-[13px] px-4 py-2 rounded-lg hover:bg-white disabled:opacity-50">
            {savedInvId != null ? '✓ в реестре' : savingInv ? '…' : '💾 Сохранить счёт'}
          </button>
          {savedInvId != null && <a href="/cfo/invoices" className="text-[12px] text-blue-600">открыть реестр →</a>}
          <span className="text-[12px] text-[#6b6b66] ml-auto">{orders.length} заказов · {itemCount} позиций · {money2(grandTotal)} ₽</span>
        </div>

        <div className="mt-3 bg-white border border-[#e4e4e0] rounded-xl p-4 flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[240px]">
            <label className="block text-[11px] uppercase tracking-widest text-[#9a9a95] mb-1">Плательщик — юрлицо (на кого счёт)</label>
            <select value={payerEntityId ?? ''} onChange={e => setPayerEntityId(e.target.value ? Number(e.target.value) : null)}
              className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[14px] bg-white outline-none focus:border-[#111110]">
              <option value="">— выберите юрлицо —</option>
              {[...new Set(entities.map(e => e.client_id))].map(cid => {
                const cname = payers.find(p => p.id === cid)?.name ?? `Клиент ${cid}`
                return (
                  <optgroup key={cid} label={cname}>
                    {entities.filter(e => e.client_id === cid).map(e => (
                      <option key={e.id} value={e.id}>{entityTitle(e)}{e.inn ? ` · ИНН ${e.inn}` : ''}{e.is_default ? ' · основное' : ''}</option>
                    ))}
                  </optgroup>
                )
              })}
            </select>
            {payer && !payer.inn && <p className="text-[11px] text-red-600 mt-1">У выбранного юрлица не заполнен ИНН — проверьте реквизиты в карточке клиента.</p>}
            {!entities.length && <p className="text-[11px] text-red-600 mt-1">Нет юрлиц с реквизитами. Добавьте юрлицо в карточке клиента (B2B Клиенты → Реквизиты).</p>}
          </div>
          <div className="w-[150px]">
            <label className="block text-[11px] uppercase tracking-widest text-[#9a9a95] mb-1">№ счёта</label>
            <input value={invNo} onChange={e => setInvNo(e.target.value)}
              className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[14px] outline-none focus:border-[#111110]" />
          </div>
          <button onClick={savePayerToOrders} disabled={savingPayer}
            className="text-[12px] font-medium px-3 py-2 rounded-lg border border-[#e4e4e0] text-[#6b6b66] hover:border-[#111110] hover:text-[#111110] disabled:opacity-40">
            {savedPayer ? '✓ запомнено' : savingPayer ? '…' : '💾 Запомнить плательщика в заказах'}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-[#9a9a95]">
          Заказы идут на своих заказчиков; счёт выставляется на выбранного плательщика. «Запомнить» проставит плательщика во всех этих заказах.
        </p>
      </div>

      {/* Документ */}
      <div id="invoice-document" ref={docRef} className="max-w-[820px] mx-auto bg-white shadow-md my-6 px-10 py-8" style={{ minHeight: 1000 }}>
        <div className="relative">
          <table className="bank text-[11px]">
            <tbody>
              <tr>
                <td rowSpan={2} style={{ width: 300 }}>{SELLER_B2B.bankName}<br />Банк получателя</td>
                <td style={{ width: 70 }}>БИК</td>
                <td>{SELLER_B2B.bik}</td>
              </tr>
              <tr>
                <td>Корр. сч. №</td>
                <td>{SELLER_B2B.corrAccount}</td>
              </tr>
              <tr>
                <td>ИНН {SELLER_B2B.inn} КПП {SELLER_B2B.kpp}<br />{SELLER_B2B.name}</td>
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
          СЧЁТ № {invNo} <span className="text-red-600">от {fmtDate(invDate)}</span>
        </h1>
        {contractNo && (
          <div className="text-center text-[12px] mb-2">
            к Договору поставки № {contractNo}{payer?.supply_contract_date ? ` от ${fmtDateLong(payer.supply_contract_date)}` : ''}
          </div>
        )}

        <table className="mt-3 text-[11px]">
          <tbody>
            <tr>
              <td className="align-top pr-2 font-semibold" style={{ width: 90 }}>Поставщик:</td>
              <td>{SELLER_B2B.name}, ИНН {SELLER_B2B.inn}, КПП {SELLER_B2B.kpp}, ОГРН {SELLER_B2B.ogrn}. Адрес: {SELLER_B2B.legalAddress}. Р/с {SELLER_B2B.account} в {SELLER_B2B.bankName}, БИК {SELLER_B2B.bik}, к/с {SELLER_B2B.corrAccount}.</td>
            </tr>
            <tr>
              <td className="align-top pr-2 font-semibold pt-1">Плательщик:</td>
              <td className="pt-1">{payerLine || <span className="text-[#b00]">выберите плательщика выше</span>}</td>
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
            {orders.map((o, oi) => {
              const sums = orderLineSums(o)
              const orderTotal = o.total_after_discount || o.total_sale_inc_vat || 0
              return (
                <Fragment key={o.id}>
                  <tr className="ordhead">
                    <td colSpan={8}>Заказ № {orderNo(o)} · {o.client_name}{o.client_order_number ? ` · № клиента ${o.client_order_number}` : ''} · {money2(orderTotal)} ₽</td>
                  </tr>
                  {(o.items || []).map((it, i) => {
                    const qty = it.quantity || 1
                    const sumNoDisc = it.saleIncVat ?? 0
                    const price = qty ? sumNoDisc / qty : sumNoDisc
                    return (
                      <tr key={`${o.id}-${i}`}>
                        <td className="text-center">{rowOffsets[oi] + i + 1}</td>
                        <td>{itemName(it)}{it.comment ? <span className="block text-[9px] text-[#666] italic mt-0.5">{it.comment}</span> : null}</td>
                        <td className="text-center">шт.</td>
                        <td className="text-center">{qty}</td>
                        <td className="text-right">{money2(price)}</td>
                        <td className="text-right">{money2(sumNoDisc)}</td>
                        <td className="text-center">{o.discount_percent ? `${o.discount_percent}%` : '—'}</td>
                        <td className="text-right">{money2(sums[i])}</td>
                      </tr>
                    )
                  })}
                </Fragment>
              )
            })}
          </tbody>
        </table>

        <table className="mt-1 text-[12px]" style={{ width: '48%', marginLeft: 'auto' }}>
          <tbody>
            <tr><td className="text-right pr-3 py-0.5">Итого:</td><td className="text-right font-semibold" style={{ width: 110 }}>{money2(grandTotal)}</td></tr>
            <tr><td className="text-right pr-3 py-0.5">В том числе НДС (22%):</td><td className="text-right">{money2(vat)}</td></tr>
            <tr><td className="text-right pr-3 py-0.5 font-bold">Всего к оплате:</td><td className="text-right font-bold">{money2(grandTotal)}</td></tr>
          </tbody>
        </table>

        <div className="mt-2 text-[11px]">
          Всего наименований {itemCount} (заказов {orders.length}), на сумму {money2(grandTotal)} руб.<br />
          <b>{rublesInWords(grandTotal)}</b>
        </div>

        <ol className="mt-3 text-[10px] text-[#333] leading-snug list-decimal pl-4 space-y-0.5">
          <li>Общая стоимость Товара по счёту: {money2(grandTotal)} руб., в т.ч. НДС 22%.</li>
          <li>Счёт объединяет заказы: {orders.map(orderNo).join(', ')}.</li>
          <li>Предоплата за Товар производится в размере 100% от суммы настоящего счёта.</li>
          <li>Счёт составлен в двух идентичных экземплярах, имеющих равную юридическую силу, по одному для каждой из Сторон.</li>
          <li>Стороны признают юридическую силу сканированной копии с подписями Сторон, направленной по электронной почте либо через мессенджер, до даты получения оригинала.</li>
        </ol>

        <div className="mt-6 flex items-end justify-between text-[11px]">
          <div>
            <div className="font-semibold mb-1">Поставщик</div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/seal-ooo.png" alt="Подпись и печать" style={{ height: 118, marginLeft: 6, opacity: 0.94 }} />
            <div className="mt-0.5">/ {SELLER_B2B.director} /</div>
          </div>
          <div>
            <div className="font-semibold mb-6">Плательщик</div>
            <span className="border-b border-[#333] inline-block" style={{ width: 200 }}>&nbsp;</span>
            <div className="mt-1">/ ________________ /</div>
          </div>
        </div>
      </div>
    </>
  )
}
