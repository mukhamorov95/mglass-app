'use client'

import { useState, useEffect } from 'react'
import { PageHeader } from '@/components/ds'

type ReelsIdea = { topic: string; hook: string; why_today: string }
type TopReel = { title: string; hook: string; structure_summary: string; narrator_text: string; cta: string }
type TelegramPost = { text: string; cta: string }
type WhatsAppStatus = { text: string }
type B2BIdea = { topic: string; hook: string; format: string; action: string }
type PartnerAction = { description: string; message_template: string }

type DailyPlan = {
  date: string
  reels_ideas: ReelsIdea[]
  top_reel_script: TopReel
  telegram_post: TelegramPost
  whatsapp_status: WhatsAppStatus
  b2b_idea: B2BIdea
  partner_action: PartnerAction
  insight: string
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {})
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface border border-line rounded-xl p-5">
      <p className="text-[11px] font-semibold text-muted uppercase tracking-wider mb-3">{title}</p>
      {children}
    </div>
  )
}

function CopyBtn({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    copyToClipboard(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <button onClick={copy} className="text-[11px] text-blue-600 hover:underline flex-shrink-0">
      {copied ? 'Скопировано!' : (label ?? 'Копировать')}
    </button>
  )
}

export default function DailyPage() {
  const [today] = useState(() => new Date().toISOString().slice(0, 10))
  const [plan, setPlan] = useState<DailyPlan | null>(null)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [selectedDate, setSelectedDate] = useState(today)

  async function loadCached(date: string) {
    const res = await fetch(`/api/marketing/daily?date=${date}`)
    const rows = await res.json()
    if (Array.isArray(rows) && rows.length > 0) {
      const planRow = rows.find((r: { content_type: string }) => r.content_type === 'daily_plan')
      if (planRow?.content) {
        setPlan(planRow.content as DailyPlan)
        return true
      }
    }
    return false
  }

  useEffect(() => {
    loadCached(selectedDate)
  }, [selectedDate])

  async function generate() {
    setGenerating(true)
    setError('')
    setPlan(null)
    try {
      const res = await fetch('/api/ai/content-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'daily' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка генерации')

      const planData = { ...data, date: today }
      setPlan(planData)

      await fetch('/api/marketing/daily', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: today, content_type: 'daily_plan', content: planData }),
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      {/* Header */}
      <PageHeader
        title="Дневная контент-машина"
        subtitle="AI генерирует полный план на день: Reels, Telegram, WhatsApp, B2B, партнёры"
        actions={
          <input
            type="date"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            className="border border-line rounded-lg px-3 py-1.5 text-[12px] focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        }
      />

      {/* Generate button */}
      {!plan && !generating && (
        <div className="bg-surface border border-line rounded-xl p-8 text-center mb-6">
          <p className="text-[15px] font-semibold text-ink mb-2">
            {selectedDate === today ? 'Сгенерировать план на сегодня' : `Нет плана на ${selectedDate}`}
          </p>
          <p className="text-[12px] text-muted mb-5">
            AI создаёт 3 идеи Reels · полный сценарий · Telegram пост · WhatsApp статус · B2B идею · партнёрское действие
          </p>
          {selectedDate === today && (
            <button onClick={generate}
              className="px-6 py-3 bg-ink text-white rounded-xl text-[13px] font-semibold hover:bg-[#2a2a28] transition-colors">
              Запустить AI-генерацию
            </button>
          )}
          {error && <p className="text-[12px] text-red-500 mt-3">{error}</p>}
        </div>
      )}

      {/* Loading */}
      {generating && (
        <div className="bg-surface border border-line rounded-xl p-10 text-center mb-6">
          <div className="flex justify-center gap-2 mb-4">
            {[0, 150, 300].map(d => (
              <span key={d} className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: `${d}ms` }} />
            ))}
          </div>
          <p className="text-[14px] font-medium text-ink mb-1">AI анализирует день и создаёт контент-план...</p>
          <p className="text-[12px] text-muted">Обычно занимает 15–30 секунд</p>
        </div>
      )}

      {/* Plan */}
      {plan && (
        <div className="space-y-4">
          {/* Date + insight */}
          <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl p-5">
            <p className="text-[11px] font-semibold uppercase tracking-wider opacity-80 mb-1">Маркетинговый инсайт дня</p>
            <p className="text-[15px] font-semibold leading-snug">{plan.insight}</p>
            <p className="text-[11px] opacity-60 mt-2">{plan.date}</p>
          </div>

          {/* Reels ideas */}
          <Section title="3 идеи для Reels">
            <div className="space-y-3">
              {plan.reels_ideas?.map((idea, i) => (
                <div key={i} className="border border-line rounded-lg p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <p className="text-[13px] font-semibold text-ink">{idea.topic}</p>
                      <p className="text-[12px] text-blue-600 mt-0.5">"{idea.hook}"</p>
                      <p className="text-[11px] text-muted mt-1">{idea.why_today}</p>
                    </div>
                    <span className="w-7 h-7 rounded-full bg-ink text-white flex items-center justify-center text-[12px] font-semibold flex-shrink-0">
                      {i + 1}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          {/* Top Reel script */}
          {plan.top_reel_script && (
            <Section title="Топ-сценарий дня (готов к съёмке)">
              <div className="space-y-3">
                <div>
                  <p className="text-[11px] text-muted">Название</p>
                  <p className="text-[15px] font-semibold text-ink">{plan.top_reel_script.title}</p>
                </div>
                <div>
                  <p className="text-[11px] text-muted">Хук</p>
                  <p className="text-[13px] font-semibold text-blue-700">"{plan.top_reel_script.hook}"</p>
                </div>
                <div>
                  <p className="text-[11px] text-muted mb-1">Структура</p>
                  <p className="text-[12px] text-ink-soft">{plan.top_reel_script.structure_summary}</p>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[11px] text-muted">Текст диктора</p>
                    <CopyBtn text={plan.top_reel_script.narrator_text} />
                  </div>
                  <pre className="text-[12px] text-ink whitespace-pre-wrap bg-subtle rounded-lg p-3 font-sans leading-relaxed">
                    {plan.top_reel_script.narrator_text}
                  </pre>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <span className="text-[11px] font-semibold text-amber-700 uppercase tracking-wider">CTA: </span>
                  <span className="text-[12px] text-amber-900">{plan.top_reel_script.cta}</span>
                </div>
              </div>
            </Section>
          )}

          {/* Telegram */}
          {plan.telegram_post && (
            <Section title="Telegram пост">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex-1">
                  <pre className="text-[12px] text-ink whitespace-pre-wrap font-sans bg-[#f0f8ff] rounded-lg p-3">
                    {plan.telegram_post.text}
                  </pre>
                </div>
                <CopyBtn text={plan.telegram_post.text} />
              </div>
              {plan.telegram_post.cta && (
                <p className="text-[11px] text-muted">CTA: {plan.telegram_post.cta}</p>
              )}
            </Section>
          )}

          {/* WhatsApp */}
          {plan.whatsapp_status && (
            <Section title="WhatsApp статус">
              <div className="flex items-start justify-between gap-2">
                <pre className="flex-1 text-[12px] text-ink whitespace-pre-wrap font-sans bg-[#f0fff4] rounded-lg p-3">
                  {plan.whatsapp_status.text}
                </pre>
                <CopyBtn text={plan.whatsapp_status.text} />
              </div>
            </Section>
          )}

          {/* B2B */}
          {plan.b2b_idea && (
            <Section title="B2B — действие дня">
              <div className="space-y-2">
                <div className="flex gap-2 items-start">
                  <span className="text-[11px] px-2 py-0.5 bg-blue-100 text-blue-700 rounded font-medium flex-shrink-0">
                    {plan.b2b_idea.format}
                  </span>
                  <p className="text-[13px] font-semibold text-ink">{plan.b2b_idea.topic}</p>
                </div>
                <p className="text-[12px] text-blue-600">"{plan.b2b_idea.hook}"</p>
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <span className="text-[11px] font-semibold text-amber-700">Действие: </span>
                  <span className="text-[12px] text-amber-900">{plan.b2b_idea.action}</span>
                </div>
              </div>
            </Section>
          )}

          {/* Partner */}
          {plan.partner_action && (
            <Section title="Партнёрская программа — сегодня">
              <p className="text-[12px] text-ink-soft mb-3">{plan.partner_action.description}</p>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[11px] font-semibold text-muted uppercase tracking-wider">Шаблон сообщения</p>
                  <CopyBtn text={plan.partner_action.message_template} />
                </div>
                <pre className="text-[12px] text-ink whitespace-pre-wrap font-sans bg-subtle rounded-lg p-3 border border-line">
                  {plan.partner_action.message_template}
                </pre>
              </div>
            </Section>
          )}

          {/* Regenerate */}
          <div className="flex gap-3 pt-2">
            <button onClick={generate} disabled={generating}
              className="px-4 py-2 border border-line text-ink-soft rounded-xl text-[12px] hover:bg-canvas disabled:opacity-50 transition-colors">
              Перегенерировать
            </button>
            <p className="text-[11px] text-muted self-center">
              Новая генерация заменит текущий план для даты {plan.date}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
