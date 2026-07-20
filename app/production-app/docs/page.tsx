'use client'

import { useEffect, useState, useCallback } from 'react'
import ProductionTabs from '@/components/ProductionTabs'
import { createClient } from '@/lib/supabase-browser'

// Экран Валерии (документы): запущенные заказы — печать чертежа + отметка
// «распечатано / нет», подсветка по срокам. Незапечатанные и горящие — сверху.

type NotesData = { status?: string; launched_at?: string; production_days?: number; deadline_date?: string; docs_printed?: boolean; stages?: Record<string, string | null> }
type Order = { id: number; client_name: string; custom_number: string | null; notes: string | null; created_at: string; pn: NotesData }

function parseNotes(n: string | null): NotesData { if (!n) return {}; try { const p = JSON.parse(n); return typeof p === 'object' && p ? p : {} } catch { return {} } }
function deadline(pn: NotesData, createdAt: string): number {
  const d = pn.deadline_date ? new Date(pn.deadline_date)
    : pn.launched_at ? (() => { const x = new Date(pn.launched_at!); x.setDate(x.getDate() + (pn.production_days ?? 7)); return x })()
    : (() => { const x = new Date(createdAt); x.setDate(x.getDate() + 10); return x })()
  d.setHours(0, 0, 0, 0)
  const t = new Date(); t.setHours(0, 0, 0, 0)
  return Math.round((d.getTime() - t.getTime()) / 86_400_000)
}
const dLabel = (days: number) => days < 0 ? `просрочен ${Math.abs(days)}д` : days === 0 ? 'сегодня' : days === 1 ? 'завтра' : days === 2 ? 'послезавтра' : `${days}д`

export default function DocsPage() {
  const sb = createClient()
  const [loading, setLoading] = useState(true)
  const [orders, setOrders] = useState<Order[]>([])
  const [busy, setBusy] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await sb
      .from('b2b_orders')
      .select('id,client_name,custom_number,notes,created_at')
      .not('notes', 'ilike', '%"status":"quote"%')
      .is('archived_at', null)
      .order('created_at', { ascending: false })
      .limit(500)
    const list = (data ?? []).map((o: Record<string, unknown>) => ({
      id: o.id as number, client_name: o.client_name as string, custom_number: o.custom_number as string | null,
      notes: o.notes as string | null, created_at: o.created_at as string, pn: parseNotes(o.notes as string | null),
    })).filter(o => !o.pn.stages?.shipped)
    setOrders(list)
    setLoading(false)
  }, [sb])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load().catch(() => setLoading(false)) }, [load])

  async function togglePrinted(o: Order) {
    setBusy(o.id)
    const next = !o.pn.docs_printed
    setOrders(prev => prev.map(x => x.id === o.id ? { ...x, pn: { ...x.pn, docs_printed: next } } : x))
    await fetch(`/api/b2b-orders/${o.id}/docs-printed`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ printed: next }),
    }).catch(() => {})
    setBusy(null)
  }

  // Незапечатанные и горящие — вверх.
  const sorted = [...orders].sort((a, b) => {
    const pa = a.pn.docs_printed ? 1 : 0, pb = b.pn.docs_printed ? 1 : 0
    if (pa !== pb) return pa - pb
    return deadline(a.pn, a.created_at) - deadline(b.pn, b.created_at)
  })
  const toPrint = orders.filter(o => !o.pn.docs_printed).length

  if (loading) return <div className="min-h-screen bg-[#f5f5f3] flex items-center justify-center text-[13px] text-[#9a9a95]">Загрузка...</div>

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-4 pt-12 pb-3 lg:pt-6">
        <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Документы</h1>
        <p className="text-[13px] text-[#9a9a95] mt-0.5">{toPrint} без чертежей · {orders.length} в работе</p>
        <ProductionTabs />
      </div>

      <div className="px-4 pt-4 space-y-2">
        {sorted.length === 0 && (
          <div className="bg-white rounded-xl border border-[#e4e4e0] p-8 text-center">
            <p className="text-[14px] text-[#9a9a95]">Нет заказов в работе</p>
          </div>
        )}
        {sorted.map(o => {
          const days = deadline(o.pn, o.created_at)
          const printed = !!o.pn.docs_printed
          return (
            <div key={o.id} className={`bg-white rounded-xl border px-4 py-3 ${printed ? 'border-[#e4e4e0]' : 'border-amber-300'}`}>
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0">
                  <p className="text-[14px] font-bold text-[#111110] truncate">{o.custom_number?.trim() || `#${o.id}`} <span className="text-[#9a9a95] font-normal">· {o.client_name}</span></p>
                  <p className={`text-[12px] ${days <= 0 ? 'text-red-600 font-medium' : days <= 2 ? 'text-amber-700' : 'text-[#9a9a95]'}`}>срок: {dLabel(days)}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <a href={`/b2b-orders/${o.id}/production-sheet`} target="_blank"
                  className="flex-1 text-center py-2 rounded-lg border border-[#e4e4e0] text-[13px] font-medium text-[#6b6b66] hover:border-[#111110] hover:text-[#111110] transition-colors">
                  🖨 Чертёж
                </a>
                <button onClick={() => togglePrinted(o)} disabled={busy === o.id}
                  className={`flex-1 py-2 rounded-lg text-[13px] font-medium transition-colors disabled:opacity-40 ${printed ? 'bg-emerald-600 text-white' : 'border border-amber-300 text-amber-700 hover:bg-amber-50'}`}>
                  {printed ? '✓ Распечатано' : 'Отметить распечатано'}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
