'use client'

import { useEffect, useState } from 'react'
import { DEFAULT_OWNER_DECISIONS, DEFAULT_SYSTEM_FACTS, OWNER_DECISIONS_KEY, SYSTEM_FACTS_KEY } from '@/lib/ai/systemFacts'

// Справка для модели: что уже есть в системе и что владелец решил. Раньше жила в коде —
// устаревала, и модель советовала строить то, что давно работает. Хранится в анкете
// стратегии владельца (owner_strategy), читается при каждом анализе.

type Texts = { facts: string; decisions: string }

export default function SystemFactsEditor() {
  const [texts, setTexts] = useState<Texts | null>(null)
  const [saved, setSaved] = useState<Texts | null>(null)
  const [isDefault, setIsDefault] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [savedAt, setSavedAt] = useState('')

  useEffect(() => {
    fetch('/api/admin/owner-strategy')
      .then(async r => {
        const map = await r.json().catch(() => null) as Record<string, string> | null
        if (!r.ok || !map) { setError('Не удалось загрузить справку для AI'); return }
        const t = { facts: map[SYSTEM_FACTS_KEY] || DEFAULT_SYSTEM_FACTS, decisions: map[OWNER_DECISIONS_KEY] || DEFAULT_OWNER_DECISIONS }
        setTexts(t); setSaved(t)
        setIsDefault(!map[SYSTEM_FACTS_KEY] && !map[OWNER_DECISIONS_KEY])
      })
      .catch(() => setError('Не удалось загрузить справку для AI'))
  }, [])

  const dirty = !!texts && !!saved && (texts.facts !== saved.facts || texts.decisions !== saved.decisions)

  async function save() {
    if (!texts) return
    setSaving(true); setError('')
    try {
      const r = await fetch('/api/admin/owner-strategy', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [SYSTEM_FACTS_KEY]: texts.facts.trim(), [OWNER_DECISIONS_KEY]: texts.decisions.trim() }),
      })
      const j = await r.json().catch(() => null)
      if (!r.ok) { setError(j?.error ?? `Не сохранилось (ошибка ${r.status})`); return }
      setSaved(texts); setIsDefault(false)
      setSavedAt(new Date().toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setSaving(false) }
  }

  if (!texts) return error ? <p className="text-[11px] text-red-700">{error}</p> : null

  const area = 'w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[11px] text-[#3a3a38] bg-white font-mono leading-relaxed'
  return (
    <div className="bg-white rounded-xl border border-[#e8e8e5] p-4 space-y-3">
      <div>
        <p className="text-[12px] font-semibold text-[#2a2a28]">Что модель знает о системе</p>
        <p className="text-[11px] text-[#8a8a85] mt-0.5">
          Читается при каждом анализе. Устарело — модель советует строить то, что уже есть.{isDefault ? ' Сейчас — текст по умолчанию.' : ''}
        </p>
      </div>
      <label className="block">
        <span className="text-[11px] font-semibold text-[#4a4a46]">Уже есть в системе</span>
        <textarea value={texts.facts} onChange={e => setTexts({ ...texts, facts: e.target.value })} rows={8} className={area} />
      </label>
      <label className="block">
        <span className="text-[11px] font-semibold text-[#4a4a46]">Ваши решения — модель не предлагает обратное</span>
        <textarea value={texts.decisions} onChange={e => setTexts({ ...texts, decisions: e.target.value })} rows={6} className={area} />
      </label>
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={!dirty || saving}
          className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-[#111110] text-white hover:bg-[#2a2a28] disabled:opacity-40">
          {saving ? 'Сохраняю…' : 'Сохранить'}
        </button>
        {dirty && <span className="text-[11px] text-amber-700">Есть несохранённые правки</span>}
        {!dirty && savedAt && <span className="text-[11px] text-emerald-700">Сохранено в {savedAt} — модель прочтёт это при следующем анализе</span>}
      </div>
      {error && <p className="text-[11px] text-red-700">{error}</p>}
    </div>
  )
}
