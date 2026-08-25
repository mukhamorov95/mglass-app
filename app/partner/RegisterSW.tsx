'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase-browser'

// A10: регистрирует service worker (passthrough /sw.js), чтобы кабинет можно было
// «установить» как приложение на телефон/планшет партнёра. Плюс будит сессию при
// возврате в фокус — в спящей PWA авто-рефреш токена заморожен.
export default function RegisterSW() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { scope: '/partner' }).catch(() => {})
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
