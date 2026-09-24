'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function Actions({ left }: { left: number }) {
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')
  const router = useRouter()

  async function run(action: 'fill' | 'send') {
    setBusy(action); setNote('')
    const r = await fetch('/api/marketing/reviews', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    const j = await r.json()
    setNote(j.error ? `Ошибка: ${j.error}`
      : action === 'fill' ? `Нашли ${j.found}, добавили новых ${j.added}`
      : `Отправлено ${j.sent}, не ушло ${j.failed}${j.note ? ` — ${j.note}` : ''}`)
    setBusy('')
    router.refresh()
  }

  return (
    <>
      <div className="mt-6 flex flex-wrap gap-3">
        <button onClick={() => run('fill')} disabled={!!busy}
          className="rounded-lg border border-[#e4e4e0] px-4 py-2 text-sm disabled:opacity-50">
          {busy === 'fill' ? 'Собираю…' : 'Собрать очередь из AmoCRM'}
        </button>
        <button onClick={() => run('send')} disabled={!!busy || left <= 0}
          className="rounded-lg bg-[#111110] px-4 py-2 text-sm text-white disabled:opacity-50">
          {busy === 'send' ? 'Отправляю…' : `Отправить порцию (осталось сегодня ${left})`}
        </button>
      </div>
      {note && <p className="mt-3 text-sm">{note}</p>}
    </>
  )
}
