'use client'

import { useEffect } from 'react'

// Регистрирует service worker, чтобы /production-app можно было «установить»
// как отдельное приложение на планшет/телефон цеха.
export default function RegisterSW() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }
  }, [])
  return null
}
