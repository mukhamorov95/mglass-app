'use client'

import { useEffect, useState } from 'react'
import { fmtTime } from '@/lib/amoActivity'
import type { TimelineItem } from '@/lib/amoTimeline'
import { shortDay, weekday } from './ui'

// Что именно человек делал за день — от первого действия до последнего.
// Список строится тем же правилом, что и число в колонке «Действий», поэтому они сходятся.

const ICON = (kind: string) =>
  kind === 'outgoing_chat_message' ? '💬'
    : kind.endsWith('_call') ? '📞'
      : kind.startsWith('task') ? '🗂'
        : kind === 'lead_status_changed' ? '➡️'
          : kind === 'common_note_added' ? '📝'
            : kind.startsWith('custom_field') || kind === 'name_field_changed' || kind === 'sale_field_changed' ? '✏️'
              : kind.startsWith('entity_tag') ? '🏷'
                : '•'

export default function ActionTimeline({ userId, day, name }: { userId: number; day: string; name: string }) {
  const [items, setItems] = useState<TimelineItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/commercial/amo-timeline?amo_user_id=${userId}&day=${day}`)
      .then(async res => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? `Ошибка ${res.status}`)
        if (!cancelled) { setItems(json.items as TimelineItem[]); setError(null) }
      })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
    return () => { cancelled = true }
  }, [userId, day])

  if (error) return <p className="text-[12px] text-red-700">{error}</p>
  if (!items) return <p className="text-[12px] text-[#9a9a95]">Загружаю действия из AmoCRM…</p>
  if (items.length === 0) return <p className="text-[12px] text-[#9a9a95]">За этот день действий в amo нет.</p>

  return (
    <div>
      <p className="text-[12px] text-[#6b6b66] mb-2">
        {name}, {shortDay(day)} {weekday(day)}: {items.length} действий с {fmtTime(items[0].at)} до {fmtTime(items[items.length - 1].at)}
      </p>
      <ol className="border-l border-[#e4e4e0] pl-3 space-y-1">
        {items.map((it, i) => (
          <li key={`${it.at}-${i}`} className="text-[12px] flex items-start gap-2">
            <span className="text-[#9a9a95] tabular-nums w-10 shrink-0">{fmtTime(it.at)}</span>
            <span className="w-4 shrink-0 text-center" aria-hidden>{ICON(it.kind)}</span>
            <span className="min-w-0">
              <span className="text-[#111110]">{it.title}</span>
              {it.detail && <span className="text-[#6b6b66]"> — {it.detail}</span>}
              {it.entity && (
                it.url
                  ? <> · <a href={it.url} target="_blank" rel="noreferrer" className="text-[#6b6b66] underline decoration-[#e4e4e0] hover:decoration-[#111110]">{it.entity}</a></>
                  : <span className="text-[#6b6b66]"> · {it.entity}</span>
              )}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}
