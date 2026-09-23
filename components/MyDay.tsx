'use client'

import { useEffect, useState } from 'react'
import type { Coaching, FocusKind } from '@/lib/coaching/rules'

// «Мой день» на главном столе менеджера: что сделать сегодня, одна привычка и что получается.
// Смысл блока — польза, ради которой стоит открыть приложение: в amo эти поводы разбросаны
// по разным местам (пропущенные, чаты, новые заявки, задачи), а здесь они одним списком.

const ICON: Record<FocusKind, string> = {
  missed_call: '📞', waiting_chat: '💬', new_lead: '✨', hot_deal: '🔥', overdue_tasks: '🗂',
}
const ACTION: Record<FocusKind, string> = {
  missed_call: 'Позвонить', waiting_chat: 'Открыть чат', new_lead: 'Открыть заявку', hot_deal: 'Открыть сделку', overdue_tasks: 'Открыть',
}

const fmtRub = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2).replace('.', ',')} млн ₽` : `${Math.round(n / 1000)} тыс ₽`)
const fmtWhen = (iso: string) => {
  const d = new Date(iso)
  const today = new Date().toDateString() === d.toDateString()
  const t = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' })
  return today ? `сегодня в ${t}` : `${d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Moscow' })} в ${t}`
}

export default function MyDay({ amoUserId }: { amoUserId?: number }) {
  type Effect = { last: { day: string; items: number; done: number }; days: number; items: number; done: number } | null
  const [data, setData] = useState<{ coaching: Coaching | null; computedAt?: string; reason?: string; liveAt?: number; effect?: Effect } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [live, setLive] = useState(0)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    const q = new URLSearchParams()
    if (amoUserId) q.set('amo_user_id', String(amoUserId))
    if (live) q.set('live', '1')
    fetch(`/api/manager/coaching${q.toString() ? `?${q}` : ''}`)
      .then(async res => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? `Ошибка ${res.status}`)
        if (!cancelled) { setData(json); setError(null) }
      })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (!cancelled) setBusy(false) })
    return () => { cancelled = true }
  }, [amoUserId, live])

  if (error) return <Shell><p className="text-[13px] text-red-700">{error}</p></Shell>
  if (!data) return <Shell><p className="text-[13px] text-[#9a9a95]">Загружаю…</p></Shell>
  if (!data.coaching) return <Shell><p className="text-[13px] text-[#9a9a95]">{data.reason ?? 'Пока нечего показать'}</p></Shell>

  const c = data.coaching
  return (
    <Shell
      computedAt={data.computedAt}
      liveAt={data.liveAt}
      name={amoUserId ? c.name : undefined}
      onRefresh={() => { setBusy(true); setLive(n => n + 1) }}
      busy={busy}
    >
      {c.focus.length === 0 ? (
        <p className="text-[14px] text-[#111110]">Ни одного зависшего клиента — всё разобрано. Отличный день, чтобы вернуться к сделкам, где давно не было касаний.</p>
      ) : (
        <ol className="space-y-2">
          {c.focus.map((f, i) => (
            <li key={`${f.kind}-${f.leadId ?? i}`} className="flex items-start gap-3 py-2 border-b border-[#f0f0ec] last:border-0">
              <span className="text-[16px] leading-6 w-6 shrink-0 text-center" aria-hidden>{ICON[f.kind]}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-[14px] font-medium text-[#111110]">{f.title}</span>
                <span className="block text-[12px] text-[#6b6b66] mt-0.5">{f.detail}</span>
              </span>
              {f.url && (
                <a href={f.url} target={f.url.startsWith('tel:') ? undefined : '_blank'} rel="noreferrer"
                  className="shrink-0 text-[12px] font-medium px-3 py-1.5 rounded-md bg-[#111110] text-white hover:bg-[#2c2c2a]">
                  {ACTION[f.kind]}
                </a>
              )}
            </li>
          ))}
        </ol>
      )}
      {c.focusMore > 0 && <p className="text-[12px] text-[#9a9a95] mt-2">Ещё {c.focusMore} похожих поводов — разберём завтра, сегодня хватит этих.</p>}

      {c.habit && (
        <div className="mt-4 rounded-xl bg-[#faf7ef] border border-[#efe6cf] p-3">
          <p className="text-[11px] uppercase tracking-wider text-[#9a8f72]">Привычка недели</p>
          <p className="text-[14px] font-medium text-[#111110] mt-0.5">{c.habit.title}</p>
          <p className="text-[12px] text-[#6b6b66] mt-1">{c.habit.fact} {c.habit.target}</p>
          <p className="text-[13px] text-[#111110] mt-1.5">→ {c.habit.action}</p>
        </div>
      )}

      {c.wins.length > 0 && (
        <div className="mt-3 rounded-xl bg-[#f1f7f2] border border-[#dcebdf] p-3">
          <p className="text-[11px] uppercase tracking-wider text-[#5a7d62]">Что получается</p>
          <ul className="mt-1 space-y-1">
            {c.wins.map(w => (
              <li key={w.title} className="text-[13px] text-[#111110]">
                <b className="font-medium">{w.title}.</b> <span className="text-[#6b6b66]">{w.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.effect && data.effect.last.items > 0 && (
        <p className="text-[12px] text-[#6b6b66] mt-3">
          {data.effect.last.day === new Date().toISOString().slice(0, 10) ? 'Сегодня' : 'В прошлый раз'} закрыто{' '}
          <b className="font-medium text-[#111110]">{data.effect.last.done} из {data.effect.last.items}</b> поводов
          {data.effect.days > 1 && data.effect.items > 0 && ` · за ${data.effect.days} дн. — ${Math.round((data.effect.done / data.effect.items) * 100)}%`}
        </p>
      )}
      <p className="text-[12px] text-[#9a9a95] mt-3">
        За {c.results.days} дней: заявок {c.results.leads} · до оплаты {c.results.paidDeals}
        {c.results.per100 !== null && ` (${String(c.results.per100).replace('.', ',')} на 100)`}
        {c.results.paidBudget > 0 && ` · ${fmtRub(c.results.paidBudget)} в этих сделках`}
      </p>
    </Shell>
  )
}

function Shell({ children, computedAt, liveAt, name, onRefresh, busy }: {
  children: React.ReactNode; computedAt?: string; liveAt?: number; name?: string
  onRefresh?: () => void; busy?: boolean
}) {
  return (
    <section className="bg-white border border-[#e4e4e0] rounded-2xl p-4">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <h2 className="text-[15px] font-bold text-[#111110]">Мой день{name ? ` — ${name}` : ''}</h2>
        <span className="flex items-baseline gap-2">
          {(liveAt || computedAt) && (
            <span className="text-[11px] text-[#9a9a95]">
              {liveAt ? `список на ${fmtWhen(new Date(liveAt * 1000).toISOString())}` : `обновлено ${fmtWhen(computedAt!)}`}
            </span>
          )}
          {onRefresh && (
            <button onClick={onRefresh} disabled={busy}
              className="text-[11px] px-2 py-1 rounded-md border border-[#e4e4e0] text-[#6b6b66] hover:bg-[#f5f5f3] disabled:opacity-50">
              {busy ? 'Считаю…' : 'Обновить'}
            </button>
          )}
        </span>
      </div>
      {children}
    </section>
  )
}
