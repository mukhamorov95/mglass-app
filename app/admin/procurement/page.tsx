'use client'

import { useEffect, useState } from 'react'

const STATUSES = [
  { key: 'invoice_received', label: 'Счёт получен',     color: 'border-t-gray-400',   bg: 'bg-gray-50' },
  { key: 'pending_approval', label: 'На согласовании',  color: 'border-t-yellow-400', bg: 'bg-yellow-50' },
  { key: 'waiting_payment',  label: 'Ожидает оплаты',   color: 'border-t-orange-400', bg: 'bg-orange-50' },
  { key: 'partially_paid',   label: 'Частично оплачен', color: 'border-t-blue-400',   bg: 'bg-blue-50' },
  { key: 'paid',             label: 'Оплачен',          color: 'border-t-teal-400',   bg: 'bg-teal-50' },
  { key: 'in_transit',       label: 'В пути',           color: 'border-t-purple-400', bg: 'bg-purple-50' },
  { key: 'picked_up',        label: 'Забран',           color: 'border-t-green-400',  bg: 'bg-green-50' },
  { key: 'closed',           label: 'Закрыто',          color: 'border-t-gray-300',   bg: 'bg-gray-50' },
] as const

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
  return d.toLocaleDateString('ru-RU')
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

function normalizeOrder(row: unknown): Order {
  const r = row as Record<string, unknown>
  const allowedStatuses: string[] = STATUSES.map(s => s.key)
  const rawStatus = String(r?.status ?? '')
  const status: Status = allowedStatuses.includes(rawStatus)
    ? (rawStatus as Status)
    : 'invoice_received'

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

  return (
    <div className="mt-4 rounded-xl border border-[#e4e4e0] bg-white p-4">
      <div className="mb-3 text-xs font-bold uppercase tracking-wider text-[#9a9a95]">
        Материалы к закупке
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-xs">
          <thead>
            <tr className="border-b border-[#e4e4e0] text-[#9a9a95]">
              <th className="py-2 pr-3 font-semibold">Материал</th>
              <th className="py-2 pr-3 font-semibold">Толщина</th>
              <th className="py-2 pr-3 font-semibold">Формат листа</th>
              <th className="py-2 pr-3 font-semibold">К закупке</th>
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
        Итого: {totalSheets} листов · {formatM2(totalArea)} · {formatKg(totalWeight)} · {formatMoney(totalCost)}
      </div>
    </div>
  )
}

export default function ProcurementPage() {
  const [orders,    setOrders]    = useState<Order[]>([])
  const [loading,   setLoading]   = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [modal,     setModal]     = useState(false)
  const [form,      setForm]      = useState(EMPTY_FORM)
  const [editId,    setEditId]    = useState<number | null>(null)
  const [saving,    setSaving]    = useState(false)
  const [detail,    setDetail]    = useState<Order | null>(null)

  useEffect(() => { load() }, [])

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

  async function moveStatus(id: number, newStatus: Status) {
    setOrders(prev => prev.map(o => o.id === id ? { ...o, status: newStatus } : o))
    await fetch('/api/admin/purchase-orders', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status: newStatus }) })
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
        <button onClick={openNew} className="px-4 py-2 bg-[#111110] text-white text-[13px] font-medium rounded-lg hover:bg-[#2a2a28]">
          + Новая закупка
        </button>
      </div>

      {loadError && (
        <div className="mx-6 mt-4 bg-red-50 border border-red-100 rounded-lg px-4 py-3 text-[13px] text-red-700">
          ⚠ {loadError}
        </div>
      )}

      {/* Kanban board */}
      <div className="overflow-x-auto pb-6">
        <div className="flex gap-3 px-6 pt-5" style={{ minWidth: STATUSES.length * 248 + 48 }}>
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
                          {o.amount != null && <p className="text-[12px] font-mono font-bold text-emerald-700 mt-1">{formatMoney(o.amount)}</p>}
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
          <div className="bg-white rounded-xl border border-[#e4e4e0] p-6 w-full max-w-3xl shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-[15px] font-semibold text-[#111110]">{detail.supplier_name}</h2>
                {detail.invoice_number && <p className="text-[12px] text-[#9a9a95]">Счёт №{detail.invoice_number}</p>}
              </div>
              <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${STATUSES.find(s => s.key === detail.status)?.bg ?? 'bg-gray-50'}`}>
                {STATUSES.find(s => s.key === detail.status)?.label ?? detail.status}
              </span>
            </div>
            <div className="space-y-2 text-[13px]">
              {detail.amount != null && <Row label="Сумма" value={formatMoney(detail.amount)} />}
              {detail.approved_by && <Row label="Согласовал" value={detail.approved_by} />}
              {detail.payment_date && <Row label="Дата оплаты" value={formatDate(detail.payment_date)} />}
              {detail.payment_amount != null && <Row label="Оплачено" value={formatMoney(detail.payment_amount)} />}
              {detail.pickup_by && <Row label="Забирает" value={detail.pickup_by} />}
              {detail.pickup_date && <Row label="Дата забора" value={formatDate(detail.pickup_date)} />}
              {detail.order_refs.length > 0 && <Row label="Заказы" value={detail.order_refs.join(', ')} />}
              <MaterialItemsSummary items={detail.items} />
              {detail.comment && <Row label="Комментарий" value={detail.comment} />}
              {detail.issue_notes && <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-[12px] text-red-700">⚠ {detail.issue_notes}</div>}
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => openEdit(detail)} className="flex-1 bg-[#111110] text-white text-[13px] font-medium rounded-lg py-2 hover:bg-[#2a2a28]">Редактировать</button>
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
