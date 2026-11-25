'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase-browser'

// Активные минуты (владелец 25.11.2026): раз в минуту, если вкладка на экране и за эту
// минуту было действие человека, — +1 минута в user_active_minutes. Открытая и забытая
// вкладка не считается. Окно во фрейме (КП в карточке сделки) не считает.
const EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'scroll', 'touchstart'] as const

export default function ActiveTimeTracker() {
  useEffect(() => {
    if (window.self !== window.top) return
    let lastInput = 0
    const mark = () => { lastInput = Date.now() }
    for (const e of EVENTS) window.addEventListener(e, mark, { passive: true, capture: true })
    const tick = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastInput > 60_000) return
      createClient().rpc('track_active_minute').then(({ error }) => {
        if (error) console.warn('Счётчик активных минут не записал минуту:', error.message)
      })
    }, 60_000)
    return () => {
      window.clearInterval(tick)
      for (const e of EVENTS) window.removeEventListener(e, mark, { capture: true })
    }
  }, [])
  return null
}
