'use client'

import { useEffect } from 'react'
import { swUrl } from '@/lib/swUrl'

// Картинки и файлы хранилища по сохранённым ссылкам на supabase.co подменяет service
// worker (public/sw.js). Регистрируем для всех вошедших, а не только цеху: фото
// материалов, КП и замеров смотрят и в офисе. Внутри чужого iframe не регистрируем.
export default function StorageProxySW() {
  useEffect(() => {
    if (!('serviceWorker' in navigator) || window.self !== window.top) return
    navigator.serviceWorker.register(swUrl()).catch(() => {})
  }, [])
  return null
}
