'use client'

import { useEffect, useState } from 'react'

// A10: кнопка «Установить приложение». Ловит beforeinstallprompt (Android/Chrome).
// На iOS события нет — показываем подсказку «Поделиться → На экран Домой».
type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

export default function InstallButton() {
  const [deferred, setDeferred] = useState<BIPEvent | null>(null)
  // уже установлено (standalone) — не предлагаем (вычисляем на клиенте лениво)
  const [installed, setInstalled] = useState(() =>
    typeof window !== 'undefined' && !!window.matchMedia?.('(display-mode: standalone)').matches)
  const [iosHint, setIosHint] = useState(false)

  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setDeferred(e as BIPEvent) }
    const onInstalled = () => { setInstalled(true); setDeferred(null) }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  if (installed) return null

  async function install() {
    if (deferred) { await deferred.prompt(); setDeferred(null); return }
    // iOS Safari — нет программной установки, показываем инструкцию
    setIosHint(true)
  }

  return (
    <div style={{ marginTop: 12 }}>
      <button className="primary" onClick={install}>📲 Установить приложение</button>
      {iosHint && (
        <div className="info" style={{ marginTop: 10 }}>
          <span>ℹ️</span>
          <span>На iPhone: нажмите «Поделиться» в Safari → «На экран “Домой”». Кабинет откроется как отдельное приложение.</span>
        </div>
      )}
    </div>
  )
}
