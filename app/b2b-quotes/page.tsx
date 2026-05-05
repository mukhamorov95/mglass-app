'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import Link from 'next/link'

type OrderItem = {
  materialName?: string
  category?: string
  thickness?: number
  width?: number
  height?: number
  quantity?: number
  totalAreaNet?: number
  totalWeight?: number
  pricePerM2?: number
  saleIncVat?: number
  costExVat?: number
  hasTempering?: boolean
  services?: { id: number; name: string; cost: number }[]
}

type Quote = {
  id: number
  client_name: string
  discount_percent: number
  margin_percent: number
  items: OrderItem[]
  total_area: number
  total_weight: number
  total_sale_inc_vat: number
  total_after_discount: number
  notes: string | null
  created_at: string
}

function parseNotes(notes: string | null): Record<string, unknown> {
  if (!notes) return {}
  try {
    const p = JSON.parse(notes)
    if (typeof p === 'object' && p !== null) return p
  } catch {}
  return {}
}

const fmt = (n: number) => (n ?? 0).toLocaleString('ru-RU') + ' ₽'

export default function B2BQuotesPage() {
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<number | null>(null)

  const [confirmingId, setConfirmingId] = useState<number | null>(null)
  const [launchedAt, setLaunchedAt] = useState(new Date().toISOString().slice(0, 10))
  const [confirming, setConfirming] = useState(false)

  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    if (!deletingId) return
    setDeleting(true)
    await createClient().from('b2b_orders').delete().eq('id', deletingId)
    setQuotes(prev => prev.filter(q => q.id !== deletingId))
    setDeletingId(null)
    setDeleting(false)
  }

  async function loadQuotes() {
    const sb = createClient()
    const { data } = await sb
      .from('b2b_orders')
      .select('*')
      .ilike('notes', '%"status":"quote"%')
      .order('created_at', { ascending: false })
    setQuotes(
      (data ?? []).map(q => ({
        ...q,
        items: Array.isArray(q.items) ? (q.items as OrderItem[]) : [],
      }))
    )
    setLoading(false)
  }

  useEffect(() => { loadQuotes() }, [])

  async function handleConfirm() {
    if (!confirmingId) return
    setConfirming(true)
    const sb = createClient()

    const { data: order } = await sb.from('b2b_orders').select('notes').eq('id', confirmingId).single()
    const currentNotes = parseNotes(order?.notes ?? null)

    const newNotes = JSON.stringify({
      ...currentNotes,
      status: 'confirmed',
      launched_at: launchedAt,
    })

    await sb.from('b2b_orders').update({ notes: newNotes }).eq('id', confirmingId)

    setConfirmingId(null)
    setConfirming(false)
    setLoading(true)
    await loadQuotes()
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center text-[13px] text-[#8a8a85]">Загрузка...</div>
  )

  return (
    <div className="max-w-[1100px] mx-auto px-4 py-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-[18px] font-semibold text-[#111110] tracking-tight">B2B Просчёты</h1>
          <p className="text-[12px] text-[#8a8a85] mt-0.5">
            {quotes.length > 0 ? `${quotes.length} просчётов ожидают подтверждения` : 'Нет просчётов в ожидании'}
          </p>
        </div>
        <Link href="/calculator/b2b"
          className="bg-[#111110] text-white text-[12px] font-medium px-3 py-1.5 rounded-lg hover:bg-[#2a2a28] transition-colors">
          + Новый просчёт
        </Link>
      </div>

      {quotes.length === 0 ? (
        <div className="bg-white border border-[#e4e4e0] rounded-xl p-10 text-center">
          <p className="text-[13px] text-[#6b6b66]">Нет просчётов в ожидании</p>
          <p className="text-[11px] text-[#9a9a95] mt-0.5">Сохранённые из калькулятора просчёты появятся здесь</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {quotes.map(quote => {
            const isOpen = expanded === quote.id
            const parsed = parseNotes(quote.notes)
            const quoteDate = parsed.quote_date
              ? new Date(String(parsed.quote_date))
              : new Date(quote.created_at)
            const dateStr = quoteDate.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
            const timeStr = quoteDate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
            const finalPrice = (quote.discount_percent ?? 0) > 0 ? quote.total_after_discount : quote.total_sale_inc_vat
            const userNotes = typeof parsed.user_notes === 'string' ? parsed.user_notes : null

            return (
              <div key={quote.id} className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 flex items-center gap-3">
                  <button
                    className="flex items-center gap-3 flex-1 min-w-0 text-left"
                    onClick={() => setExpanded(isOpen ? null : quote.id)}>
                    <span className="text-[11px] font-bold text-[#c4c4be] flex-shrink-0">#{quote.id}</span>
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-[#111110] truncate">{quote.client_name}</p>
                      <p className="text-[11px] text-[#9a9a95]">
                        {dateStr}, {timeStr} · {quote.items.length} поз. · {(quote.total_area ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} м²
                      </p>
                    </div>
                  </button>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <div className="text-right">
                      <p className="text-[13px] font-semibold text-[#111110]">{fmt(finalPrice)}</p>
                      {(quote.discount_percent ?? 0) > 0 && (
                        <p className="text-[10px] text-emerald-600">скидка {quote.discount_percent}%</p>
                      )}
                    </div>
                    <button
                      onClick={() => {
                        setConfirmingId(quote.id)
                        setLaunchedAt(new Date().toISOString().slice(0, 10))
                      }}
                      className="bg-emerald-600 text-white text-[12px] font-medium px-3 py-1.5 rounded-lg hover:bg-emerald-700 transition-colors">
                      Подтвердить
                    </button>
                    <button
                      onClick={() => setDeletingId(quote.id)}
                      title="Удалить просчёт"
                      className="p-1.5 rounded-lg text-[#c4c4be] hover:text-red-500 hover:bg-red-50 transition-colors">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>

                {isOpen && (
                  <div className="border-t border-[#f0f0ec]">
                    <div className="overflow-x-auto">
                      <table className="w-full text-[11px]">
                        <thead>
                          <tr className="border-b border-[#f0f0ec] bg-[#fafaf9] text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest whitespace-nowrap">
                            <th className="px-2 py-1.5 text-center w-7">#</th>
                            <th className="px-2 py-1.5 text-left min-w-[130px]">Материал</th>
                            <th className="px-2 py-1.5 text-left min-w-[70px]">Тип</th>
                            <th className="px-2 py-1.5 text-right w-12">Толщ.</th>
                            <th className="px-2 py-1.5 text-right w-14">Ш, мм</th>
                            <th className="px-2 py-1.5 text-right w-14">В, мм</th>
                            <th className="px-2 py-1.5 text-right w-10">Кол.</th>
                            <th className="px-2 py-1.5 text-right w-14">Кв.м</th>
                            <th className="px-2 py-1.5 text-right w-14">Вес, кг</th>
                            <th className="px-2 py-1.5 text-right w-18">Цена/м²</th>
                            <th className="px-2 py-1.5 text-right w-20 text-[#111110]">Итого</th>
                            <th className="px-2 py-1.5 text-right w-20 text-[#9a9a95]">Себест.</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#f8f8f7]">
                          {quote.items.map((item, idx) => {
                            const itemAfterDiscount = Math.round((item.saleIncVat ?? 0) * (1 - (quote.discount_percent ?? 0) / 100))
                            return (
                              <tr key={idx} className="hover:bg-[#fafaf9]">
                                <td className="px-2 py-1 text-center text-[10px] font-bold text-[#c4c4be]">{idx + 1}</td>
                                <td className="px-2 py-1">
                                  <div className="font-medium text-[#111110]">{String(item.materialName ?? '')}</div>
                                  {(item.hasTempering || (item.services?.length ?? 0) > 0) && (
                                    <div className="flex gap-0.5 flex-wrap">
                                      {item.hasTempering && (
                                        <span className="text-[8px] font-medium px-1 py-px rounded bg-orange-50 text-orange-600">закалка</span>
                                      )}
                                      {item.services?.map(s => (
                                        <span key={s.id} className="text-[8px] font-medium px-1 py-px rounded bg-blue-50 text-blue-600">{s.name}</span>
                                      ))}
                                    </div>
                                  )}
                                </td>
                                <td className="px-2 py-1 text-[#6b6b66] whitespace-nowrap">{String(item.category ?? '')}</td>
                                <td className="px-2 py-1 text-right font-mono text-[#111110]">{item.thickness ?? ''}</td>
                                <td className="px-2 py-1 text-right font-mono text-[#111110]">{item.width ?? ''}</td>
                                <td className="px-2 py-1 text-right font-mono text-[#111110]">{item.height ?? ''}</td>
                                <td className="px-2 py-1 text-right font-mono text-[#111110]">{item.quantity ?? ''}</td>
                                <td className="px-2 py-1 text-right font-mono text-[#111110]">{Number(item.totalAreaNet ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 3 })}</td>
                                <td className="px-2 py-1 text-right font-mono text-[#6b6b66]">{Number(item.totalWeight ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}</td>
                                <td className="px-2 py-1 text-right font-mono text-[#111110]">{Number(item.pricePerM2 ?? 0).toLocaleString('ru-RU')}</td>
                                <td className="px-2 py-1 text-right font-mono font-semibold text-[#111110] whitespace-nowrap">{itemAfterDiscount.toLocaleString('ru-RU')} ₽</td>
                                <td className="px-2 py-1 text-right font-mono text-[#9a9a95] whitespace-nowrap">{Number(item.costExVat ?? 0).toLocaleString('ru-RU')} ₽</td>
                              </tr>
                            )
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-[#e4e4e0] bg-[#fafaf9] font-semibold text-[#111110]">
                            <td colSpan={7} className="px-2 py-1.5 text-[10px] text-[#6b6b66]">{quote.items.length} позиций</td>
                            <td className="px-2 py-1.5 text-right font-mono text-[11px]">{(quote.total_area ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 3 })}</td>
                            <td></td>
                            <td></td>
                            <td className="px-2 py-1.5 text-right font-mono font-bold whitespace-nowrap text-[11px]">{fmt(finalPrice)}</td>
                            <td></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                    {userNotes && (
                      <p className="px-4 py-2 text-[11px] text-[#6b6b66] italic border-t border-[#f0f0ec]">{userNotes}</p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Модальное окно удаления */}
      {deletingId !== null && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center px-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <h2 className="text-[16px] font-semibold text-[#111110] mb-1">Удалить просчёт?</h2>
            <p className="text-[13px] text-[#6b6b66] mb-5">Это действие нельзя отменить.</p>
            <div className="flex gap-2">
              <button
                onClick={() => setDeletingId(null)}
                className="flex-1 py-2.5 rounded-lg border border-[#e4e4e0] text-[13px] font-medium text-[#6b6b66] hover:bg-[#f8f8f7] transition-colors">
                Отмена
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 py-2.5 rounded-lg bg-red-600 text-white text-[13px] font-medium hover:bg-red-700 disabled:opacity-40 transition-colors">
                {deleting ? 'Удаление...' : 'Удалить'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно подтверждения */}
      {confirmingId !== null && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center px-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <h2 className="text-[16px] font-semibold text-[#111110] mb-1">Подтвердить заказ</h2>
            <p className="text-[13px] text-[#6b6b66] mb-4">Укажите дату запуска в производство</p>
            <label className="block text-[11px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1.5">Дата запуска</label>
            <input
              type="date"
              className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] text-[#111110] outline-none focus:border-[#111110] mb-4"
              value={launchedAt}
              onChange={e => setLaunchedAt(e.target.value)}
            />
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmingId(null)}
                className="flex-1 py-2.5 rounded-lg border border-[#e4e4e0] text-[13px] font-medium text-[#6b6b66] hover:bg-[#f8f8f7] transition-colors">
                Отмена
              </button>
              <button
                onClick={handleConfirm}
                disabled={confirming || !launchedAt}
                className="flex-1 py-2.5 rounded-lg bg-emerald-600 text-white text-[13px] font-medium hover:bg-emerald-700 disabled:opacity-40 transition-colors">
                {confirming ? 'Сохранение...' : 'Подтвердить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
