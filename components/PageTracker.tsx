'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import { classifyDevice } from '@/lib/deviceClass'
import { createPageViewDeduper } from '@/lib/routeKey'

const nextView = createPageViewDeduper()

// Какие экраны открывают (У0). КП и счёт в карточке сделки открыты во фрейме —
// это не переход человека, их не считаем.
export default function PageTracker() {
  const pathname = usePathname()

  useEffect(() => {
    if (window.self !== window.top) return
    const route = nextView(pathname)
    if (!route) return
    const device = classifyDevice(navigator.userAgent)
    createClient()
      .rpc('track_page_view', { p_route: route, p_device: device })
      .then(({ error }) => { if (error) console.warn('Счётчик экранов не записал переход:', error.message) })
  }, [pathname])

  return null
}
