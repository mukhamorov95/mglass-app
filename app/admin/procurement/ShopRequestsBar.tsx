'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'

// Заявки цеха («Необходимо купить») прямо в канбане закупщика:
// Вера видит запросы рабочих и отмечает «Заказано» не покидая закупки.
type Req = { id: number; title: string; qty: string | null; link_url: string | null; author_name: string; created_at: string }

export default function ShopRequestsBar() {
  const sb = createClient()
  const [reqs, setReqs] = useState<Req[]>([])
  const [meName, setMeName] = useState('')
  const [busy, setBusy] = useState<number | null>(null)

  const load = useCallback(async () => {
    const { data } = await sb.from('shop_purchase_requests')
      .select('id, title, qty, link_url, author_name, created_at')
      .eq('status', 'need').order('created_at')
    setReqs((data ?? []) as Req[])
    const { data: { user } } = await sb.auth.getUser()
    if (user) {
      const { data: p } = await sb.from('users').select('name').eq('id', user.id).maybeSingle()
      setMeName(p?.name ?? user.email ?? '')
    }
  }, [sb])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load().catch(() => {}) }, [load])

  async function markOrdered(id: number) {
    setBusy(id)
    try {
      await sb.from('shop_purchase_requests')
        .update({ status: 'ordered', ordered_by: meName || null, ordered_at: new Date().toISOString() })
        .eq('id', id)
      await load()
    } finally { setBusy(null) }
  }

  if (reqs.length === 0) return null

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
      <p className="text-[11px] font-bold uppercase tracking-widest text-amber-700 mb-2">
        🛒 Цех просит купить · {reqs.length}
      </p>
      <div className="space-y-1.5">
        {reqs.map(r => (
          <div key={r.id} className={`flex items-center gap-2 flex-wrap bg-white border border-amber-100 rounded-lg px-3 py-2 ${busy === r.id ? 'opacity-50' : ''}`}>
            <span className="text-[13px] font-medium">{r.title}</span>
            {r.qty && <span className="text-[12px] text-[#6b6b66]">× {r.qty}</span>}
            {r.link_url && <a href={r.link_url} target="_blank" rel="noreferrer" className="text-[11px] text-blue-600 hover:underline">ссылка ↗</a>}
            <span className="text-[11px] text-[#9a9a95]">от {r.author_name || '—'} · {new Date(r.created_at).toLocaleDateString('ru-RU')}</span>
            <button onClick={() => markOrdered(r.id)} disabled={busy === r.id}
              className="ml-auto text-[11px] font-semibold bg-amber-500 text-white rounded-lg px-2.5 py-1 hover:bg-amber-600 disabled:opacity-40">
              ✓ Заказано
            </button>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-amber-600 mt-2">Статус синхронизирован с цеховым канбаном «Необходимо купить» — рабочий увидит «Заказано».</p>
    </div>
  )
}
