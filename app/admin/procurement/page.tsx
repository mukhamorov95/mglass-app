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

type PurchaseItem = {
  material_name: string
  category: string | null
  thickness: number | null
  sheet_width: number | null
  sheet_height: number | null
  area_m2: number
  required_area_m2: number
  sheets_count: number | null
  weight_kg: number
  estimated_cost: number | null
  waste_percent: number
  order_ids: number[]
  order_refs: string[]
  unmatched: boolean
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
  order_refs: string[] | null
  items: PurchaseItem[] | null
  created_at: string
}

const EMPTY_FORM = {
  supplier_name: '', invoice_number: '',
  amount: '', approved_by: '', payment_date: '', payment_amount: '',
  pickup_by: '', pickup_date: '', issue_notes: '', comment: '', order_refs: '',
  status: 'invoice_received' as Status,
}

export default function ProcurementPage() {
  const [orders,  setOrders]  = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [modal,   setModal]   = useState(false)
  const [form,    setForm]    = useState(EMPTY_FORM)
  const [editId,  setEditId]  = useState<number | null>(null)
  const [saving,  setSaving]  = useState(false)
  const [detail,  setDetail]  = useState<Order | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const res = await fetch('/api/admin/purchase-orders')
    setOrders(res.ok ? await res.json() : [])
    setLoading(false)
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
      order_refs:     (o.order_refs ?? []).join(', '),
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
                          {o.amount && <p className="text-[12px] font-mono font-bold text-emerald-700 mt-1">{Number(o.amount).toLocaleString('ru-RU')} ₽</p>}
                          {o.issue_notes && <p className="text-[10px] text-red-600 mt-1 bg-red-50 px-1.5 py-0.5 rounded">⚠ {o.issue_notes}</p>}
                          {o.comment && <p className="text-[10px] text-[#6b6b66] mt-1 truncate">{o.comment}</p>}
                          {o.order_refs && o.order_refs.length > 0 && (
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
          <div className="bg-white rounded-xl border border-[#e4e4e0] p-6 w-full max-w-2xl max-h-[85vh] overflow-y-auto shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-[15px] font-semibold text-[#111110]">{detail.supplier_name}</h2>
                {detail.invoice_number && <p className="text-[12px] text-[#9a9a95]">Счёт №{detail.invoice_number}</p>}
              </div>
              <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${STATUSES.find(s => s.key === detail.status)?.bg}`}>
                {STATUSES.find(s => s.key === detail.status)?.label}
              </span>
            </div>
            <div className="space-y-2 text-[13px]">
              {detail.amount && <Row label="Сумма" value={`${Number(detail.amount).toLocaleString('ru-RU')} ₽`} />}
              {detail.approved_by && <Row label="Согласовал" value={detail.approved_by} />}
              {detail.payment_date && <Row label="Дата оплаты" value={detail.payment_date} />}
              {detail.payment_amount && <Row label="Оплачено" value={`${Number(detail.payment_amount).toLocaleString('ru-RU')} ₽`} />}
              {detail.pickup_by && <Row label="Забирает" value={detail.pickup_by} />}
              {detail.pickup_date && <Row label="Дата забора" value={detail.pickup_date} />}
              {detail.order_refs && detail.order_refs.length > 0 && <Row label="Заказы" value={detail.order_refs.join(', ')} />}
              {detail.comment && <Row label="Комментарий" value={detail.comment} />}
              {detail.issue_notes && <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-[12px] text-red-700">⚠ {detail.issue_notes}</div>}
            </div>

            {/* Материалы к закупке */}
            {(() => {
              const purchaseItems = detail.items ?? []
              return (
                <div className="mt-4">
                  <p className="text-[11px] font-bold text-[#9a9a95] uppercase tracking-widest mb-2">Материалы к закупке</p>
                  {purchaseItems.length === 0 ? (
                    <p className="text-[12px] text-[#b0b0aa]">Материалы не указаны</p>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-[#e4e4e0]">
                      <table className="w-full text-[11px]">
                        <thead className="bg-[#fafaf9] border-b border-[#e4e4e0]">
                          <tr>
                            <th className="text-left px-2.5 py-2 text-[9px] font-semibold text-[#9a9a95] uppercase tracking-widest">Материал</th>
                            <th className="text-right px-2.5 py-2 text-[9px] font-semibold text-[#9a9a95] uppercase tracking-widest whitespace-nowrap">Толщина</th>
                            <th className="text-right px-2.5 py-2 text-[9px] font-semibold text-[#9a9a95] uppercase tracking-widest whitespace-nowrap">Формат</th>
                            <th className="text-right px-2.5 py-2 text-[9px] font-semibold text-[#9a9a95] uppercase tracking-widest">м²</th>
                            <th className="text-right px-2.5 py-2 text-[9px] font-semibold text-[#9a9a95] uppercase tracking-widest">Листов</th>
                            <th className="text-right px-2.5 py-2 text-[9px] font-semibold text-[#9a9a95] uppercase tracking-widest">Вес</th>
                            <th className="text-right px-2.5 py-2 text-[9px] font-semibold text-[#9a9a95] uppercase tracking-widest">Стоимость</th>
                            <th className="text-left px-2.5 py-2 text-[9px] font-semibold text-[#9a9a95] uppercase tracking-widest">Заказы</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#f4f4f0]">
                          {purchaseItems.map((item, idx) => (
                            <tr key={idx} className={`hover:bg-[#fafaf9] ${item.unmatched ? 'bg-amber-50/40' : ''}`}>
                              <td className="px-2.5 py-2 min-w-[120px]">
                                <p className="font-medium text-[#111110]">{item.material_name}</p>
                                {item.category && <p className="text-[9px] text-[#9a9a95]">{item.category}</p>}
                                {item.unmatched && (
                                  <span className="text-[9px] font-medium text-amber-700 bg-amber-50 px-1 py-px rounded">Не найден в справочнике</span>
                                )}
                              </td>
                              <td className="px-2.5 py-2 text-right font-mono text-[#6b6b66] whitespace-nowrap">
                                {item.thickness != null ? `${item.thickness} мм` : '—'}
                              </td>
                              <td className="px-2.5 py-2 text-right font-mono text-[#6b6b66] whitespace-nowrap">
                                {item.sheet_width && item.sheet_height ? `${item.sheet_width}×${item.sheet_height}` : '—'}
                              </td>
                              <td className="px-2.5 py-2 text-right font-mono font-semibold text-[#111110] whitespace-nowrap">
                                {item.area_m2.toFixed(2)}
                              </td>
                              <td className="px-2.5 py-2 text-right font-mono font-semibold text-[#111110]">
                                {item.sheets_count != null ? item.sheets_count : '—'}
                              </td>
                              <td className="px-2.5 py-2 text-right font-mono text-[#6b6b66] whitespace-nowrap">
                                {item.weight_kg.toFixed(1)} кг
                              </td>
                              <td className="px-2.5 py-2 text-right font-mono whitespace-nowrap">
                                {item.estimated_cost != null
                                  ? <span className="font-semibold text-[#111110]">{item.estimated_cost.toLocaleString('ru-RU')} ₽</span>
                                  : <span className="text-[#c4c4be]">—</span>}
                              </td>
                              <td className="px-2.5 py-2 min-w-[80px]">
                                <div className="flex flex-wrap gap-1">
                                  {(item.order_refs ?? []).map((ref, i) => (
                                    <span key={i} className="text-[9px] bg-blue-50 text-blue-600 px-1.5 py-px rounded whitespace-nowrap">{ref}</span>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            })()}

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
              <Field label="Поставщик *" required><input value={form.supplier_name} onChange={ff('supplier_name')} placeholder="Название поставщика" className="inp" /></Field>
              <Field label="Номер счёта"><input value={form.invoice_number} onChange={ff('invoice_number')} placeholder="INV-001" className="inp" /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Сумма (₽)"><input type="number" value={form.amount} onChange={ff('amount')} placeholder="0" className="inp" /></Field>
                <Field label="Статус">
                  <select value={form.status} onChange={ff('status')} className="inp">
                    {STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Кто согласовал"><input value={form.approved_by} onChange={ff('approved_by')} placeholder="Владислав" className="inp" /></Field>
                <Field label="Кто забирает"><input value={form.pickup_by} onChange={ff('pickup_by')} placeholder="Сергей" className="inp" /></Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Дата оплаты"><input type="date" value={form.payment_date} onChange={ff('payment_date')} className="inp" /></Field>
                <Field label="Дата забора"><input type="date" value={form.pickup_date} onChange={ff('pickup_date')} className="inp" /></Field>
              </div>
              <Field label="Привязка к заказам (через запятую)"><input value={form.order_refs} onChange={ff('order_refs')} placeholder="1795, 1796" className="inp" /></Field>
              <Field label="Проблема / брак"><input value={form.issue_notes} onChange={ff('issue_notes')} placeholder="Описание проблемы..." className="inp" /></Field>
              <Field label="Комментарий"><textarea value={form.comment} onChange={ff('comment')} placeholder="Любые заметки..." rows={2} className="inp resize-none" /></Field>
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

      <style>{`.inp{width:100%;background:white;border:1px solid #e4e4e0;border-radius:8px;padding:8px 12px;font-size:13px;color:#111110;outline:none}.inp:focus{border-color:#111110}`}</style>
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
