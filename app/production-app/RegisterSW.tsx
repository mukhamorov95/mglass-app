'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase-browser'

// Регистрирует service worker, чтобы /production-app можно было «установить»
// как отдельное приложение на планшет/телефон цеха. Плюс держит сессию живой:
// в спящей PWA таймер авто-рефреша токена заморожен, поэтому при возврате
// приложения в фокус форсируем проверку/рефреш ДО первого действия мастера.
export default function RegisterSW() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }
    const wake = () => {
      if (document.visibilityState !== 'visible') return
      createClient().auth.getSession().catch(() => {})
    }
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('online', wake)
    return () => {
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('online', wake)
    }
  }, [])
  return null
}
