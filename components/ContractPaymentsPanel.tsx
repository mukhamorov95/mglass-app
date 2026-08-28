'use client'

import { useEffect, useState, useCallback } from 'react'

// Поступления по счёту: предоплата, промежуточные, остаток. Каждое — отдельная
// запись; первая рождает продажу в Отделе продаж. Ошибочное снимается (история
// остаётся). Раскрывается прямо в строке истории договоров.

type Payment = {
  id: number
  external_key: string
  amount: number
  paid_at: string
  kind: string
  method: string
  note: string | null
  entered_by_name: string | null
  voided_at: string | null
}

const KIND_LABELS: Record<string, string> = {
  prepayment: 'Предоплата',
  remainder: 'Остаток',
  full: 'Полная оплата',
  refund: 'Возврат',
  adjustment: 'Корректировка',
}
const KINDS = ['prepayment', 'remainder', 'full'] as const
const METHODS = ['Счёт', 'Наличные', 'Карта', 'Перевод', 'Другое'] as const

const RUB = (n: number) => Math.round(n).toLocaleString('ru-RU')
const isoToday = () => new Date().toISOString().slice(0, 10)
const fmtDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })

export default function ContractPaymentsPanel({ contractId, total }: { contractId: number; total: number }) {
  // Одним объектом: пришло из одного ответа и обновляется вместе — так и один
  // setState вместо каскада на каждое поле.
  const [data, setData] = useState<{ payments: Payment[]; paid: number; remainder: number; saleId: number | null }>(
    { payments: [], paid: 0, remainder: 0, saleId: null },
  )
  const { payments, paid, remainder, saleId } = data
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const [amount, setAmount] = useState('')
  const [paidAt, setPaidAt] = useState(isoToday())
  const [kind, setKind] = useState<string>('prepayment')
  const [method, setMethod] = useState<string>('Счёт')
  const [note, setNote] = useState('')

  const load = useCallback(async () => {
    try {
      const d = await fetch(`/api/contracts/${contractId}/payment`).then(r => r.json())
      setData({
        payments: Array.isArray(d.payments) ? d.payments : [],
        paid: Number(d.paid ?? 0),
        remainder: Number(d.remainder ?? 0),
        saleId: d.sale?.id ?? null,
      })
    } catch { setErr('Не удалось загрузить поступления') }
    finally { setLoading(false) }
  }, [contractId])
  // eslint-disable-next-line react-hooks/set-state-in-effect -- первичная загрузка поступлений после раскрытия панели
  useEffect(() => { void load() }, [load])

  // Тип следующего поступления подсказываем сами: первое — предоплата,
  // добивающее до полной суммы — остаток.
  function openAdd() {
    const rest = Math.max(0, total - paid)
    setKind(paid === 0 ? 'prepayment' : 'remainder')
    setAmount(rest > 0 ? String(Math.round(rest)) : '')
    setPaidAt(isoToday()); setMethod('Счёт'); setNote(''); setErr(null)
    setAdding(true)
  }

  async function save() {
    const sum = Number(amount)
    if (!(sum > 0)) { setErr('Укажите сумму'); return }
    setSaving(true); setErr(null)
    try {
      const r = await fetch(`/api/contracts/${contractId}/payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: sum, paid_at: paidAt, kind, method, note }),
      })
      const d = await r.json()
      if (!r.ok) { setErr(d.error ?? 'Не сохранилось'); return }
      setAdding(false)
      await load()
    } catch { setErr('Сеть недоступна') }
    finally { setSaving(false) }
  }

  async function voidPay(key: string) {
    if (!confirm('Снять это поступление? Запись останется в истории как отменённая.')) return
    await fetch(`/api/contracts/${contractId}/payment`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ external_key: key }),
    })
    await load()
  }

  if (loading) return <div className="px-4 py-3 text-[12px] text-[#9a9a95]">Загрузка поступлений…</div>

  const pct = total > 0 ? Math.min(100, Math.round(paid / total * 100)) : 0
  const live = payments.filter(p => !p.voided_at)

  return (
    <div className="px-4 py-3 bg-[#fafaf9] border-t border-[#f0f0ec] space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-4 text-[12px]">
          <span className="text-[#6b6b66]">Сумма: <b className="text-[#111110] font-mono">{RUB(total)} ₽</b></span>
          <span className="text-emerald-700">Поступило: <b className="font-mono">{RUB(paid)} ₽</b></span>
          <span className={remainder > 0 ? 'text-amber-700' : 'text-[#9a9a95]'}>
            Остаток: <b className="font-mono">{RUB(remainder)} ₽</b>
          </span>
          {saleId && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">в Отделе продаж</span>}
        </div>
        {!adding && (
          <button onClick={openAdd} className="px-3 py-1.5 rounded-lg bg-[#111110] text-white text-[12px] font-semibold hover:opacity-90">
            ＋ Поступление
          </button>
        )}
      </div>

      {total > 0 && (
        <div className="h-1.5 rounded-full bg-[#e4e4e0] overflow-hidden">
          <div className={`h-full ${pct >= 100 ? 'bg-emerald-500' : 'bg-[#111110]'}`} style={{ width: `${pct}%` }} />
        </div>
      )}

      {adding && (
        <div className="bg-white border border-[#111110] rounded-xl p-3 space-y-2.5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div>
              <span className="block text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">Сумма, ₽</span>
              <input type="number" value={amount} onChange={e => setAmount(e.target.value)} autoFocus
                className="w-full border border-[#e4e4e0] rounded-lg px-2.5 py-1.5 text-[13px] outline-none focus:border-[#111110]" />
            </div>
            <div>
              <span className="block text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">Дата</span>
              <input type="date" value={paidAt} onChange={e => setPaidAt(e.target.value)}
                className="w-full border border-[#e4e4e0] rounded-lg px-2.5 py-1.5 text-[13px] outline-none focus:border-[#111110]" />
            </div>
            <div>
              <span className="block text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">Тип</span>
              <select value={kind} onChange={e => setKind(e.target.value)}
                className="w-full border border-[#e4e4e0] rounded-lg px-2.5 py-1.5 text-[13px] outline-none focus:border-[#111110] bg-white">
                {KINDS.map(k => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
              </select>
            </div>
            <div>
              <span className="block text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">Способ</span>
              <select value={method} onChange={e => setMethod(e.target.value)}
                className="w-full border border-[#e4e4e0] rounded-lg px-2.5 py-1.5 text-[13px] outline-none focus:border-[#111110] bg-white">
                {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Комментарий (необязательно)"
            className="w-full border border-[#e4e4e0] rounded-lg px-2.5 py-1.5 text-[13px] outline-none focus:border-[#111110]" />
          {err && <p className="text-[12px] text-red-600">{err}</p>}
          <div className="flex gap-2">
            <button onClick={save} disabled={saving}
              className="px-4 py-1.5 rounded-lg bg-[#111110] text-white text-[12px] font-semibold disabled:opacity-50">
              {saving ? 'Сохраняю…' : 'Записать поступление'}
            </button>
            <button onClick={() => setAdding(false)} className="px-3 py-1.5 rounded-lg border border-[#e4e4e0] text-[12px] text-[#6b6b66]">Отмена</button>
          </div>
        </div>
      )}

      {live.length === 0 && !adding && (
        <p className="text-[12px] text-[#9a9a95]">Поступлений пока нет — отметьте предоплату, и продажа появится в Отделе продаж.</p>
      )}

      {payments.length > 0 && (
        <div className="space-y-1">
          {payments.map(p => (
            <div key={p.id} className={`flex items-center justify-between gap-2 text-[12px] px-2.5 py-1.5 rounded-lg bg-white border ${p.voided_at ? 'border-[#e4e4e0] opacity-50' : 'border-[#e4e4e0]'}`}>
              <div className="min-w-0 flex items-center gap-2 flex-wrap">
                <span className="font-mono font-semibold text-[#111110]">{RUB(p.amount)} ₽</span>
                <span className="text-[#6b6b66]">{KIND_LABELS[p.kind] ?? p.kind}</span>
                <span className="text-[#9a9a95]">{fmtDate(p.paid_at)} · {p.method}</span>
                {p.entered_by_name && <span className="text-[#c4c4be]">{p.entered_by_name}</span>}
                {p.note && <span className="text-[#9a9a95] truncate">— {p.note}</span>}
                {p.voided_at && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#f0f0ec] text-[#9a9a95]">снято</span>}
              </div>
              {!p.voided_at && (
                <button onClick={() => voidPay(p.external_key)} title="Снять ошибочное поступление"
                  className="text-[11px] text-[#c4c4be] hover:text-red-600 flex-shrink-0">снять</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
