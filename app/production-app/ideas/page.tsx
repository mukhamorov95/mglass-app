'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import ProductionTabs from '@/components/ProductionTabs'
import { createClient } from '@/lib/supabase-browser'

// «Идеи» — кайдзен-обращения рабочих: голосом или текстом описал проблему и
// предложил решение → AI структурирует → отправка → история своих обращений.
// Блок оценки руководства (экономия/премия) хранится в отдельной таблице и
// рабочему недоступен (RLS) — здесь только статус.

type Idea = {
  id: number
  author_name: string
  raw_text: string
  problem: string
  solution: string
  ai_hint: string | null
  status: 'new' | 'review' | 'accepted' | 'implemented' | 'rejected'
  response: string | null
  created_at: string
}

// Порядок колонок доски = путь обращения. «Отклонено» стоит последним и в общий
// поток не входит: это тупик, а не следующая стадия.
const BOARD_FLOW: Idea['status'][] = ['new', 'review', 'accepted', 'implemented']
const BOARD_COLUMNS: Idea['status'][] = [...BOARD_FLOW, 'rejected']

const STATUS_META: Record<Idea['status'], { label: string; cls: string }> = {
  new:         { label: 'Отправлено',   cls: 'bg-[#f0f0ec] text-[#6b6b66]' },
  review:      { label: 'На планёрке',  cls: 'bg-blue-50 text-blue-700' },
  accepted:    { label: 'Принято',      cls: 'bg-amber-50 text-amber-700' },
  implemented: { label: 'Внедрено 🏆',  cls: 'bg-emerald-50 text-emerald-700' },
  rejected:    { label: 'Отклонено',    cls: 'bg-[#f0f0ec] text-[#9a9a95]' },
}

// Web Speech API (Chrome/Android). Тип минимальный — либы не нужны.
type SpeechRec = { start: () => void; stop: () => void; lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null; onerror: (() => void) | null }

export default function IdeasPage() {
  const sb = createClient()
  const [me, setMe] = useState<{ id: string; name: string } | null>(null)
  const [ideas, setIdeas] = useState<Idea[]>([])
  const [loading, setLoading] = useState(true)

  const [rawText, setRawText] = useState('')
  const [recording, setRecording] = useState(false)
  const [speechSupported, setSpeechSupported] = useState(true)
  const recRef = useRef<SpeechRec | null>(null)

  const [parsing, setParsing] = useState(false)
  const [problem, setProblem] = useState('')
  const [solution, setSolution] = useState('')
  const [hint, setHint] = useState('')
  const [sending, setSending] = useState(false)
  const [sentOk, setSentOk] = useState(false)
  // Доска видна только владельцу: RLS и так пускает менять статус лишь admin/ceo,
  // но рабочему незачем показывать чужие обращения и органы управления ими.
  const [isOwner, setIsOwner] = useState(false)
  const [moving, setMoving] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await sb.auth.getUser()
    if (user) {
      const { data: profile } = await sb.from('users').select('name, role').eq('id', user.id).maybeSingle()
      setMe({ id: user.id, name: profile?.name ?? user.email ?? 'Сотрудник' })
      setIsOwner(profile?.role === 'admin' || profile?.role === 'ceo')
    }
    const { data } = await sb.from('production_ideas')
      .select('id,author_name,raw_text,problem,solution,ai_hint,status,response,created_at')
      .order('id', { ascending: false }).limit(100)
    setIdeas((data ?? []) as Idea[])
    setLoading(false)
  }, [sb])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load().catch(() => setLoading(false)) }, [load])

  // Перенос карточки между колонками. Обновляем экран сразу, а не после ответа
  // сервера: доска на планёрке листается быстро, и ожидание в полсекунды читается
  // как «не сработало» — человек жмёт второй раз.
  async function moveIdea(id: number, status: Idea['status']) {
    setMoving(id)
    setIdeas(prev => prev.map(i => (i.id === id ? { ...i, status } : i)))
    const { error } = await sb.from('production_ideas').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) await load()
    setMoving(null)
  }

  function toggleRecording() {
    if (recording) { recRef.current?.stop(); return }
    const W = window as unknown as { webkitSpeechRecognition?: new () => SpeechRec; SpeechRecognition?: new () => SpeechRec }
    const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition
    if (!Ctor) { setSpeechSupported(false); return }
    const rec = new Ctor()
    rec.lang = 'ru-RU'
    rec.continuous = true
    rec.interimResults = false
    rec.onresult = e => {
      let t = ''
      for (let i = 0; i < e.results.length; i++) if (e.results[i].isFinal) t += e.results[i][0].transcript + ' '
      if (t.trim()) setRawText(prev => (prev ? prev + ' ' : '') + t.trim())
    }
    rec.onend = () => setRecording(false)
    rec.onerror = () => setRecording(false)
    recRef.current = rec
    rec.start()
    setRecording(true)
  }

  async function parse() {
    if (!rawText.trim()) return
    setParsing(true)
    try {
      const r = await fetch('/api/ai/parse-idea', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: rawText }),
      }).then(x => x.json())
      if (r.parsed) {
        setProblem(r.parsed.problem ?? '')
        setSolution(r.parsed.solution ?? '')
        setHint(r.parsed.hint ?? '')
      }
    } finally { setParsing(false) }
  }

  async function send() {
    if (!me || !problem.trim()) return
    setSending(true)
    try {
      const { error } = await sb.from('production_ideas').insert({
        author_id: me.id, author_name: me.name,
        raw_text: rawText.trim(), problem: problem.trim(), solution: solution.trim(),
        ai_hint: hint.trim() || null,
      })
      if (!error) {
        setRawText(''); setProblem(''); setSolution(''); setHint('')
        setSentOk(true); setTimeout(() => setSentOk(false), 2500)
        load()
      }
    } finally { setSending(false) }
  }

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-4 pt-12 pb-4 lg:pt-6">
        <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Идеи и проблемы</h1>
        <p className="text-[13px] text-[#9a9a95] mt-0.5">Заметил проблему — расскажи и предложи решение. За внедрённые идеи — премия. Обсуждаем на планёрках пн/пт.</p>
        <ProductionTabs />
      </div>

      <div className="px-4 pt-4 space-y-4 max-w-[700px]">
        {/* Новое обращение */}
        <div className="bg-white rounded-xl border border-[#e4e4e0] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-bold text-[#111110]">Новое обращение</p>
            <button onClick={toggleRecording}
              className={`text-[13px] font-semibold px-4 py-2 rounded-full transition-colors ${recording ? 'bg-red-600 text-white animate-pulse' : 'bg-[#111110] text-white hover:bg-[#2a2a28]'}`}>
              {recording ? '⏹ Стоп' : '🎤 Говорить'}
            </button>
          </div>
          {!speechSupported && (
            <p className="text-[11px] text-amber-600">Голосовой ввод не поддерживается этим браузером — напишите текстом.</p>
          )}
          <textarea value={rawText} onChange={e => setRawText(e.target.value)} rows={3}
            placeholder="Опишите проблему и, если есть, ваше решение — голосом или текстом…"
            className="w-full bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#111110] resize-none" />
          <button onClick={parse} disabled={parsing || !rawText.trim()}
            className="w-full text-[13px] font-semibold py-2 rounded-lg border border-[#e4e4e0] text-[#333] hover:bg-[#f5f5f4] disabled:opacity-40 transition-colors">
            {parsing ? 'Разбираю…' : '🤖 Разобрать на проблему и решение'}
          </button>

          {(problem || solution || hint) && (
            <div className="space-y-2 border-t border-[#f0f0ec] pt-3">
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-widest text-red-600">Проблема</label>
                <textarea value={problem} onChange={e => setProblem(e.target.value)} rows={2}
                  className="mt-1 w-full bg-red-50/50 border border-red-100 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-red-300 resize-none" />
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-widest text-emerald-700">Моё решение</label>
                <textarea value={solution} onChange={e => setSolution(e.target.value)} rows={2}
                  placeholder="Если есть предложение — напишите"
                  className="mt-1 w-full bg-emerald-50/50 border border-emerald-100 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-emerald-300 resize-none" />
              </div>
              {hint && (
                <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-blue-700 mb-0.5">💡 Подсказка</p>
                  <p className="text-[12px] text-blue-900">{hint}</p>
                </div>
              )}
              <button onClick={send} disabled={sending || !problem.trim()}
                className="w-full bg-emerald-600 text-white text-[14px] font-semibold py-2.5 rounded-lg hover:bg-emerald-700 disabled:opacity-40 transition-colors">
                {sending ? 'Отправка…' : sentOk ? '✓ Отправлено' : '📨 Отправить обращение'}
              </button>
            </div>
          )}
          {sentOk && !(problem || solution) && (
            <p className="text-[12px] text-emerald-700 font-medium text-center">✓ Обращение отправлено — спасибо! Обсудим на планёрке.</p>
          )}
        </div>

        {/* История обращений */}
        <div>
          {/* Доска владельца. Карточка двигается выбором колонки, а не перетаскиванием:
              доску смотрят и с телефона, а drag-and-drop пальцем по горизонтально
              прокручиваемым колонкам — это борьба с прокруткой, а не работа. */}
          {isOwner && !loading && ideas.length > 0 && (
            <div className="mb-6">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-[#9a9a95] mb-2">Доска обращений · {ideas.length}</p>
              <div className="flex gap-3 overflow-x-auto pb-2">
                {BOARD_COLUMNS.map(col => {
                  const inCol = ideas.filter(i => (i.status ?? 'new') === col)
                  const meta = STATUS_META[col]
                  return (
                    <div key={col} className="flex-shrink-0 w-[260px]">
                      <div className={`rounded-lg px-2.5 py-1.5 mb-2 text-[11px] font-semibold ${meta.cls}`}>
                        {meta.label} · {inCol.length}
                      </div>
                      <div className="space-y-2">
                        {inCol.length === 0 && (
                          <p className="text-[11px] text-[#c4c4be] px-1">пусто</p>
                        )}
                        {inCol.map(idea => (
                          <div key={idea.id} className={`bg-white rounded-lg border border-[#e4e4e0] px-3 py-2.5 ${moving === idea.id ? 'opacity-50' : ''}`}>
                            <p className="text-[11px] font-bold text-[#111110]">№{idea.id} · {idea.author_name}</p>
                            <p className="text-[12px] text-[#111110] mt-1 line-clamp-3">{idea.problem}</p>
                            {idea.response && <p className="text-[11px] text-emerald-800 mt-1.5 line-clamp-2">✓ {idea.response}</p>}
                            <select value={col} onChange={e => moveIdea(idea.id, e.target.value as Idea['status'])}
                              className="mt-2 w-full bg-white border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[11px] outline-none focus:border-[#111110]">
                              {BOARD_COLUMNS.map(s2 => (
                                <option key={s2} value={s2}>{STATUS_META[s2].label}</option>
                              ))}
                            </select>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <p className="text-[11px] font-semibold uppercase tracking-widest text-[#9a9a95] mb-2">{isOwner ? 'Все обращения' : 'Мои обращения'} · {ideas.length}</p>
          {loading ? (
            <p className="text-[13px] text-[#9a9a95]">Загрузка…</p>
          ) : ideas.length === 0 ? (
            <div className="bg-white rounded-xl border border-[#e4e4e0] p-6 text-center text-[13px] text-[#c4c4be]">Обращений пока нет — вы можете стать первым 🙂</div>
          ) : (
            <div className="space-y-2">
              {ideas.map(idea => {
                const sm = STATUS_META[idea.status] ?? STATUS_META.new
                return (
                  <div key={idea.id} className="bg-white rounded-xl border border-[#e4e4e0] px-4 py-3">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <p className="text-[13px] font-bold text-[#111110]">Обращение №{idea.id}</p>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${sm.cls}`}>{sm.label}</span>
                    </div>
                    <p className="text-[12px] text-[#111110]"><span className="font-semibold text-red-600">Проблема:</span> {idea.problem}</p>
                    {idea.solution && <p className="text-[12px] text-[#111110] mt-0.5"><span className="font-semibold text-emerald-700">Решение:</span> {idea.solution}</p>}
                    {idea.response && (
                      <div className="mt-2 rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2">
                        <p className="text-[11px] font-semibold text-emerald-800 mb-0.5">Что сделали</p>
                        <p className="text-[12px] text-emerald-900">{idea.response}</p>
                      </div>
                    )}
                    <p className="text-[11px] text-[#9a9a95] mt-1.5">{idea.author_name} · {new Date(idea.created_at).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
