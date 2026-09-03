'use client'

import { useEffect, useState } from 'react'
import ShopRequestsBar from './ShopRequestsBar'

const STATUSES = [
  { key: 'invoice_received', label: 'Счёт получен',        color: 'border-t-gray-400',   bg: 'bg-gray-50'   },
  { key: 'sent_to_payment',  label: 'Отправлен на оплату',  color: 'border-t-orange-400', bg: 'bg-orange-50' },
  { key: 'paid_ready',       label: 'Оплачен / к забору',   color: 'border-t-teal-400',   bg: 'bg-teal-50'   },
  { key: 'picked_up',        label: 'Материал забран',      color: 'border-t-green-400',  bg: 'bg-green-50'  },
  { key: 'closed',           label: 'Закрыто',              color: 'border-t-gray-300',   bg: 'bg-gray-50'   },
] as const

// Maps legacy DB status values to current canonical columns
const LEGACY_STATUS_MAP: Record<string, string> = {
  pending_approval: 'invoice_received',
  waiting_payment:  'sent_to_payment',
  partially_paid:   'sent_to_payment',
  paid:             'paid_ready',
  in_transit:       'picked_up',
}

function normalizeProcurementColumn(raw: string): Status {
  const allowed = STATUSES.map(s => s.key) as string[]
  if (allowed.includes(raw)) return raw as Status
  const mapped = LEGACY_STATUS_MAP[raw]
  return (mapped as Status | undefined) ?? 'invoice_received'
}

type Status = typeof STATUSES[number]['key']

type OrderItem = { name: string; thickness: number; sheets: number }

type PurchaseItem = {
  material_name?: unknown
  category?: unknown
  thickness?: unknown
  sheet_width?: unknown
  sheet_height?: unknown
  area_m2?: unknown
  required_area_m2?: unknown
  sheets_count?: unknown
  estimated_cost?: unknown
  order_refs?: unknown
  unmatched?: unknown
}

type Order = {
  id: number
  supplier_name: string
  invoice_number: string | null
  amount: number | null
  status: Status
  approved_by: string | null
  payment_date: string | null
  payment_amount: number | null
  pickup_by: string | null
  pickup_date: string | null
  issue_notes: string | null
  comment: string | null
  order_refs: string[]
  items_count: number
  items_list: OrderItem[]
  items?: unknown[] | null
  created_at: string
}

type PurchaseOrderPayment = {
  id: number
  purchase_order_id: number
  amount: number
  payment_date: string | null
  comment: string | null
  created_at?: string
  created_by?: string | null
}

const EMPTY_FORM = {
  supplier_name: '', invoice_number: '',
  amount: '', approved_by: '', payment_date: '', payment_amount: '',
  pickup_by: '', pickup_date: '', issue_notes: '', comment: '', order_refs: '',
  status: 'invoice_received' as Status,
}

// ─── Safe helpers ─────────────────────────────────────────────────────────────

function safeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function safeNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function safeNumberOrNull(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function safeArrayOfStrings(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean)
  if (typeof value === 'string' && value.trim()) {
    return value.split(',').map(s => s.trim()).filter(Boolean)
  }
  return []
}

function safeDateString(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : value
}

function formatMoney(value: unknown): string {
  const n = Number(value)
  return Number.isFinite(n) ? `${n.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽` : '—'
}

function formatDate(value: unknown): string {
  if (typeof value !== 'string' || !value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })
}

function paymentBadge(amount: number | null, paid: number | null): { label: string; cls: string } {
  const a = Number(amount ?? 0)
  const p = Number(paid ?? 0)
  if (a <= 0) return { label: 'Сумма не указана',  cls: 'bg-gray-100 text-gray-500 border-gray-200' }
  if (p <= 0)  return { label: 'Не оплачено',       cls: 'bg-red-100 text-red-700 border-red-200' }
  if (p < a)   return { label: 'Частично оплачено', cls: 'bg-amber-100 text-amber-700 border-amber-200' }
  return { label: 'Оплачено', cls: 'bg-green-100 text-green-700 border-green-200' }
}

// ─── Material purchase table helpers ──────────────────────────────────────────

function safeItems(value: unknown): PurchaseItem[] {
  return Array.isArray(value) ? (value as PurchaseItem[]) : []
}

function num(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function text(value: unknown, fallback = '—'): string {
  return typeof value === 'string' && value.trim() ? value : fallback
}

function formatM2(value: number | null): string {
  return value !== null
    ? `${value.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} м²`
    : '—'
}

function formatKg(value: number | null): string {
  return value !== null
    ? `${value.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} кг`
    : '—'
}

function formatSheets(value: unknown): string {
  const n = num(value)
  return n !== null ? `${Math.ceil(n)} шт` : '—'
}

function orderRefs(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean)
  if (typeof value === 'string' && value.trim()) return [value]
  return []
}

function sheetFormat(item: PurchaseItem): string {
  const w = num(item.sheet_width)
  const h = num(item.sheet_height)
  return w !== null && h !== null ? `${w}×${h}` : '—'
}

function sheetAreaTotal(item: PurchaseItem): number | null {
  const w = num(item.sheet_width)
  const h = num(item.sheet_height)
  const sheets = num(item.sheets_count)
  if (w === null || h === null || sheets === null) return null
  return (w * h / 1_000_000) * Math.ceil(sheets)
}

function sheetWeightTotal(item: PurchaseItem): number | null {
  const area = sheetAreaTotal(item)
  const thickness = num(item.thickness)
  if (area === null || thickness === null) return null
  return area * thickness * 2.5
}

function needsTintClarification(item: PurchaseItem): boolean {
  const name = text(item.material_name, '').toLowerCase()
  return (
    name.includes('бронза/графит') ||
    name.includes('бронза или графит') ||
    name.includes('bronze/graphite')
  )
}

function usedAreaOnOrders(item: PurchaseItem): number | null {
  return num(item.area_m2) ?? num(item.required_area_m2)
}

function hasTintClarificationIssues(items: unknown): boolean {
  return safeItems(items).some(needsTintClarification)
}

function normalizeOrder(row: unknown): Order {
  const r = row as Record<string, unknown>
  const rawStatus = String(r?.status ?? '')
  const status    = normalizeProcurementColumn(rawStatus)

  return {
    id:             Number(r?.id),
    supplier_name:  safeString(r?.supplier_name, 'Не указан'),
    invoice_number: safeNullableString(r?.invoice_number),
    amount:         safeNumberOrNull(r?.amount),
    status,
    approved_by:    safeNullableString(r?.approved_by),
    payment_date:   safeDateString(r?.payment_date),
    payment_amount: safeNumberOrNull(r?.payment_amount),
    pickup_by:      safeNullableString(r?.pickup_by),
    pickup_date:    safeDateString(r?.pickup_date),
    issue_notes:    safeNullableString(r?.issue_notes),
    comment:        safeNullableString(r?.comment),
    order_refs:     safeArrayOfStrings(r?.order_refs),
    items_count:    Array.isArray(r?.items) ? r.items.length : 0,
    items_list:     Array.isArray(r?.items)
      ? (r.items as unknown[]).map(it => {
          const i = it as Record<string, unknown>
          const thickness = Number(i?.thickness)
          const sheets    = Number(i?.sheets_count)
          return {
            name:      safeString(i?.material_name, 'Без названия'),
            thickness: Number.isFinite(thickness) ? thickness : 0,
            sheets:    Number.isFinite(sheets)    ? sheets    : 0,
          }
        })
      : [],
    items:          Array.isArray(r?.items) ? r.items : null,
    created_at:     safeDateString(r?.created_at) ?? new Date().toISOString(),
  }
}

// ─────────────────────────────────────────────────────────────────────────────

function buildSupplierPdfRows(items: unknown) {
  return safeItems(items).map((item, index) => {
    const thicknessNum = num(item.thickness)
    return {
      index: index + 1,
      material: text(item.material_name, 'Материал не указан'),
      thickness: thicknessNum !== null ? `${thicknessNum} мм` : '—',
      sheetFormat: sheetFormat(item),
      sheets: formatSheets(item.sheets_count),
      sheetArea: formatM2(sheetAreaTotal(item)),
      sheetWeight: formatKg(sheetWeightTotal(item)),
    }
  })
}

function buildSupplierPdfHtml(items: unknown): string {
  const rows = buildSupplierPdfRows(items)
  const list = safeItems(items)

  const totalSheets = list.reduce((sum, item) => {
    const sheets = num(item.sheets_count)
    return sum + (sheets !== null ? Math.ceil(sheets) : 0)
  }, 0)
  const totalArea   = list.reduce((sum, item) => sum + (sheetAreaTotal(item) ?? 0), 0)
  const totalWeight = list.reduce((sum, item) => sum + (sheetWeightTotal(item) ?? 0), 0)

  const today = new Date().toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })

  const tableRows = rows.map(row =>
    `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e4e4e0;">${row.index}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e4e4e0;font-weight:600;">${row.material}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e4e4e0;">${row.thickness}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e4e4e0;">${row.sheetFormat}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e4e4e0;font-weight:600;">${row.sheets}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e4e4e0;">${row.sheetArea}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e4e4e0;">${row.sheetWeight}</td>
    </tr>`
  ).join('\n')

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <title>Заявка на закупку — M-Glass</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 13px; color: #111110; padding: 32px; }
    h1 { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
    .sub { font-size: 14px; color: #6b6b66; margin-bottom: 2px; }
    .date { font-size: 12px; color: #9a9a95; margin-bottom: 24px; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    thead tr { background: #f8f8f7; }
    th { padding: 10px 12px; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #6b6b66; border-bottom: 2px solid #e4e4e0; }
    .totals { margin-top: 16px; padding: 10px 14px; background: #f8f8f7; border-radius: 6px; font-weight: 600; }
    .footer { margin-top: 40px; font-size: 11px; color: #9a9a95; }
    @media print { body { padding: 16px; } }
  </style>
</head>
<body>
  <h1>Заявка на закупку материалов</h1>
  <div class="sub">M-Glass</div>
  <div class="date">Дата: ${today}</div>
  <table>
    <thead>
      <tr>
        <th>№</th>
        <th>Материал</th>
        <th>Толщина</th>
        <th>Формат листа</th>
        <th>Кол-во листов</th>
        <th>Общая площадь листов</th>
        <th>Общий вес</th>
      </tr>
    </thead>
    <tbody>
      ${tableRows}
    </tbody>
  </table>
  <div class="totals">Итого: ${totalSheets} листов · ${formatM2(totalArea)} · ${formatKg(totalWeight)}</div>
  <div class="footer">Документ сформирован автоматически</div>
</body>
</html>`
}

function printSupplierPdf(items: unknown) {
  const list = safeItems(items)

  if (list.length === 0) {
    alert('Нельзя сформировать PDF: материалы не указаны')
    return
  }

  if (hasTintClarificationIssues(items)) {
    alert('Нельзя сформировать PDF: есть материал с неоднозначной тонировкой. Уточните бронза или графит.')
    return
  }

  const html = buildSupplierPdfHtml(items)
  const win = window.open('', '_blank')

  if (!win) {
    alert('Не удалось открыть окно печати. Проверьте блокировку всплывающих окон.')
    return
  }

  win.document.open()
  win.document.write(html)
  win.document.close()
  win.focus()
  win.print()
}

function MaterialItemsSummary({ items }: { items: unknown }) {
  const list = safeItems(items)

  if (list.length === 0) {
    return (
      <div className="mt-4 rounded-xl border border-[#e4e4e0] bg-[#fafaf8] p-4 text-sm text-[#8a8a85]">
        Материалы не указаны
      </div>
    )
  }

  const totalSheets = list.reduce((sum, item) => {
    const sheets = num(item.sheets_count)
    return sum + (sheets !== null ? Math.ceil(sheets) : 0)
  }, 0)

  const totalArea = list.reduce((sum, item) => {
    const area = sheetAreaTotal(item)
    return sum + (area ?? 0)
  }, 0)

  const totalWeight = list.reduce((sum, item) => {
    const weight = sheetWeightTotal(item)
    return sum + (weight ?? 0)
  }, 0)

  const totalCost = list.reduce((sum, item) => {
    const cost = num(item.estimated_cost)
    return sum + (cost ?? 0)
  }, 0)

  const totalUsedArea = list.reduce((sum, item) => {
    const area = usedAreaOnOrders(item)
    return sum + (area ?? 0)
  }, 0)

  return (
    <div className="mt-4 rounded-xl border border-[#e4e4e0] bg-white p-4">
      <div className="mb-3 text-xs font-bold uppercase tracking-wider text-[#9a9a95]">
        Материалы к закупке
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-left text-xs">
          <thead>
            <tr className="border-b border-[#e4e4e0] text-[#9a9a95]">
              <th className="py-2 pr-3 font-semibold">Материал</th>
              <th className="py-2 pr-3 font-semibold">Толщина</th>
              <th className="py-2 pr-3 font-semibold">Формат листа</th>
              <th className="py-2 pr-3 font-semibold">К закупке</th>
              <th className="py-2 pr-3 font-semibold">Используется на заказы</th>
              <th className="py-2 pr-3 font-semibold">Площадь листов</th>
              <th className="py-2 pr-3 font-semibold">Вес листов</th>
              <th className="py-2 pr-3 font-semibold">Стоимость листов</th>
              <th className="py-2 font-semibold">Заказы</th>
            </tr>
          </thead>
          <tbody>
            {list.map((item, index) => {
              const refs = orderRefs(item.order_refs)
              const ambiguousTint = needsTintClarification(item)
              const thicknessNum = num(item.thickness)
              return (
                <tr key={index} className="border-b border-[#ededeb] last:border-0">
                  <td className="py-3 pr-3 align-top">
                    <div className="font-semibold text-[#111110]">
                      {text(item.material_name, 'Материал не указан')}
                    </div>
                    <div className="mt-1 text-[11px] text-[#8a8a85]">
                      {text(item.category, 'категория не указана')}
                    </div>
                    {Boolean(item.unmatched) && (
                      <div className="mt-1 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                        Не найден в справочнике
                      </div>
                    )}
                    {ambiguousTint && (
                      <div className="mt-1 inline-flex rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-700">
                        Уточнить оттенок
                      </div>
                    )}
                  </td>
                  <td className="py-3 pr-3 align-top font-semibold">
                    {thicknessNum !== null ? `${thicknessNum} мм` : '—'}
                  </td>
                  <td className="py-3 pr-3 align-top">
                    {sheetFormat(item)}
                  </td>
                  <td className="py-3 pr-3 align-top font-semibold">
                    {formatSheets(item.sheets_count)}
                  </td>
                  <td className="py-3 pr-3 align-top text-[#6b6b66]">
                    {formatM2(usedAreaOnOrders(item))}
                  </td>
                  <td className="py-3 pr-3 align-top">
                    {formatM2(sheetAreaTotal(item))}
                  </td>
                  <td className="py-3 pr-3 align-top">
                    {formatKg(sheetWeightTotal(item))}
                  </td>
                  <td className="py-3 pr-3 align-top font-semibold">
                    {formatMoney(item.estimated_cost)}
                  </td>
                  <td className="py-3 align-top">
                    {refs.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {refs.map((ref) => (
                          <span key={ref} className="rounded bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700">
                            {ref}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-[#9a9a95]">—</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 rounded-lg bg-[#fafaf8] px-3 py-2 text-sm font-semibold text-[#111110]">
        <div>Итого: {totalSheets} листов · {formatM2(totalArea)} · {formatKg(totalWeight)} · {formatMoney(totalCost)}</div>
        <div className="mt-1 text-[12px] font-medium text-[#6b6b66]">Используется на заказы: {formatM2(totalUsedArea)}</div>
      </div>
    </div>
  )
}

export default function ProcurementPage() {
  const [orders,       setOrders]       = useState<Order[]>([])
  const [loading,      setLoading]      = useState(true)
  const [loadError,    setLoadError]    = useState<string | null>(null)
  const [modal,        setModal]        = useState(false)
  const [form,         setForm]         = useState(EMPTY_FORM)
  const [editId,       setEditId]       = useState<number | null>(null)
  const [saving,       setSaving]       = useState(false)
  const [detail,       setDetail]       = useState<Order | null>(null)

  // Payment history
  const [paymentsByOrderId, setPaymentsByOrderId] = useState<Record<number, PurchaseOrderPayment[]>>({})
  const [newPaymentForm,    setNewPaymentForm]    = useState({ amount: '', date: '', comment: '' })
  const [addingPayment,     setAddingPayment]     = useState(false)

  // Pickup inline edit
  const [pickupForm,   setPickupForm]   = useState({ by: '', date: '' })
  const [savingPickup, setSavingPickup] = useState(false)

  useEffect(() => { load(); loadPayments() }, [])

  // Reset inline forms when a different card is opened
  useEffect(() => {
    if (!detail) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPickupForm({
      by:   detail.pickup_by   ?? '',
      date: detail.pickup_date ?? '',
    })
    setNewPaymentForm({ amount: '', date: '', comment: '' })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.id])

  async function load() {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch('/api/admin/purchase-orders')
      if (!res.ok) {
        setLoadError(`Ошибка загрузки: ${res.status} ${res.statusText}`)
        setOrders([])
        return
      }
      const data: unknown = await res.json()
      setOrders(Array.isArray(data) ? data.map(normalizeOrder) : [])
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Ошибка загрузки закупок')
      setOrders([])
    } finally {
      setLoading(false)
    }
  }

  function openNew() {
    setForm(EMPTY_FORM); setEditId(null); setModal(true)
  }

  function openEdit(o: Order) {
    setForm({
      supplier_name:  o.supplier_name,
      invoice_number: o.invoice_number ?? '',
      amount:         o.amount != null ? String(o.amount) : '',
      approved_by:    o.approved_by ?? '',
      payment_date:   o.payment_date ?? '',
      payment_amount: o.payment_amount != null ? String(o.payment_amount) : '',
      pickup_by:      o.pickup_by ?? '',
      pickup_date:    o.pickup_date ?? '',
      issue_notes:    o.issue_notes ?? '',
      comment:        o.comment ?? '',
      order_refs:     o.order_refs.join(', '),
      status:         o.status,
    })
    setEditId(o.id); setDetail(null); setModal(true)
  }

  async function save() {
    if (!form.supplier_name.trim()) return
    setSaving(true)
    const body = {
      supplier_name:  form.supplier_name.trim(),
      invoice_number: form.invoice_number || null,
      amount:         form.amount         ? Number(form.amount)         : null,
      status:         form.status,
      approved_by:    form.approved_by    || null,
      payment_date:   form.payment_date   || null,
      payment_amount: form.payment_amount ? Number(form.payment_amount) : null,
      pickup_by:      form.pickup_by      || null,
      pickup_date:    form.pickup_date    || null,
      issue_notes:    form.issue_notes    || null,
      comment:        form.comment        || null,
      order_refs:     form.order_refs ? form.order_refs.split(',').map(s => s.trim()).filter(Boolean) : null,
    }
    if (editId) {
      await fetch('/api/admin/purchase-orders', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: editId, ...body }) })
    } else {
      await fetch('/api/admin/purchase-orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    }
    setSaving(false); setModal(false); load()
  }

  async function loadPayments() {
    try {
      const res = await fetch('/api/admin/purchase-order-payments')
      if (!res.ok) return
      const data = (await res.json()) as PurchaseOrderPayment[]
      const grouped: Record<number, PurchaseOrderPayment[]> = {}
      for (const p of data ?? []) {
        if (!grouped[p.purchase_order_id]) grouped[p.purchase_order_id] = []
        grouped[p.purchase_order_id].push(p)
      }
      setPaymentsByOrderId(grouped)
    } catch {
      // non-critical: page works without history on error
    }
  }

  function getPaidTotal(orderId: number, order: Order): number {
    const payments = paymentsByOrderId[orderId]
    if (payments && payments.length > 0) {
      return payments.reduce((sum, p) => sum + Number(p.amount || 0), 0)
    }
    return Number(order.payment_amount ?? 0)
  }

  async function addPayment(orderId: number) {
    const amount = newPaymentForm.amount ? Number(newPaymentForm.amount) : null
    if (!amount || amount <= 0) return
    setAddingPayment(true)
    try {
      const res = await fetch('/api/admin/purchase-order-payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          purchase_order_id: orderId,
          amount,
          payment_date: newPaymentForm.date    || null,
          comment:      newPaymentForm.comment || null,
        }),
      })
      const json = await res.json()
      if (!res.ok || json.error) {
        console.error('Failed to add purchase order payment', json.error)
        alert(`Не удалось сохранить платёж: ${json.error ?? res.statusText}`)
        return
      }
      // Reload payments for this order from server
      const listRes = await fetch(`/api/admin/purchase-order-payments?purchase_order_id=${orderId}`)
      if (listRes.ok) {
        const newPayments = (await listRes.json()) as PurchaseOrderPayment[]
        setPaymentsByOrderId(prev => ({ ...prev, [orderId]: newPayments }))
      }
      setNewPaymentForm({ amount: '', date: '', comment: '' })
    } finally {
      setAddingPayment(false)
    }
  }

  async function moveStatus(id: number, newStatus: Status) {
    setOrders(prev => prev.map(o => o.id === id ? { ...o, status: newStatus } : o))
    setDetail(prev => prev?.id === id ? { ...prev, status: newStatus } : prev)
    await fetch('/api/admin/purchase-orders', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status: newStatus }) })
  }

  async function savePickup(id: number) {
    setSavingPickup(true)
    const by   = pickupForm.by   || null
    const date = pickupForm.date || new Date().toISOString().slice(0, 10)
    await fetch('/api/admin/purchase-orders', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, pickup_by: by, pickup_date: date, status: 'picked_up' }),
    })
    const update = (o: Order) => o.id === id ? { ...o, pickup_by: by, pickup_date: date, status: 'picked_up' as Status } : o
    setOrders(prev => prev.map(update))
    setDetail(prev => prev?.id === id ? update(prev) : prev)
    setSavingPickup(false)
  }

  async function deleteOrder(id: number) {
    if (!confirm('Удалить закупку?')) return
    setDetail(null)
    await fetch('/api/admin/purchase-orders', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    load()
  }

  const ff = (k: keyof typeof EMPTY_FORM) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const nextStatus = (cur: Status): Status | null => {
    const idx = STATUSES.findIndex(s => s.key === cur)
    return idx < STATUSES.length - 1 ? STATUSES[idx + 1].key : null
  }

  return (
    <div className="min-h-screen bg-[#f8f8f7]">
      <div className="px-6 py-5 flex items-center justify-between border-b border-[#e4e4e0] bg-white sticky top-0 z-10">
        <div>
          <h1 className="text-[18px] font-semibold text-[#111110]">Закупки / Счета</h1>
          <p className="text-[12px] text-[#9a9a95]">Канбан — {orders.filter(o => o.status !== 'closed').length} активных</p>
        </div>
        <div className="flex items-center gap-2">
          <a href="/inventory?tab=receive" className="px-4 py-2 border border-[#e4e4e0] text-[13px] rounded-lg hover:bg-[#f5f5f3]">
            Принять на склад
          </a>
          <button onClick={openNew} className="px-4 py-2 bg-[#111110] text-white text-[13px] font-medium rounded-lg hover:bg-[#2a2a28]">
            + Новая закупка
          </button>
        </div>
      </div>

      {loadError && (
        <div className="mx-6 mt-4 bg-red-50 border border-red-100 rounded-lg px-4 py-3 text-[13px] text-red-700">
          ⚠ {loadError}
        </div>
      )}

      <div className="px-6 pt-4">
        <ShopRequestsBar />
      </div>

      {/* Kanban board */}
      <div className="overflow-x-auto pb-6">
        <div className="flex gap-3 px-6 pt-1" style={{ minWidth: STATUSES.length * 248 + 48 }}>
          {STATUSES.map(col => {
            const cards = orders.filter(o => o.status === col.key)
            return (
              <div key={col.key} className="w-[240px] flex-shrink-0">
                <div className={`rounded-xl border-t-4 ${col.color} bg-white border border-[#e4e4e0] border-t-0`} style={{ borderTop: 'none' }}>
                  <div className={`rounded-t-xl px-3 py-2.5 ${col.bg}`}>
                    <p className="text-[11px] font-bold text-[#4b4b47] uppercase tracking-wide">{col.label}</p>
                    <p className="text-[10px] text-[#9a9a95]">{cards.length} {cards.length === 1 ? 'позиция' : 'позиций'}</p>
                  </div>
                  <div className="p-2 space-y-2 min-h-[120px]">
                    {cards.map(o => {
                      const next = nextStatus(o.status)
                      return (
                        <div key={o.id} className="bg-white border border-[#e4e4e0] rounded-lg p-3 hover:border-[#c4c4be] cursor-pointer transition-colors"
                          onClick={() => setDetail(o)}>
                          <p className="text-[12px] font-semibold text-[#111110] leading-snug">{o.supplier_name}</p>
                          {o.invoice_number && <p className="text-[10px] text-[#9a9a95] mt-0.5">№{o.invoice_number}</p>}
                          {o.amount != null && (() => {
                            const a    = Number(o.amount)
                            const paid = getPaidTotal(o.id, o)
                            const debt = Math.max(a - paid, 0)
                            return (
                              <>
                                <p className="text-[12px] font-mono font-bold text-emerald-700 mt-1">{formatMoney(a)}</p>
                                {paid <= 0 ? (
                                  <div className="mt-1 rounded bg-red-50 px-2 py-1">
                                    <p className="text-[9px] font-bold uppercase text-red-700 leading-tight">Не оплачен</p>
                                    <p className="text-[10px] font-mono text-red-600">Осталось {formatMoney(a)}</p>
                                  </div>
                                ) : paid < a ? (
                                  <div className="mt-1 rounded bg-red-50 px-2 py-1">
                                    <p className="text-[9px] font-bold uppercase text-red-700 leading-tight">Частично оплачен — {formatMoney(paid)}</p>
                                    <p className="text-[10px] font-mono text-red-600">Осталось {formatMoney(debt)}</p>
                                  </div>
                                ) : (
                                  <div className="mt-1 rounded bg-green-50 px-2 py-1">
                                    <p className="text-[9px] font-bold uppercase text-green-700 leading-tight">Оплачено — {formatMoney(paid)}</p>
                                  </div>
                                )}
                              </>
                            )
                          })()}
                          {o.issue_notes && <p className="text-[10px] text-red-600 mt-1 bg-red-50 px-1.5 py-0.5 rounded">⚠ {o.issue_notes}</p>}
                          {o.comment && <p className="text-[10px] text-[#6b6b66] mt-1 truncate">{o.comment}</p>}
                          {o.order_refs.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {o.order_refs.map(r => <span key={r} className="text-[9px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">{r}</span>)}
                            </div>
                          )}
                          {next && (
                            <button onClick={e => { e.stopPropagation(); moveStatus(o.id, next) }}
                              className="mt-2 w-full text-[10px] font-semibold text-[#6b6b66] hover:text-[#111110] bg-[#f8f8f7] hover:bg-[#f0f0ec] rounded py-1 transition-colors">
                              → {STATUSES.find(s => s.key === next)?.label}
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Detail modal */}
      {detail && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setDetail(null)}>
          <div className="bg-white rounded-xl border border-[#e4e4e0] p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-[15px] font-semibold text-[#111110]">{detail.supplier_name}</h2>
                {detail.invoice_number && <p className="text-[12px] text-[#9a9a95]">Счёт №{detail.invoice_number}</p>}
              </div>
              <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${STATUSES.find(s => s.key === detail.status)?.bg ?? 'bg-gray-50'}`}>
                {STATUSES.find(s => s.key === detail.status)?.label ?? detail.status}
              </span>
            </div>
            <div className="space-y-3 text-[13px]">

              {/* ── Financial block ─────────────────────────────────────────── */}
              {(() => {
                const a    = Number(detail.amount ?? 0)
                const p    = getPaidTotal(detail.id, detail)
                const debt = Math.max(a - p, 0)
                const b    = paymentBadge(detail.amount, p > 0 ? p : detail.payment_amount)
                return (
                  <div className="rounded-xl border border-[#e4e4e0] bg-[#fafaf9] px-4 py-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-[#8a8a85] uppercase tracking-wide">Оплата</span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${b.cls}`}>{b.label}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <p className="text-[10px] text-[#9a9a95] mb-0.5">Сумма счёта</p>
                        <p className="font-semibold text-[#111110]">{a > 0 ? formatMoney(a) : '—'}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-[#9a9a95] mb-0.5">Оплачено</p>
                        <p className="font-semibold text-emerald-700">{p > 0 ? formatMoney(p) : '—'}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-[#9a9a95] mb-0.5">Остаток</p>
                        <p className={`font-semibold ${debt > 0 ? 'text-red-600' : 'text-[#9a9a95]'}`}>{debt > 0 ? formatMoney(debt) : '0 ₽'}</p>
                      </div>
                    </div>
                  </div>
                )
              })()}

              {/* ── Payment history + add payment ────────────────────────────── */}
              <div className="rounded-xl border border-[#e4e4e0] overflow-hidden">
                <div className="px-4 py-2.5 bg-[#fafaf9] border-b border-[#e4e4e0]">
                  <span className="text-[11px] font-bold text-[#8a8a85] uppercase tracking-wide">История оплат</span>
                </div>
                <div className="divide-y divide-[#f4f4f0]">
                  {(paymentsByOrderId[detail.id] ?? []).length === 0 ? (
                    <p className="px-4 py-3 text-[12px] text-[#9a9a95]">Платежей пока нет</p>
                  ) : (
                    <>
                      {(paymentsByOrderId[detail.id] ?? []).map(pmt => (
                        <div key={pmt.id} className="px-4 py-2.5 flex items-start justify-between gap-3">
                          <div>
                            <p className="text-[12px] text-[#6b6b66]">{pmt.payment_date ? formatDate(pmt.payment_date) : '—'}</p>
                            {pmt.comment && <p className="text-[10px] text-[#9a9a95] mt-0.5">{pmt.comment}</p>}
                          </div>
                          <span className="text-[13px] font-semibold font-mono text-[#111110] flex-shrink-0">{formatMoney(pmt.amount)}</span>
                        </div>
                      ))}
                      {(() => {
                        const paid = getPaidTotal(detail.id, detail)
                        const debt = Math.max(Number(detail.amount ?? 0) - paid, 0)
                        return (
                          <div className="px-4 py-2.5 bg-[#fafaf9] flex justify-between text-[12px]">
                            <div className="space-y-0.5">
                              <p className="text-[#9a9a95]">Итого оплачено</p>
                              {debt > 0 && <p className="font-semibold text-red-600">Остаток: {formatMoney(debt)}</p>}
                            </div>
                            <span className="font-semibold text-emerald-700">{formatMoney(paid)}</span>
                          </div>
                        )
                      })()}
                    </>
                  )}
                </div>

                {/* Add payment form */}
                <div className="px-4 py-3 border-t border-[#e4e4e0] space-y-2 bg-white">
                  <p className="text-[10px] font-bold text-[#8a8a85] uppercase tracking-wide">Добавить платёж</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] text-[#9a9a95] mb-1">Сумма</label>
                      <input type="number" value={newPaymentForm.amount}
                        onChange={e => setNewPaymentForm(f => ({ ...f, amount: e.target.value }))}
                        placeholder="0"
                        className="w-full border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[13px] outline-none focus:border-[#111110]" />
                    </div>
                    <div>
                      <label className="block text-[10px] text-[#9a9a95] mb-1">Дата</label>
                      <input type="date" value={newPaymentForm.date}
                        onChange={e => setNewPaymentForm(f => ({ ...f, date: e.target.value }))}
                        className="w-full border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[13px] outline-none focus:border-[#111110]" />
                    </div>
                  </div>
                  <input value={newPaymentForm.comment}
                    onChange={e => setNewPaymentForm(f => ({ ...f, comment: e.target.value }))}
                    placeholder="Комментарий (необязательно)"
                    className="w-full border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[13px] outline-none focus:border-[#111110]" />
                  <button
                    onClick={() => addPayment(detail.id)}
                    disabled={addingPayment || !newPaymentForm.amount}
                    className="w-full bg-[#111110] text-white text-[12px] font-medium rounded-lg py-1.5 hover:bg-[#2a2a28] disabled:opacity-40">
                    {addingPayment ? 'Сохранение...' : 'Добавить платёж'}
                  </button>
                </div>
              </div>

              {/* ── Pickup block ─────────────────────────────────────────────── */}
              <div className="rounded-xl border border-[#e4e4e0] px-4 py-3 space-y-2">
                <p className="text-[11px] font-bold text-[#8a8a85] uppercase tracking-wide">Вывоз материала</p>
                {detail.pickup_date || detail.pickup_by ? (
                  <div className="space-y-1">
                    {detail.pickup_by   && <Row label="Забрал"     value={detail.pickup_by} />}
                    {detail.pickup_date && <Row label="Дата забора" value={formatDate(detail.pickup_date)} />}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] text-[#9a9a95] mb-1">Кто забирает</label>
                      <input value={pickupForm.by}
                        onChange={e => setPickupForm(f => ({ ...f, by: e.target.value }))}
                        placeholder="Сергей"
                        className="w-full border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[13px] outline-none focus:border-[#111110]" />
                    </div>
                    <div>
                      <label className="block text-[10px] text-[#9a9a95] mb-1">Дата вывоза</label>
                      <input type="date" value={pickupForm.date}
                        onChange={e => setPickupForm(f => ({ ...f, date: e.target.value }))}
                        className="w-full border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[13px] outline-none focus:border-[#111110]" />
                    </div>
                  </div>
                )}
                {detail.status !== 'picked_up' && detail.status !== 'closed' && (
                  <button
                    onClick={() => savePickup(detail.id)}
                    disabled={savingPickup}
                    className="w-full bg-green-600 text-white text-[12px] font-medium rounded-lg py-1.5 hover:bg-green-700 disabled:opacity-40">
                    {savingPickup ? 'Сохранение...' : 'Материал забран'}
                  </button>
                )}
              </div>

              {/* ── Status action buttons ────────────────────────────────────── */}
              <div className="flex flex-wrap gap-2">
                {detail.status !== 'sent_to_payment' && detail.status !== 'paid_ready' && detail.status !== 'picked_up' && detail.status !== 'closed' && (
                  <button onClick={() => moveStatus(detail.id, 'sent_to_payment')}
                    className="flex-1 min-w-[130px] bg-orange-50 text-orange-700 border border-orange-200 text-[12px] font-medium rounded-lg py-1.5 hover:bg-orange-100">
                    Отправить на оплату
                  </button>
                )}
                {detail.status !== 'paid_ready' && detail.status !== 'picked_up' && detail.status !== 'closed' && (
                  <button onClick={() => moveStatus(detail.id, 'paid_ready')}
                    className="flex-1 min-w-[130px] bg-teal-50 text-teal-700 border border-teal-200 text-[12px] font-medium rounded-lg py-1.5 hover:bg-teal-100">
                    Готов к забору
                  </button>
                )}
                {detail.status !== 'closed' && (
                  <button onClick={() => moveStatus(detail.id, 'closed')}
                    className="flex-1 min-w-[130px] bg-gray-50 text-gray-600 border border-gray-200 text-[12px] font-medium rounded-lg py-1.5 hover:bg-gray-100">
                    Закрыть
                  </button>
                )}
              </div>

              {/* ── Other info ───────────────────────────────────────────────── */}
              {detail.approved_by && <Row label="Согласовал" value={detail.approved_by} />}
              {detail.order_refs.length > 0 && <Row label="Заказы" value={detail.order_refs.join(', ')} />}
              <MaterialItemsSummary items={detail.items} />
              {detail.comment    && <Row label="Комментарий" value={detail.comment} />}
              {detail.issue_notes && (
                <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-[12px] text-red-700">⚠ {detail.issue_notes}</div>
              )}
            </div>

            <div className="flex gap-2 mt-5">
              <button onClick={() => openEdit(detail)} className="flex-1 bg-[#111110] text-white text-[13px] font-medium rounded-lg py-2 hover:bg-[#2a2a28]">Редактировать</button>
              <button type="button" onClick={() => printSupplierPdf(detail.items)} className="flex-1 bg-[#f0f0ec] text-[#111110] text-[13px] font-medium rounded-lg py-2 hover:bg-[#e8e8e4]">Сформировать PDF поставщику</button>
              <button onClick={() => deleteOrder(detail.id)} className="px-4 py-2 text-[13px] text-red-600 hover:bg-red-50 rounded-lg">Удалить</button>
              <button onClick={() => setDetail(null)} className="px-4 py-2 text-[13px] text-[#6b6b66] hover:bg-[#f0f0ec] rounded-lg">Закрыть</button>
            </div>
          </div>
        </div>
      )}

      {/* Form modal */}
      {modal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 overflow-y-auto" onClick={e => { if (e.target === e.currentTarget) setModal(false) }}>
          <div className="bg-white rounded-xl border border-[#e4e4e0] p-6 w-full max-w-lg shadow-xl">
            <h2 className="text-[15px] font-semibold text-[#111110] mb-4">{editId ? 'Редактировать закупку' : 'Новая закупка'}</h2>
            <div className="space-y-3">
              <Field label="Поставщик *" required><input value={form.supplier_name} onChange={ff('supplier_name')} placeholder="Название поставщика" className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] text-[#111110] outline-none focus:border-[#111110]" /></Field>
              <Field label="Номер счёта"><input value={form.invoice_number} onChange={ff('invoice_number')} placeholder="INV-001" className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] text-[#111110] outline-none focus:border-[#111110]" /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Сумма (₽)"><input type="number" value={form.amount} onChange={ff('amount')} placeholder="0" className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] text-[#111110] outline-none focus:border-[#111110]" /></Field>
                <Field label="Статус">
                  <select value={form.status} onChange={ff('status')} className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] text-[#111110] outline-none focus:border-[#111110]">
                    {STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Кто согласовал"><input value={form.approved_by} onChange={ff('approved_by')} placeholder="Владислав" className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] text-[#111110] outline-none focus:border-[#111110]" /></Field>
                <Field label="Кто забирает"><input value={form.pickup_by} onChange={ff('pickup_by')} placeholder="Сергей" className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] text-[#111110] outline-none focus:border-[#111110]" /></Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Дата оплаты"><input type="date" value={form.payment_date ?? ''} onChange={ff('payment_date')} className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] text-[#111110] outline-none focus:border-[#111110]" /></Field>
                <Field label="Дата забора"><input type="date" value={form.pickup_date ?? ''} onChange={ff('pickup_date')} className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] text-[#111110] outline-none focus:border-[#111110]" /></Field>
              </div>
              <Field label="Привязка к заказам (через запятую)"><input value={form.order_refs} onChange={ff('order_refs')} placeholder="1795, 1796" className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] text-[#111110] outline-none focus:border-[#111110]" /></Field>
              <Field label="Проблема / брак"><input value={form.issue_notes} onChange={ff('issue_notes')} placeholder="Описание проблемы..." className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] text-[#111110] outline-none focus:border-[#111110]" /></Field>
              <Field label="Комментарий"><textarea value={form.comment} onChange={ff('comment')} placeholder="Любые заметки..." rows={2} className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] text-[#111110] outline-none focus:border-[#111110] resize-none" /></Field>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={save} disabled={saving || !form.supplier_name.trim()}
                className="flex-1 bg-[#111110] text-white text-[13px] font-medium rounded-lg py-2 hover:bg-[#2a2a28] disabled:opacity-40">
                {saving ? 'Сохранение...' : editId ? 'Сохранить' : 'Создать'}
              </button>
              <button onClick={() => setModal(false)} className="flex-1 bg-[#f0f0ec] text-[#6b6b66] text-[13px] font-medium rounded-lg py-2 hover:bg-[#e8e8e4]">Отмена</button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-[#9a9a95] flex-shrink-0">{label}</span>
      <span className="text-[#111110] font-medium text-right">{value}</span>
    </div>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-bold text-[#8a8a85] uppercase tracking-wide mb-1">{label}{required && ' *'}</label>
      {children}
    </div>
  )
}
