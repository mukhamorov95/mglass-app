'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { KNOWLEDGE_CATEGORIES, type KnowledgeCategory, type KnowledgeGap, type KnowledgeItem } from '@/lib/knowledge/aiKnowledge'

type Tab = 'known' | 'gaps'
type Draft = { id?: number; category: KnowledgeCategory; title: string; content: string; for_bot: boolean; gap_id?: number }

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })

export default function KnowledgePage() {
  const [items, setItems] = useState<KnowledgeItem[]>([])
  const [gaps, setGaps] = useState<KnowledgeGap[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('known')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch('/api/ai/knowledge')
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { setError(data.error ?? 'Не удалось загрузить базу'); setLoading(false); return }
    setItems(data.items ?? []); setGaps(data.gaps ?? []); setError(null); setLoading(false)
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- загрузка с сервера при открытии
  useEffect(() => { load() }, [load])

  const byCat = useMemo(() => {
    const m = new Map<KnowledgeCategory, KnowledgeItem[]>()
    for (const c of KNOWLEDGE_CATEGORIES) m.set(c.key, [])
    for (const i of items) m.get(i.category)?.push(i)
    return m
  }, [items])

  const botCount = items.filter(i => i.for_bot).length
  const emptyCats = KNOWLEDGE_CATEGORIES.filter(c => !(byCat.get(c.key) ?? []).some(i => i.for_bot))

  async function save() {
    if (!draft) return
    setSaving(true)
    const res = await fetch('/api/ai/knowledge', {
      method: draft.id ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    })
    const data = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) { setError(data.error ?? 'Не сохранилось'); return }
    setDraft(null)
    if (draft.gap_id) setTab('known')
    load()
  }

  async function remove(item: KnowledgeItem) {
    if (!confirm(`Убрать «${item.title}» из базы? Бот перестанет это знать.`)) return
    await fetch('/api/ai/knowledge', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: item.id }) })
    load()
  }

  async function toggleBot(item: KnowledgeItem) {
    await fetch('/api/ai/knowledge', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: item.id, for_bot: !item.for_bot }) })
    load()
  }

  async function dismissGap(gap: KnowledgeGap) {
    await fetch('/api/ai/knowledge/gaps', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: gap.id }) })
    load()
  }

  const editor = (d: Draft) => (
    <div className="bg-white border border-[#111110] rounded-xl p-4 space-y-3">
      {d.gap_id && <p className="text-[12px] text-[#9a9a95]">Ответ на вопрос клиента — после сохранения бот будет отвечать на него сам.</p>}
      <div className="flex flex-col sm:flex-row gap-2">
        <select value={d.category} onChange={e => setDraft({ ...d, category: e.target.value as KnowledgeCategory })}
          className="sm:w-56 border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] bg-white">
          {KNOWLEDGE_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <input value={d.title} onChange={e => setDraft({ ...d, title: e.target.value })} placeholder="О чём факт — например, «Гарантия на душевые»"
          className="flex-1 border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px]" />
      </div>
      <textarea value={d.content} onChange={e => setDraft({ ...d, content: e.target.value })} rows={4}
        placeholder="Сам факт, как его должен знать менеджер: коротко, с цифрами и условиями"
        className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] leading-relaxed" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-[13px] text-[#4b4b47]">
          <input type="checkbox" checked={d.for_bot} onChange={e => setDraft({ ...d, for_bot: e.target.checked })} />
          Бот использует в ответах клиентам
        </label>
        <div className="flex gap-2">
          <button onClick={() => setDraft(null)} className="px-3 py-2 rounded-lg text-[13px] text-[#6b6b66] hover:bg-[#f5f5f3]">Отмена</button>
          <button onClick={save} disabled={saving || !d.title.trim() || !d.content.trim()}
            className="px-4 py-2 rounded-lg text-[13px] font-semibold bg-[#111110] text-white disabled:opacity-40">
            {saving ? 'Сохраняю…' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-5 pt-6 pb-4">
        <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">База знаний</h1>
        <p className="text-[12px] text-[#9a9a95] mt-0.5 max-w-2xl">
          Отсюда бот Иван берёт факты о компании. Чего здесь нет — он не выдумывает, а отвечает «уточню» и записывает вопрос во вкладку «Чего не знает». Правка доходит до бота за минуту.
        </p>
      </div>

      <div className="px-5 pt-4 max-w-4xl space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div className="bg-white border border-[#e4e4e0] rounded-xl px-4 py-3">
            <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">Бот знает</p>
            <p className="text-[22px] font-bold text-[#111110] font-mono leading-none">{botCount}</p>
            <p className="text-[11px] text-[#9a9a95] mt-1">фактов в ответах клиентам</p>
          </div>
          <div className="bg-white border border-[#e4e4e0] rounded-xl px-4 py-3">
            <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">Пустые разделы</p>
            <p className={`text-[22px] font-bold font-mono leading-none ${emptyCats.length ? 'text-amber-600' : 'text-emerald-600'}`}>{emptyCats.length}</p>
            <p className="text-[11px] text-[#9a9a95] mt-1 truncate">{emptyCats.length ? emptyCats.map(c => c.label).join(', ') : 'все разделы заполнены'}</p>
          </div>
          <button onClick={() => setTab('gaps')} className="text-left bg-white border border-[#e4e4e0] rounded-xl px-4 py-3 hover:border-[#c4c4be]">
            <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">Вопросы без ответа</p>
            <p className={`text-[22px] font-bold font-mono leading-none ${gaps.length ? 'text-red-600' : 'text-[#111110]'}`}>{gaps.length}</p>
            <p className="text-[11px] text-[#9a9a95] mt-1">клиенты спросили — бот не знал</p>
          </button>
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex bg-[#efefec] rounded-[8px] p-[3px] gap-[2px]">
            {([['known', 'Что знает'], ['gaps', `Чего не знает${gaps.length ? ` · ${gaps.length}` : ''}`]] as [Tab, string][]).map(([v, l]) => (
              <button key={v} onClick={() => setTab(v)}
                className={`px-3 py-[6px] rounded-[6px] text-[12px] font-semibold ${tab === v ? 'bg-white text-[#111110] shadow-sm' : 'text-[#9a9a95] hover:text-[#6b6b66]'}`}>
                {l}
              </button>
            ))}
          </div>
          {tab === 'known' && !draft && (
            <button onClick={() => setDraft({ category: 'company', title: '', content: '', for_bot: true })}
              className="px-3 py-2 rounded-lg text-[13px] font-semibold bg-[#111110] text-white">+ Добавить факт</button>
          )}
        </div>

        {error && <p className="text-[13px] text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}
        {loading && <p className="text-[13px] text-[#9a9a95]">Загружаю…</p>}

        {!loading && tab === 'known' && (
          <div className="space-y-4">
            {draft && !draft.id && editor(draft)}
            {KNOWLEDGE_CATEGORIES.map(cat => {
              const rows = byCat.get(cat.key) ?? []
              return (
                <section key={cat.key} className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-2 px-1">
                    <h2 className="text-[13px] font-semibold text-[#111110]">
                      {cat.label} <span className="font-normal text-[#9a9a95]">· {rows.length}</span>
                    </h2>
                    <button onClick={() => setDraft({ category: cat.key, title: '', content: '', for_bot: true })}
                      className="text-[12px] text-[#6b6b66] hover:text-[#111110]">+ добавить</button>
                  </div>
                  {rows.length === 0 ? (
                    <div className="border border-dashed border-[#d9d9d4] rounded-xl px-4 py-3 text-[12px] text-[#9a9a95]">
                      Пусто — на вопросы про {cat.hint} бот отвечает «уточню».
                    </div>
                  ) : rows.map(item => draft?.id === item.id ? <div key={item.id}>{editor(draft)}</div> : (
                    <div key={item.id} className="bg-white border border-[#e4e4e0] rounded-xl px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[13px] font-semibold text-[#111110]">{item.title}</p>
                          <p className="text-[13px] text-[#4b4b47] leading-relaxed mt-0.5 whitespace-pre-line">{item.content}</p>
                        </div>
                        <button onClick={() => toggleBot(item)} title="Переключить: знает ли это бот"
                          className={`shrink-0 text-[11px] font-semibold px-2 py-1 rounded-full ${item.for_bot ? 'bg-emerald-50 text-emerald-700' : 'bg-[#f0f0ec] text-[#9a9a95]'}`}>
                          {item.for_bot ? 'бот знает' : 'только команде'}
                        </button>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-2">
                        <p className="text-[11px] text-[#b0b0aa]">{fmtDate(item.updated_at)}{item.updated_by ? ` · ${item.updated_by}` : ''}</p>
                        <div className="flex gap-3 text-[12px]">
                          <button onClick={() => setDraft({ id: item.id, category: item.category, title: item.title, content: item.content, for_bot: item.for_bot })}
                            className="text-[#6b6b66] hover:text-[#111110]">Изменить</button>
                          <button onClick={() => remove(item)} className="text-[#b0b0aa] hover:text-red-600">Убрать</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </section>
              )
            })}
          </div>
        )}

        {!loading && tab === 'gaps' && (
          <div className="space-y-2">
            {draft?.gap_id && editor(draft)}
            {gaps.length === 0 ? (
              <div className="bg-white border border-[#e4e4e0] rounded-xl px-4 py-6 text-center text-[13px] text-[#9a9a95]">
                Пока пусто. Когда клиент спросит то, чего нет в базе, вопрос появится здесь.
              </div>
            ) : gaps.map(gap => (
              <div key={gap.id} className="bg-white border border-[#e4e4e0] rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-[#111110]">{gap.question}</p>
                  <p className="text-[11px] text-[#b0b0aa] mt-0.5">
                    {fmtDate(gap.created_at)} · {gap.source === 'avito' ? 'Авито' : gap.source}
                    {gap.lead_id != null && <> · <Link href={`/crm/${gap.lead_id}`} className="underline hover:text-[#6b6b66]">диалог</Link></>}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => setDraft({ category: 'company', title: gap.question, content: '', for_bot: true, gap_id: gap.id })}
                    className="px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-[#111110] text-white">Ответить</button>
                  <button onClick={() => dismissGap(gap)} className="px-3 py-1.5 rounded-lg text-[12px] text-[#6b6b66] hover:bg-[#f5f5f3]">Не нужно</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
