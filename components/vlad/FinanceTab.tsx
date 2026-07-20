'use client'

// Вкладка «Финансы»: реестр обязательств, дата свободы, стратегии гашения.
// Математика — lib/vlad/debtMath.ts (чистый TS, тесты).

import { useEffect, useState, useCallback } from 'react'
import { simulatePayoff, monthlyLoad, totalDebt, type Obligation, type PayoffStrategy } from '@/lib/vlad/debtMath'

const RUB = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'
const KIND_LABEL: Record<string, string> = {
  credit: 'Кредит', card: 'Кредитка', loan_person: 'Долг человеку', mortgage: 'Ипотека', tax: 'Налоги', other: 'Другое',
}
const MONTHS_RU = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря']
const fmtFreedom = (iso: string) => { const d = new Date(iso); return `${d.getDate()} ${MONTHS_RU[d.getMonth()]} ${d.getFullYear()}` }
const yearsMonths = (m: number) => {
  const y = Math.floor(m / 12), r = m % 12
  if (y === 0) return `${r} мес`
  return r === 0 ? `${y} г` : `${y} г ${r} мес`
}

type Form = { creditor: string; kind: string; principal: string; rate_pct: string; monthly_payment: string; due_day: string; note: string }
const EMPTY: Form = { creditor: '', kind: 'credit', principal: '', rate_pct: '', monthly_payment: '', due_day: '', note: '' }

export default function FinanceTab({ now }: { now: number }) {
  const [obs, setObs] = useState<Obligation[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<Form>(EMPTY)
  const [editId, setEditId] = useState<number | null>(null)
  const [strategy, setStrategy] = useState<PayoffStrategy>('avalanche')
  const [extra, setExtra] = useState(0)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const r = await fetch('/api/vlad/obligations')
    const d = await r.json().catch(() => ({}))
    if (r.ok) setObs(d.obligations ?? [])
    setLoading(false)
  }, [])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  async function save() {
    setSaving(true)
    const body = {
      ...(editId ? { id: editId } : {}),
      creditor: form.creditor, kind: form.kind,
      principal: Number(form.principal.replace(/\s/g, '')),
      rate_pct: Number(form.rate_pct.replace(',', '.')) || 0,
      monthly_payment: Number(form.monthly_payment.replace(/\s/g, '')) || 0,
      due_day: form.due_day ? Number(form.due_day) : null,
      note: form.note || null,
    }
    const r = await fetch('/api/vlad/obligations', {
      method: editId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    setSaving(false)
    if (r.ok) { setShowForm(false); setForm(EMPTY); setEditId(null); await load() }
    else alert((await r.json().catch(() => ({}))).error ?? 'Не сохранилось')
  }

  async function toggleClosed(o: Obligation) {
    await fetch('/api/vlad/obligations', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: o.id, closed: !o.closed_at }) })
    await load()
  }

  function startEdit(o: Obligation) {
    setEditId(o.id)
    setForm({ creditor: o.creditor, kind: o.kind, principal: String(o.principal), rate_pct: String(o.rate_pct), monthly_payment: String(o.monthly_payment), due_day: o.due_day ? String(o.due_day) : '', note: o.note ?? '' })
    setShowForm(true)
  }

  if (loading) return <div className="py-10 text-center text-[13px] text-[#9a9a95]">Загрузка…</div>

  const active = obs.filter(o => !o.closed_at)
  const closed = obs.filter(o => o.closed_at)
  const load_ = monthlyLoad(obs)
  const debt = totalDebt(obs)
  const startISO = now ? new Date(now).toISOString() : '2026-01-01'
  const sim = active.length ? simulatePayoff(obs, strategy, extra, startISO) : null
  const simAlt = active.length ? simulatePayoff(obs, strategy === 'avalanche' ? 'snowball' : 'avalanche', extra, startISO) : null
  const simBase = active.length && extra > 0 ? simulatePayoff(obs, strategy, 0, startISO) : null

  return (
    <div className="space-y-4">
      {/* Дата свободы */}
      {sim && (
        <div className="bg-[#111110] text-white rounded-xl p-4">
          <p className="text-[11px] uppercase tracking-widest text-[#9a9a95]">Свобода от долгов</p>
          {sim.months >= 600
            ? <p className="text-[22px] font-bold text-red-400 mt-1">При текущих платежах — недостижима</p>
            : <>
                <p className="text-[26px] font-bold mt-1">{fmtFreedom(sim.freedomDate)}</p>
                <p className="text-[13px] text-[#c9c9c4]">через {yearsMonths(sim.months)} · процентов сверху {RUB(sim.totalInterest)}</p>
              </>}
          {sim.stuck.length > 0 && (
            <p className="text-[12px] text-red-400 mt-2">⚠ Платёж не покрывает проценты: {sim.stuck.join(', ')} — долг растёт</p>
          )}
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div className="bg-[#1d1d1c] rounded-lg p-2.5">
              <p className="text-[11px] text-[#9a9a95]">Всего долгов</p>
              <p className="text-[16px] font-bold font-mono">{RUB(debt)}</p>
            </div>
            <div className="bg-[#1d1d1c] rounded-lg p-2.5">
              <p className="text-[11px] text-[#9a9a95]">Платежи в месяц</p>
              <p className="text-[16px] font-bold font-mono">{RUB(load_)}</p>
            </div>
          </div>
        </div>
      )}

      {/* Стратегия и досрочка */}
      {active.length > 0 && (
        <div className="bg-white rounded-xl border border-[#e4e4e0] p-4">
          <div className="flex bg-[#f0f0ec] rounded-[10px] p-[3px]">
            {(['avalanche', 'snowball'] as const).map(s => (
              <button key={s} onClick={() => setStrategy(s)}
                className={`flex-1 py-2 rounded-lg text-[13px] font-medium ${strategy === s ? 'bg-white shadow-sm text-[#111110]' : 'text-[#6b6b66]'}`}>
                {s === 'avalanche' ? 'По ставке' : 'По размеру'}
              </button>
            ))}
          </div>
          <p className="text-[12px] text-[#9a9a95] mt-2">
            {strategy === 'avalanche'
              ? 'Досрочка идёт в самую дорогую ставку — меньше всего процентов.'
              : 'Досрочка идёт в самый маленький долг — быстрые закрытия, видимые победы.'}
            {sim && simAlt && sim.totalInterest !== simAlt.totalInterest && (
              <> Разница со второй стратегией: <b>{RUB(Math.abs(sim.totalInterest - simAlt.totalInterest))}</b>.</>
            )}
          </p>
          <div className="mt-4">
            <div className="flex items-baseline justify-between">
              <p className="text-[13px] font-medium text-[#111110]">Если добавлять сверху</p>
              <p className="text-[15px] font-bold font-mono text-[#111110]">{RUB(extra)}/мес</p>
            </div>
            <input type="range" min={0} max={300_000} step={5_000} value={extra}
              onChange={e => setExtra(Number(e.target.value))} className="w-full mt-2 accent-[#111110]" />
            {sim && simBase && sim.months < 600 && (
              <p className="text-[12px] text-emerald-700 mt-1">
                Быстрее на {yearsMonths(Math.max(0, simBase.months - sim.months))} · процентов меньше на {RUB(Math.max(0, simBase.totalInterest - sim.totalInterest))}
              </p>
            )}
          </div>
          {sim && sim.closures.length > 0 && sim.months < 600 && (
            <div className="mt-4 border-t border-[#f0f0ec] pt-3">
              <p className="text-[12px] font-medium text-[#9a9a95] mb-1.5">Порядок закрытий:</p>
              <div className="space-y-1">
                {sim.closures.map((c, i) => (
                  <p key={i} className="text-[13px] text-[#111110]">{i + 1}. {c.creditor} — через {yearsMonths(c.month)}</p>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Список */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-[#111110]">Обязательства {active.length > 0 && `· ${active.length}`}</h2>
          <button onClick={() => { setEditId(null); setForm(EMPTY); setShowForm(true) }}
            className="px-3 py-1.5 rounded-lg bg-[#111110] text-white text-[13px] font-medium">＋ Добавить</button>
        </div>

        {active.length === 0 && !showForm && (
          <div className="bg-white rounded-xl border border-[#e4e4e0] p-8 text-center">
            <p className="text-[14px] text-[#111110] font-medium">Пока пусто</p>
            <p className="text-[13px] text-[#9a9a95] mt-1">Внеси все обязательства — кредиты, карты, долги людям, налоги. Дата свободы появится сама.</p>
          </div>
        )}

        {active.map(o => (
          <div key={o.id} className="bg-white rounded-xl border border-[#e4e4e0] p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[14px] font-semibold text-[#111110]">{o.creditor}</p>
                <p className="text-[12px] text-[#9a9a95]">
                  {KIND_LABEL[o.kind] ?? o.kind}{o.rate_pct > 0 && ` · ${o.rate_pct}%`}{o.due_day && ` · платёж до ${o.due_day}-го`}
                </p>
                {o.note && <p className="text-[12px] text-[#6b6b66] mt-1">{o.note}</p>}
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-[15px] font-bold font-mono text-[#111110]">{RUB(o.principal)}</p>
                <p className="text-[12px] text-[#9a9a95] font-mono">{RUB(o.monthly_payment)}/мес</p>
              </div>
            </div>
            <div className="flex gap-2 mt-2.5">
              <button onClick={() => startEdit(o)} className="text-[12px] text-[#6b6b66] px-2 py-1 rounded-md border border-[#e4e4e0]">Изменить</button>
              <button onClick={() => toggleClosed(o)} className="text-[12px] text-emerald-700 px-2 py-1 rounded-md border border-emerald-200">✓ Погашено</button>
            </div>
          </div>
        ))}

        {closed.length > 0 && (
          <div className="pt-2">
            <p className="text-[12px] font-medium text-[#9a9a95] mb-1.5">🏆 Закрытые ({closed.length})</p>
            {closed.map(o => (
              <div key={o.id} className="flex items-center justify-between bg-[#fafaf9] rounded-lg border border-[#f0f0ec] px-3 py-2 mb-1.5">
                <p className="text-[13px] text-[#9a9a95] line-through">{o.creditor}</p>
                <button onClick={() => toggleClosed(o)} className="text-[11px] text-[#9a9a95]">вернуть</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Форма */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center" onClick={() => setShowForm(false)}>
          <div className="bg-white w-full sm:max-w-[420px] rounded-t-2xl sm:rounded-2xl p-5 space-y-3" onClick={e => e.stopPropagation()}>
            <h3 className="text-[16px] font-semibold text-[#111110]">{editId ? 'Изменить' : 'Новое обязательство'}</h3>
            <input placeholder="Кому (банк, человек…)" value={form.creditor} onChange={e => setForm({ ...form, creditor: e.target.value })}
              className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2.5 text-[14px] outline-none focus:border-[#111110]" />
            <select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}
              className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2.5 text-[14px] outline-none bg-white">
              {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <input placeholder="Остаток, ₽" inputMode="numeric" value={form.principal} onChange={e => setForm({ ...form, principal: e.target.value })}
                className="border border-[#e4e4e0] rounded-lg px-3 py-2.5 text-[14px] outline-none focus:border-[#111110]" />
              <input placeholder="Ставка, % год" inputMode="decimal" value={form.rate_pct} onChange={e => setForm({ ...form, rate_pct: e.target.value })}
                className="border border-[#e4e4e0] rounded-lg px-3 py-2.5 text-[14px] outline-none focus:border-[#111110]" />
              <input placeholder="Платёж/мес, ₽" inputMode="numeric" value={form.monthly_payment} onChange={e => setForm({ ...form, monthly_payment: e.target.value })}
                className="border border-[#e4e4e0] rounded-lg px-3 py-2.5 text-[14px] outline-none focus:border-[#111110]" />
              <input placeholder="День платежа" inputMode="numeric" value={form.due_day} onChange={e => setForm({ ...form, due_day: e.target.value })}
                className="border border-[#e4e4e0] rounded-lg px-3 py-2.5 text-[14px] outline-none focus:border-[#111110]" />
            </div>
            <input placeholder="Заметка (необязательно)" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })}
              className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2.5 text-[14px] outline-none focus:border-[#111110]" />
            <div className="flex gap-2 pt-1">
              <button onClick={() => setShowForm(false)} className="flex-1 py-2.5 rounded-lg border border-[#e4e4e0] text-[14px] text-[#6b6b66]">Отмена</button>
              <button onClick={save} disabled={saving} className="flex-1 py-2.5 rounded-lg bg-[#111110] text-white text-[14px] font-semibold disabled:opacity-50">
                {saving ? 'Сохраняю…' : 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
