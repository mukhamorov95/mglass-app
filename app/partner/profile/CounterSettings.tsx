'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { DEFAULT_MARKUP_PCT, normalizeMarkup, retailLine } from '@/lib/partner/counter'

// Наценка точки и шапка КП покупателю (/api/partner/settings). «Есть несохранённое»
// выводится сравнением с последним сохранённым снимком, а не флагом.

type Form = { markupPct: string; kpName: string; kpPhone: string; kpNote: string }

export default function CounterSettings() {
  const [form, setForm] = useState<Form | null>(null)
  const [saved, setSaved] = useState<Form | null>(null)
  const [defaults, setDefaults] = useState({ name: '', phone: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [justSaved, setJustSaved] = useState(false)

  useEffect(() => {
    fetch('/api/partner/settings').then(async r => {
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setErr(d.error || 'Настройки не загрузились'); return }
      const f: Form = { markupPct: String(d.settings.markupPct), kpName: d.settings.kpName, kpPhone: d.settings.kpPhone, kpNote: d.settings.kpNote }
      setForm(f); setSaved(f); setDefaults(d.defaults)
    }).catch(() => setErr('Сеть недоступна — настройки не загрузились'))
  }, [])

  const dirty = !!form && !!saved && JSON.stringify(form) !== JSON.stringify(saved)
  const markup = form ? normalizeMarkup(form.markupPct) : null

  async function save() {
    if (!form || markup == null) return
    setBusy(true); setErr(null); setJustSaved(false)
    try {
      const r = await fetch('/api/partner/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, markupPct: markup }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setErr(d.error || 'Не сохранено'); return }
      const f: Form = { markupPct: String(d.settings.markupPct), kpName: d.settings.kpName, kpPhone: d.settings.kpPhone, kpNote: d.settings.kpNote }
      setForm(f); setSaved(f); setJustSaved(true)
    } catch { setErr('Сеть недоступна — не сохранено') } finally { setBusy(false) }
  }

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setJustSaved(false); setForm(f => f ? { ...f, [k]: e.target.value } : f)
  }

  return (
    <div className="card" id="counter" style={{ marginBottom: 16 }}>
      <div className="card-h"><h3>Прилавок и КП покупателю</h3><Link href="/partner/counter" className="mut" style={{ color: 'var(--blue)' }}>Открыть прилавок →</Link></div>
      <div style={{ padding: 18 }}>
        {!form ? <div className="cap">{err ?? 'Загрузка…'}</div> : (
          <div className="frm">
            <div className="fld">
              <span className="lab">Ваша наценка, %</span>
              <input inputMode="decimal" value={form.markupPct} onChange={set('markupPct')} placeholder={String(DEFAULT_MARKUP_PCT)} />
              <span className="cap">{markup != null
                ? `Закупка 1 000 ₽ → покупателю ${retailLine(1000, markup).toLocaleString('ru-RU')} ₽`
                : 'Число от 0 до 300'}</span>
            </div>
            <div className="fld">
              <span className="lab">Телефон в КП</span>
              <input value={form.kpPhone} onChange={set('kpPhone')} maxLength={40} placeholder={defaults.phone || '+7 …'} />
            </div>
            <div className="fld full">
              <span className="lab">Название в шапке КП</span>
              <input value={form.kpName} onChange={set('kpName')} maxLength={120} placeholder={defaults.name} />
              <span className="cap">Пусто — в шапке будет «{defaults.name}». Бренд и цены M-Glass в КП покупателю не попадают.</span>
            </div>
            <div className="fld full">
              <span className="lab">Приписка внизу КП</span>
              <textarea value={form.kpNote} onChange={set('kpNote')} maxLength={500} rows={2} placeholder="Например: цены действительны 7 дней. Доставка по Мытищам — 1 500 ₽." />
            </div>
          </div>
        )}
        {form && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14, flexWrap: 'wrap' }}>
            <button className="primary" onClick={save} disabled={!dirty || markup == null || busy}
              style={!dirty || markup == null || busy ? { opacity: 0.45, cursor: 'default' } : undefined}>
              {busy ? 'Сохраняю…' : dirty ? 'Сохранить' : 'Сохранено'}
            </button>
            {err && <span style={{ fontSize: 12.5, color: '#dc2626' }}>{err}</span>}
            {justSaved && !dirty && <span className="cap">Сохранено ✓ Новая наценка уже на «Прилавке» и в КП покупателю.</span>}
          </div>
        )}
      </div>
    </div>
  )
}
