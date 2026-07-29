'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'

// Кто в цехе видит деньги. Экран «Деньги» гейтится на сервере
// (api/production/money), а клиентские производственные экраны показывали ₽
// вообще без проверки — /production-app/voronezh отдавал выручку по всему
// портфелю заказов любому мастеру. Здесь один общий признак для таких мест.
//
// Это НЕ замена серверной защите: суммы всё равно приходят вместе с заказами.
// Гейт скрывает их от глаз; если понадобится настоящая изоляция — суммы нужно
// перестать отдавать в запросе.

const OWNER_ROLES = new Set(['admin', 'ceo', 'cfo'])

export function useCanViewMoney(): boolean | null {
  const [can, setCan] = useState<boolean | null>(null)
  useEffect(() => {
    const sb = createClient()
    let alive = true
    ;(async () => {
      const { data: { user } } = await sb.auth.getUser()
      if (!user) { if (alive) setCan(false); return }
      const { data } = await sb.from('users').select('role, can_view_money').eq('id', user.id).maybeSingle()
      const p = data as { role: string | null; can_view_money: boolean | null } | null
      if (alive) setCan(OWNER_ROLES.has(p?.role ?? '') || !!p?.can_view_money)
    })()
    return () => { alive = false }
  }, [])
  return can
}
