'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { formatPhone } from '@/lib/b2c/phoneKey'
import { dealStage } from '@/lib/b2c/dealStatus'

// Карточка Сделки (B2C). Паттерн — как /b2b-deal, но модель своя (deals — тонкая
// группировка по объекту). Статус — производная от расчётов (dealStage), не хранится.

type Deal = {
  id: number; client_name: string; phone: string; address: string
  manager_id: string | null; amo_lead_id: string | null; created_by_name: string | null
  created_at: string; updated_at: string
}
type Calc = {
  id: number; product_type: string; final_price: number; margin: number
  status: string; created_at: string; client_name: string | null; client_phone: string | null; parent_calc_id: number | null
  input_data?: Record<string, unknown>
}

const fmt = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`
const date = (s: string) => new Date(s).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })
const PRODUCT: Record<string, string> = { mirror: '🪞 Зеркало', shower: '🚿 Душевая', shower_standard: '🚿 Душевая', shower_budget: '🚿 Душевая', loft: '🏗️ Лофт', railing: '🪜 Ограждение', quick: '⚡ Быстрый' }
const CALC_STATUS: Record<string, string> = { draft: 'Черновик', sent: 'Отправлено', approved: 'Согласовано', rejected: 'Отказ' }

const TONE: Record<string, string> = {
  plain: 'bg-[#f0f0ec] text-[#6b6b66]', sent: 'bg-blue-50 text-blue-700', good: 'bg-emerald-50 text-emerald-700',
}

export default function DealPage() {
  const params = useParams()
  const id = Number(params.id)
  const [deal, setDeal] = useState<Deal | null>(null)
  const [calcs, setCalcs] = useState<Calc[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [edit, setEdit] = useState(false)
  const [form, setForm] = useState({ client_name: '', phone: '', address: '', amo_lead_id: '' })
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const r = await fetch(`/api/deals/${id}`)
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setError(r.status === 403 ? 'Нет доступа к этой сделке' : 'Сделка не найдена'); return }
      setDeal(j.deal); setCalcs(j.calculations ?? [])
      setForm({ client_name: j.deal.client_name ?? '', phone: j.deal.phone ?? '', address: j.deal.address ?? '', amo_lead_id: j.deal.amo_lead_id ?? '' })
      setError(null)
    } catch { setError('Сеть недоступна') } finally { setLoading(false) }
  }
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { if (id) load() }, [id])

  async function save() {
    setSaving(true)
    try {
      const r = await fetch(`/api/deals/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      if (r.ok) { setEdit(false); await load() }
    } finally { setSaving(false) }
  }

  // Открыть расчёт для пересчёта: снимок quick → sessionStorage, дальше калькулятор
  // восстановит поля. Открытие даёт НОВЫЙ расчёт (первичный остаётся в сделке).
  function reopenQuick(c: Calc) {
    if (!c.input_data) return
    // Несём контекст: __parentCalcId связывает вторичный расчёт с первичным,
    // __dealId кладёт пересчёт в ТУ ЖЕ сделку (тот же объект, не спрашиваем заново).
    const payload = { ...c.input_data, __parentCalcId: c.id, __dealId: deal!.id }
    try { sessionStorage.setItem('mglass_quick_reopen', JSON.stringify(payload)) } catch { /* ignore */ }
    window.location.assign('/calculator/quick')
  }

  async function detach(calcId: number) {
    await fetch(`/api/deals/${id}/attach`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ calc_id: calcId, detach: true }) })
    await load()
  }

  if (loading) return <div className="p-6 text-[13px] text-[#9a9a95]">Загрузка…</div>
  if (error || !deal) return (
    <div className="p-6">
      <p className="text-[14px] font-semibold text-[#111110]">{error ?? 'Сделка не найдена'}</p>
      <Link href="/deals" className="text-[13px] text-blue-600 hover:underline mt-2 inline-block">← К сделкам</Link>
    </div>
  )

  const stage = dealStage(calcs)
  const total = calcs.reduce((s, c) => s + (Number(c.final_price) || 0), 0)

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-4">
      <div className="text-[13px]"><Link href="/deals" className="text-[#9a9a95] hover:text-[#6b6b66]">← Сделки</Link></div>

      <div className="bg-white border border-[#e4e4e0] rounded-2xl px-5 py-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-[20px] font-bold text-[#111110]">{deal.client_name || 'Без имени'}</h1>
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${TONE[stage.tone]}`}>{stage.label}</span>
            </div>
            <p className="text-[13px] text-[#6b6b66] mt-0.5">
              {deal.phone ? formatPhone(deal.phone) : 'телефон не указан'}{deal.address ? ` · ${deal.address}` : ''}
            </p>
            <p className="text-[11px] text-[#9a9a95] mt-0.5">
              создана {date(deal.created_at)}{deal.created_by_name ? ` · ${deal.created_by_name}` : ''}
              {deal.amo_lead_id ? ` · Amo: ${deal.amo_lead_id}` : ''}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[18px] font-bold font-mono text-[#111110]">{fmt(total)}</p>
            <button onClick={() => setEdit(v => !v)} className="text-[12px] text-blue-600 hover:underline mt-1">
              {edit ? 'Отмена' : 'Изменить'}
            </button>
          </div>
        </div>

        {edit && (
          <div className="mt-3 pt-3 border-t border-[#f0f0ec] grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input value={form.client_name} onChange={e => setForm(f => ({ ...f, client_name: e.target.value }))} placeholder="Клиент"
              className="border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[13px] outline-none focus:border-[#111110]" />
            <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="Телефон"
              className="border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[13px] outline-none focus:border-[#111110]" />
            <input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="Адрес объекта"
              className="border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[13px] outline-none focus:border-[#111110]" />
            <input value={form.amo_lead_id} onChange={e => setForm(f => ({ ...f, amo_lead_id: e.target.value }))} placeholder="ID сделки в AmoCRM (привязать вручную)"
              className="border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[13px] outline-none focus:border-[#111110]" />
            <div className="sm:col-span-2">
              <button onClick={save} disabled={saving}
                className="text-[13px] font-semibold px-4 py-2 rounded-lg bg-[#111110] text-white hover:bg-[#2a2a28] disabled:opacity-40">
                {saving ? 'Сохраняю…' : 'Сохранить'}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="bg-white border border-[#e4e4e0] rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-[#f0f0ec]">
          <p className="text-[12px] font-semibold text-[#9a9a95] uppercase tracking-wider">Расчёты ({calcs.length})</p>
        </div>
        {calcs.length === 0 ? (
          <p className="px-5 py-4 text-[13px] text-[#9a9a95]">Пока нет расчётов по этой сделке.</p>
        ) : (
          <div className="divide-y divide-[#f0f0ec]">
            {calcs.map((c, i) => (
              <div key={c.id} className="px-5 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] text-[#111110]">{PRODUCT[c.product_type] ?? c.product_type}</span>
                    <span className="text-[10px] text-[#9a9a95] bg-[#f5f5f3] px-1.5 py-0.5 rounded">{CALC_STATUS[c.status] ?? c.status}</span>
                    {i === 0 && calcs.length > 1 && <span className="text-[10px] text-[#9a9a95]">первичный</span>}
                    {c.parent_calc_id && <span className="text-[10px] text-blue-600">пересчёт</span>}
                  </div>
                  <p className="text-[11px] text-[#9a9a95] mt-0.5">{date(c.created_at)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[13px] font-semibold font-mono text-[#111110] whitespace-nowrap">{fmt(Number(c.final_price) || 0)}</span>
                  {c.product_type === 'quick' && (
                    <button onClick={() => reopenQuick(c)} className="text-[12px] text-blue-600 hover:underline whitespace-nowrap">Открыть</button>
                  )}
                  <button onClick={() => detach(c.id)} title="Убрать из сделки" className="text-[#c4c4be] hover:text-red-500">✕</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
