'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import Link from 'next/link'

type ArchivedQuote = {
  id: number
  client_name: string
  custom_number: string | null
  client_order_number: string | null
  discount_percent: number
  total_after_discount: number
  total_sale_inc_vat: number
  created_at: string
  archived_at: string
  notes: string | null
  created_by: string | null
}

const fmt = (n: number) => (n ?? 0).toLocaleString('ru-RU') + ' ₽'
const fmtDate = (d: string) => new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })

export default function ArchivePage() {
  const [quotes, setQuotes]   = useState<ArchivedQuote[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [toast, setToast]     = useState<string | null>(null)

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  useEffect(() => {
    const sb = createClient()
    sb.from('b2b_orders')
      .select('id,client_name,custom_number,client_order_number,discount_percent,total_after_discount,total_sale_inc_vat,created_at,archived_at,notes,created_by')
      .not('archived_at', 'is', null)
      .order('archived_at', { ascending: false })
      .limit(1000)
      .then(({ data }) => {
        setQuotes((data ?? []) as ArchivedQuote[])
        setLoading(false)
      })
  }, [])

  async function unarchive(id: number) {
    await createClient().from('b2b_orders').update({ archived_at: null }).eq('id', id)
    setQuotes(prev => prev.filter(q => q.id !== id))
    showToast('Расчёт восстановлен')
  }

  const visible = quotes.filter(q => {
    if (!search.trim()) return true
    const s = search.trim().toLowerCase()
    return (
      q.client_name.toLowerCase().includes(s) ||
      String(q.id).includes(s) ||
      (q.custom_number ?? '').toLowerCase().includes(s) ||
      (q.client_order_number ?? '').toLowerCase().includes(s)
    )
  })

  return (
    <div className="max-w-[1100px] mx-auto px-4 py-5">
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-[#111110] text-white text-[12px] px-4 py-2.5 rounded-xl shadow-lg">
          {toast}
        </div>
      )}

      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-[18px] font-semibold text-[#111110]">Архив расчётов B2B</h1>
          <p className="text-[12px] text-[#9a9a95] mt-0.5">{quotes.length} архивных расчётов</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск..."
            className="border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[12px] outline-none focus:border-[#111110] bg-white w-48"
          />
          <Link href="/b2b-quotes"
            className="text-[12px] text-[#6b6b66] hover:text-[#111110] px-3 py-1.5 border border-[#e4e4e0] rounded-lg hover:border-[#111110] transition-colors">
            ← Активные
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16 text-[13px] text-[#9a9a95]">Загрузка...</div>
      ) : visible.length === 0 ? (
        <div className="text-center py-16 text-[13px] text-[#9a9a95]">
          {search ? 'Ничего не найдено' : 'Архив пуст'}
        </div>
      ) : (
        <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
          <table className="w-full text-[12px]">
            <thead className="bg-[#fafaf9] border-b border-[#e4e4e0]">
              <tr>
                <th className="text-left px-4 py-2.5 text-[10px] font-bold text-[#9a9a95] uppercase tracking-wide w-16">#</th>
                <th className="text-left px-4 py-2.5 text-[10px] font-bold text-[#9a9a95] uppercase tracking-wide">Клиент</th>
                <th className="text-right px-4 py-2.5 text-[10px] font-bold text-[#9a9a95] uppercase tracking-wide">Сумма</th>
                <th className="text-center px-4 py-2.5 text-[10px] font-bold text-[#9a9a95] uppercase tracking-wide">Создан</th>
                <th className="text-center px-4 py-2.5 text-[10px] font-bold text-[#9a9a95] uppercase tracking-wide">Архивирован</th>
                <th className="w-20" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f8f8f7]">
              {visible.map(q => (
                <tr key={q.id} className="hover:bg-[#fafaf9]">
                  <td className="px-4 py-2.5 text-[#9a9a95] font-mono">
                    {q.custom_number ? (
                      <span className="font-semibold text-[#111110]">{q.custom_number}</span>
                    ) : (
                      `#${q.id}`
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <p className="font-semibold text-[#111110]">{q.client_name}</p>
                    {q.client_order_number && (
                      <p className="text-[10px] text-[#9a9a95]">Заказ: {q.client_order_number}</p>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono font-semibold text-[#111110]">
                    {fmt(q.discount_percent > 0 ? q.total_after_discount : q.total_sale_inc_vat)}
                    {q.discount_percent > 0 && (
                      <p className="text-[10px] text-emerald-600">−{q.discount_percent}%</p>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-center text-[#6b6b66]">{fmtDate(q.created_at)}</td>
                  <td className="px-4 py-2.5 text-center text-[#9a9a95]">{fmtDate(q.archived_at)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() => unarchive(q.id)}
                      className="text-[11px] font-medium text-blue-600 hover:text-blue-800 px-2 py-1 rounded hover:bg-blue-50 transition-colors">
                      Восстановить
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
