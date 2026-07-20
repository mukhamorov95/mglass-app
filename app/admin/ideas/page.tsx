'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'

// Идеи цеха — вид руководства: все обращения + скрытый от рабочих блок оценки
// (заметки, экономический эффект с обоснованием, премия). RLS: reviews видят только owner.

type Idea = {
  id: number
  author_name: string
  raw_text: string
  problem: string
  solution: string
  ai_hint: string | null
  status: 'new' | 'review' | 'accepted' | 'implemented' | 'rejected'
  created_at: string
}
type Review = {
  idea_id: number
  admin_notes: string | null
  economy_rub: number | null
  economy_proof: string | null
  bonus_rub: number | null
  bonus_paid_at: string | null
  reviewed_by: string | null
}

const STATUSES: { key: Idea['status']; label: string; cls: string }[] = [
  { key: 'new',         label: 'Новое',       cls: 'bg-[#f0f0ec] text-[#6b6b66]' },
  { key: 'review',      label: 'На планёрке', cls: 'bg-blue-50 text-blue-700' },
  { key: 'accepted',    label: 'Принято',     cls: 'bg-amber-50 text-amber-700' },
  { key: 'implemented', label: 'Внедрено',    cls: 'bg-emerald-50 text-emerald-700' },
  { key: 'rejected',    label: 'Отклонено',   cls: 'bg-red-50 text-red-600' },
]

export default function AdminIdeasPage() {
  const sb = createClient()
  const [ideas, setIdeas] = useState<Idea[]>([])
  const [reviews, setReviews] = useState<Map<number, Review>>(new Map())
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [meName, setMeName] = useState('')

  // Черновик оценки для раскрытой карточки
  const [rNotes, setRNotes] = useState('')
  const [rEconomy, setREconomy] = useState('')
  const [rProof, setRProof] = useState('')
  const [rBonus, setRBonus] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await sb.auth.getUser()
    if (user) {
      const { data: p } = await sb.from('users').select('name').eq('id', user.id).maybeSingle()
      setMeName(p?.name ?? user.email ?? '')
    }
    const [{ data: i }, { data: r }] = await Promise.all([
      sb.from('production_ideas').select('*').order('id', { ascending: false }).limit(300),
      sb.from('production_idea_reviews').select('*'),
    ])
    setIdeas((i ?? []) as Idea[])
    setReviews(new Map(((r ?? []) as Review[]).map(x => [x.idea_id, x])))
    setLoading(false)
  }, [sb])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load().catch(() => setLoading(false)) }, [load])

  function openCard(idea: Idea) {
    if (expanded === idea.id) { setExpanded(null); return }
    const rv = reviews.get(idea.id)
    setRNotes(rv?.admin_notes ?? '')
    setREconomy(rv?.economy_rub != null ? String(rv.economy_rub) : '')
    setRProof(rv?.economy_proof ?? '')
    setRBonus(rv?.bonus_rub != null ? String(rv.bonus_rub) : '')
    setExpanded(idea.id)
  }

  async function setStatus(id: number, status: Idea['status']) {
    setBusy(true)
    try { await sb.from('production_ideas').update({ status, updated_at: new Date().toISOString() }).eq('id', id); load() }
    finally { setBusy(false) }
  }

  async function saveReview(id: number) {
    setBusy(true)
    try {
      await sb.from('production_idea_reviews').upsert({
        idea_id: id,
        admin_notes: rNotes.trim() || null,
        economy_rub: rEconomy !== '' ? Number(rEconomy) : null,
        economy_proof: rProof.trim() || null,
        bonus_rub: rBonus !== '' ? Number(rBonus) : null,
        reviewed_by: meName || null,
        updated_at: new Date().toISOString(),
      })
      load()
    } finally { setBusy(false) }
  }

  const totalEconomy = [...reviews.values()].reduce((s, r) => s + (r.economy_rub ?? 0), 0)
  const totalBonus   = [...reviews.values()].reduce((s, r) => s + (r.bonus_rub ?? 0), 0)

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-5">
          <h1 className="text-2xl font-bold text-gray-900">Идеи цеха</h1>
          <p className="text-sm text-gray-500 mt-1">
            Обращения рабочих + оценка (рабочие этот блок не видят). Эффект: {Math.round(totalEconomy).toLocaleString('ru-RU')} ₽/мес · премии: {Math.round(totalBonus).toLocaleString('ru-RU')} ₽
          </p>
        </div>

        {loading ? <p className="text-sm text-gray-400">Загрузка…</p> : ideas.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-400">Обращений пока нет</div>
        ) : (
          <div className="space-y-3">
            {ideas.map(idea => {
              const rv = reviews.get(idea.id)
              const isOpen = expanded === idea.id
              const sm = STATUSES.find(s => s.key === idea.status) ?? STATUSES[0]
              return (
                <div key={idea.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <button className="w-full text-left px-5 py-4" onClick={() => openCard(idea)}>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <p className="text-[15px] font-bold text-gray-900">№{idea.id} · {idea.author_name}</p>
                      <div className="flex items-center gap-2">
                        {rv?.economy_rub != null && <span className="text-[11px] font-mono font-semibold text-emerald-700">+{Math.round(rv.economy_rub).toLocaleString('ru-RU')} ₽/мес</span>}
                        {rv?.bonus_rub != null && <span className="text-[11px] font-mono text-amber-700">🏆 {Math.round(rv.bonus_rub).toLocaleString('ru-RU')} ₽</span>}
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${sm.cls}`}>{sm.label}</span>
                      </div>
                    </div>
                    <p className="text-[13px] text-gray-800"><span className="font-semibold text-red-600">Проблема:</span> {idea.problem}</p>
                    {idea.solution && <p className="text-[13px] text-gray-800 mt-0.5"><span className="font-semibold text-emerald-700">Решение:</span> {idea.solution}</p>}
                    <p className="text-[11px] text-gray-400 mt-1">{new Date(idea.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}</p>
                  </button>

                  {isOpen && (
                    <div className="border-t border-gray-100 px-5 py-4 bg-gray-50 space-y-3">
                      {idea.ai_hint && (
                        <p className="text-[12px] text-blue-800 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">💡 AI-подсказка (видел и рабочий): {idea.ai_hint}</p>
                      )}
                      {idea.raw_text && (
                        <details className="text-[12px] text-gray-500">
                          <summary className="cursor-pointer select-none">Исходная диктовка</summary>
                          <p className="mt-1 italic">{idea.raw_text}</p>
                        </details>
                      )}
                      {/* Статус */}
                      <div className="flex gap-1.5 flex-wrap">
                        {STATUSES.map(s => (
                          <button key={s.key} disabled={busy || idea.status === s.key} onClick={() => setStatus(idea.id, s.key)}
                            className={`text-[12px] font-semibold px-2.5 py-1 rounded-lg transition-colors ${idea.status === s.key ? s.cls + ' cursor-default' : 'bg-white border border-gray-200 text-gray-500 hover:bg-gray-100'}`}>
                            {s.label}
                          </button>
                        ))}
                      </div>
                      {/* Скрытый блок оценки */}
                      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-2.5">
                        <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400">Оценка руководства (не видна рабочим)</p>
                        <textarea value={rNotes} onChange={e => setRNotes(e.target.value)} rows={2} placeholder="Заметки: что проверили, что решили…"
                          className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-gray-900 resize-none" />
                        <div className="flex gap-2">
                          <label className="flex-1">
                            <span className="text-[10px] uppercase tracking-wide text-gray-400">Эффект, ₽/мес</span>
                            <input type="number" value={rEconomy} onChange={e => setREconomy(e.target.value)} placeholder="15000"
                              className="mt-0.5 w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-[13px] font-mono outline-none focus:border-gray-900" />
                          </label>
                          <label className="flex-1">
                            <span className="text-[10px] uppercase tracking-wide text-gray-400">Премия, ₽</span>
                            <input type="number" value={rBonus} onChange={e => setRBonus(e.target.value)} placeholder="5000"
                              className="mt-0.5 w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-[13px] font-mono outline-none focus:border-gray-900" />
                          </label>
                        </div>
                        <textarea value={rProof} onChange={e => setRProof(e.target.value)} rows={3}
                          placeholder="Доказательное обоснование эффекта: цифры ДО/ПОСЛЕ, на чём экономия, как проверяли (чтобы факты нельзя было подстроить)…"
                          className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-gray-900 resize-none" />
                        <button onClick={() => saveReview(idea.id)} disabled={busy}
                          className="w-full bg-gray-900 text-white text-[13px] font-semibold py-2 rounded-lg hover:bg-gray-700 disabled:opacity-40 transition-colors">
                          💾 Сохранить оценку
                        </button>
                        {rv?.reviewed_by && <p className="text-[11px] text-gray-400">Последняя оценка: {rv.reviewed_by}</p>}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
