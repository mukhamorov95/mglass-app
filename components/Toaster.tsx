'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { TOAST_EVENT, type ToastPayload } from '@/lib/toast'

const MAX_VISIBLE = 4
const DEFAULT_MS = 4000

const ICON: Record<ToastPayload['kind'], { mark: string; tone: string }> = {
  success: { mark: '✓', tone: 'bg-[#e8f3ec] text-[#2f8f5b]' },
  error: { mark: '!', tone: 'bg-[#fbeae7] text-[#c23a2b]' },
  info: { mark: 'i', tone: 'bg-[#f0f0ec] text-[#6b6b66]' },
}

export default function Toaster() {
  const [items, setItems] = useState<ToastPayload[]>([])
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id)
    if (t) clearTimeout(t)
    timers.current.delete(id)
    setItems(list => list.filter(x => x.id !== id))
  }, [])

  const dismissAll = useCallback(() => {
    timers.current.forEach(clearTimeout)
    timers.current.clear()
    setItems([])
  }, [])

  useEffect(() => {
    const map = timers.current
    const onToast = (e: Event) => {
      const t = (e as CustomEvent<ToastPayload>).detail
      if (!t || !t.title) return
      setItems(list => [...list, t])
      if (t.kind !== 'error') map.set(t.id, setTimeout(() => dismiss(t.id), t.durationMs ?? DEFAULT_MS))
    }
    window.addEventListener(TOAST_EVENT, onToast)
    return () => {
      window.removeEventListener(TOAST_EVENT, onToast)
      map.forEach(clearTimeout)
      map.clear()
    }
  }, [dismiss])

  if (items.length === 0) return null
  const visible = items.slice(-MAX_VISIBLE)
  const hidden = items.length - visible.length

  return (
    <div className="fixed z-[100] bottom-4 left-4 right-4 sm:left-auto sm:w-[380px] flex flex-col gap-2 pointer-events-none mb-[env(safe-area-inset-bottom)]">
      {hidden > 0 && (
        <button onClick={dismissAll}
          className="pointer-events-auto self-end text-[11.5px] text-[#6b6b66] bg-white border border-[#e4e4e0] rounded-full px-3 py-1 hover:text-[#111110]">
          ещё {hidden} · закрыть все
        </button>
      )}
      {visible.map(t => {
        const isError = t.kind === 'error'
        const icon = ICON[t.kind]
        return (
          <div key={t.id}
            role={isError ? 'alert' : 'status'}
            aria-live={isError ? undefined : 'polite'}
            className={`pointer-events-auto bg-white border rounded-xl shadow-[0_8px_24px_rgba(17,17,16,0.12)] px-3.5 py-3 flex items-start gap-3 transition duration-200 ease-out starting:opacity-0 starting:translate-y-2 motion-reduce:transition-none ${isError ? 'border-[#eec5bf]' : 'border-[#e4e4e0]'}`}>
            <span aria-hidden className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold ${icon.tone}`}>{icon.mark}</span>
            <div className="min-w-0 flex-1">
              <p className={`text-[13px] font-semibold leading-snug ${isError ? 'text-[#c23a2b]' : 'text-[#111110]'}`}>{t.title}</p>
              {t.detail && <p className="text-[12px] text-[#6b6b66] mt-0.5 leading-snug whitespace-pre-wrap break-words">{t.detail}</p>}
              {t.action && (
                <button onClick={() => { t.action!.onClick(); dismiss(t.id) }}
                  className="mt-1.5 text-[12px] font-semibold text-[#111110] underline underline-offset-2 hover:no-underline">
                  {t.action.label}
                </button>
              )}
            </div>
            <button onClick={() => dismiss(t.id)} aria-label="Закрыть уведомление"
              className="shrink-0 -mr-1 -mt-0.5 w-6 h-6 rounded-md text-[#9a9a95] hover:text-[#111110] hover:bg-[#f0f0ec] text-[13px] leading-none">
              ✕
            </button>
          </div>
        )
      })}
    </div>
  )
}
