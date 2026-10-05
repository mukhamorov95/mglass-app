'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { SKIP_LABEL, type SkipReason } from '@/lib/reviewEligibility'

type Channel = { channelId: string; name: string; tail: string }

export function Actions({ left, channels }: { left: number; channels: Channel[] }) {
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')
  const [channelId, setChannelId] = useState('')
  const stop = useRef(false)
  const router = useRouter()

  async function post(body: object) {
    const r = await fetch('/api/marketing/reviews', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return r.json().catch(() => ({ error: `сервер ответил ${r.status}` }))
  }

  async function fill() {
    setBusy('fill'); setNote('')
    const j = await post({ action: 'fill' })
    const skipped = Object.entries(j.skipped ?? {})
      .map(([k, v]) => `${SKIP_LABEL[k as SkipReason] ?? k} — ${v}`).join('; ')
    setNote(j.error ? `Ошибка: ${j.error}`
      : `Сделок за 90 дней: ${j.found}, в очередь добавлено ${j.added}.${skipped ? ` Не пишем: ${skipped}.` : ''}`)
    setBusy('')
    router.refresh()
  }

  // Один вызов сервера — 5–6 сообщений с паузами; досылаем, пока не кончится норма дня
  async function send() {
    stop.current = false
    setBusy('send'); setNote('')
    let sent = 0, failed = 0
    while (!stop.current) {
      const j = await post({ action: 'send', channelId })
      if (j.error) { setNote(`Ошибка: ${j.error}. Отправлено до неё: ${sent}`); break }
      sent += j.sent; failed += j.failed
      setNote(`Отправлено ${sent}, не ушло ${failed}. В очереди ${j.pending ?? '—'}, на сегодня осталось ${j.left}${j.note ? ` — ${j.note}` : ''}`)
      router.refresh()
      if (j.note || !j.pending || j.left <= 0 || j.sent + j.failed === 0) break
    }
    setBusy('')
    router.refresh()
  }

  return (
    <>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button onClick={fill} disabled={!!busy}
          className="rounded-lg border border-[#e4e4e0] px-4 py-2 text-sm disabled:opacity-50">
          {busy === 'fill' ? 'Собираю…' : 'Собрать очередь из AmoCRM'}
        </button>
        <select value={channelId} onChange={e => setChannelId(e.target.value)} disabled={!!busy}
          className="rounded-lg border border-[#e4e4e0] px-3 py-2 text-sm">
          <option value="">С какого номера писать…</option>
          {channels.map(c => (
            <option key={c.channelId} value={c.channelId}>{c.name}{c.tail ? ` (…${c.tail})` : ''}</option>
          ))}
        </select>
        {busy === 'send' ? (
          <button onClick={() => { stop.current = true }}
            className="rounded-lg border border-[#e4e4e0] px-4 py-2 text-sm">
            Остановить после текущих сообщений
          </button>
        ) : (
          <button onClick={send} disabled={!!busy || left <= 0 || !channelId}
            className="rounded-lg bg-[#111110] px-4 py-2 text-sm text-white disabled:opacity-50">
            {`Отправить порцию (осталось сегодня ${left})`}
          </button>
        )}
      </div>
      {channels.length === 0 && (
        <p className="mt-2 text-sm text-[#9a9a95]">В Wazzup нет активного номера WhatsApp — отправлять не с чего.</p>
      )}
      {note && <p className="mt-3 text-sm">{note}</p>}
    </>
  )
}
