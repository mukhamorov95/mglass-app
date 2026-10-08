'use client'

import { useEffect, useState } from 'react'
import { loadJson, toast } from '@/lib/toast'

// «🔔 Уведомления в Telegram» на табло: ссылка на бота с одноразовым кодом — человек
// жмёт «Start» в Telegram и привязан. Бот ему присылает только уведомления табло.
export default function TelegramLinkButton() {
  const [linked, setLinked] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    loadJson<{ linked: boolean }>('/api/me/telegram-link').then(res => {
      if (alive && res.error === null) setLinked(res.data.linked)
    })
    return () => { alive = false }
  }, [])

  async function link() {
    // Окно открываем сразу, по нажатию: открытое после ответа сервера браузер заблокирует.
    const win = window.open('', '_blank')
    setBusy(true)
    const res = await loadJson<{ url: string }>('/api/me/telegram-link', { method: 'POST' })
    setBusy(false)
    if (res.error !== null) {
      win?.close()
      toast.error('Ссылка не получена', { detail: res.error })
      return
    }
    if (win) win.location.href = res.data.url
    else window.location.href = res.data.url
    toast.info('Откроется Telegram — нажмите «Start»', { detail: 'После этого сюда будут приходить новые поручения, «взял», «готово» и комментарии. Ссылка действует 15 минут.' })
  }

  if (linked === null) return null
  return (
    <button onClick={link} disabled={busy}
      className={`text-[12px] px-3 py-2 rounded-lg border disabled:opacity-50 ${linked ? 'border-[#e4e4e0] text-[#9a9a95]' : 'border-blue-200 bg-blue-50 text-blue-800 font-semibold'}`}
      title={linked ? 'Telegram подключён. Нажмите, чтобы подключить другой аккаунт' : undefined}>
      {linked ? '🔔 Telegram ✓' : '🔔 Уведомления в Telegram'}
    </button>
  )
}
