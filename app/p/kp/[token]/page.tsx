'use client'

import { use, useEffect, useState } from 'react'
import type { PublicQuote } from '@/lib/b2b/publicQuote'

// А5: страница КП для клиента по ссылке. Без логина, только по токену.
// Клиент видит цены и состав, может согласовать или задать вопрос — ответ
// прилетает менеджеру в просчёт (статус + комментарий).

const fmt = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`
const date = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })

function itemTitle(it: PublicQuote['items'][number]): string {
  const parts = [it.materialName || 'Стекло']
  if (it.thickness) parts.push(`${it.thickness} мм`)
  if (it.hasTempering) parts.push('закалённое')
  if (it.hasFacet) parts.push(it.facetTypeMm ? `фацет ${it.facetTypeMm} мм` : 'фацет')
  let s = parts.join(', ')
  if (it.width && it.height) s += ` · ${it.width}×${it.height} мм`
  const svc = (it.services ?? []).map(x => x.name).filter(Boolean)
  if (svc.length) s += ` · ${svc.join(', ')}`
  return s
}

export default function PublicKpPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const [quote, setQuote] = useState<PublicQuote | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [askOpen, setAskOpen] = useState(false)
  const [comment, setComment] = useState('')
  const [done, setDone] = useState<'approve' | 'question' | null>(null)

  useEffect(() => {
    fetch(`/api/public/kp/${token}`)
      .then(async r => {
        const j = await r.json().catch(() => ({}))
        if (!r.ok) { setError(j.error || 'Ссылка недействительна'); return }
        setQuote(j.quote as PublicQuote)
      })
      .catch(() => setError('Не удалось загрузить'))
      .finally(() => setLoading(false))
  }, [token])

  async function respond(action: 'approve' | 'question') {
    setSending(true)
    try {
      const r = await fetch(`/api/public/kp/${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, comment: comment.trim() || null }),
      })
      if (!r.ok) { setError('Не удалось отправить ответ'); return }
      setDone(action)
      setAskOpen(false)
    } finally { setSending(false) }
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-[#6b6b66] text-sm">Загрузка…</div>
  if (error || !quote) return (
    <div className="min-h-screen flex items-center justify-center bg-[#f5f5f3] px-4">
      <div className="bg-white border border-[#e4e4e0] rounded-2xl px-6 py-8 max-w-sm text-center">
        <p className="text-[15px] font-semibold text-[#111110]">Ссылка недействительна</p>
        <p className="text-[13px] text-[#6b6b66] mt-1.5">{error ?? 'Запросите новую у менеджера M-Glass.'}</p>
      </div>
    </div>
  )

  const agreed = done === 'approve' || quote.status === 'agreed' || quote.status === 'launched'

  return (
    <div className="min-h-screen bg-[#f5f5f3] py-6 px-4">
      <div className="max-w-3xl mx-auto space-y-4">

        <div className="bg-white border border-[#e4e4e0] rounded-2xl px-6 py-5">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-[#9a9a95]">M-Glass · коммерческое предложение</p>
          <h1 className="text-[22px] font-bold text-[#111110] mt-1">№ {quote.number}</h1>
          <p className="text-[13px] text-[#6b6b66] mt-1">
            {quote.clientName} · от {date(quote.quoteDate)} · действует до {date(quote.validUntil)}
          </p>
          {quote.managerName && <p className="text-[12px] text-[#9a9a95] mt-0.5">Менеджер: {quote.managerName}</p>}
        </div>

        <div className="bg-white border border-[#e4e4e0] rounded-2xl overflow-hidden">
          <div className="divide-y divide-[#f0f0ec]">
            {quote.items.map((it, i) => {
              const line = it.manualTotal ?? Math.round((it.saleIncVat ?? 0) * (1 - quote.discountPercent / 100))
              return (
                <div key={i} className="px-5 py-3 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-[13px] text-[#111110]">{itemTitle(it)}</p>
                    {it.comment && <p className="text-[11px] text-[#9a9a95] mt-0.5">{it.comment}</p>}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-[13px] font-semibold text-[#111110] whitespace-nowrap">{fmt(line)}</p>
                    {(it.quantity ?? 1) > 1 && <p className="text-[11px] text-[#9a9a95]">{it.quantity} шт.</p>}
                  </div>
                </div>
              )
            })}
          </div>
          <div className="px-5 py-4 bg-[#fafaf9] border-t border-[#e4e4e0]">
            {quote.discountPercent > 0 && (
              <div className="flex items-center justify-between text-[12px] text-[#6b6b66]">
                <span>Без скидки</span>
                <span className="font-mono line-through">{fmt(quote.totalBase)}</span>
              </div>
            )}
            <div className="flex items-center justify-between mt-1">
              <span className="text-[13px] font-semibold text-[#111110]">Итого к оплате</span>
              <span className="text-[18px] font-bold text-[#111110] font-mono">{fmt(quote.totalFinal)}</span>
            </div>
            <p className="text-[11px] text-[#9a9a95] mt-1.5">
              Цена с НДС. Срок изготовления {quote.productionDays} дн. ·{' '}
              {quote.paymentTerms === '100' ? '100% предоплата' : 'оплата 50/50'}
              {quote.totalArea > 0 && ` · ${quote.totalArea.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} м²`}
            </p>
          </div>
        </div>

        {quote.userNotes && (
          <div className="bg-white border border-[#e4e4e0] rounded-2xl px-5 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-[#9a9a95] mb-1.5">Примечание</p>
            <p className="text-[13px] text-[#4b4b47] whitespace-pre-line">{quote.userNotes}</p>
          </div>
        )}

        {done === 'question' ? (
          <div className="bg-white border border-blue-200 rounded-2xl px-5 py-4 text-center">
            <p className="text-[14px] font-semibold text-blue-700">Вопрос отправлен менеджеру</p>
            <p className="text-[12px] text-[#6b6b66] mt-1">Он свяжется с вами.</p>
          </div>
        ) : agreed ? (
          <div className="bg-white border border-emerald-200 rounded-2xl px-5 py-4 text-center">
            <p className="text-[14px] font-semibold text-emerald-700">✓ Предложение согласовано</p>
            <p className="text-[12px] text-[#6b6b66] mt-1">Менеджер запустит заказ в работу и пришлёт счёт.</p>
          </div>
        ) : (
          <div className="bg-white border border-[#e4e4e0] rounded-2xl px-5 py-4 space-y-3">
            {askOpen && (
              <textarea
                value={comment} onChange={e => setComment(e.target.value)} rows={3}
                placeholder="Что уточнить по предложению?"
                className="w-full border border-[#e4e4e0] rounded-xl px-3 py-2 text-[13px] outline-none focus:border-[#111110] transition-colors"
              />
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => respond('approve')} disabled={sending}
                className="text-[13px] font-semibold px-4 py-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 transition-colors">
                {sending ? 'Отправляю…' : 'Согласовать'}
              </button>
              <button onClick={() => askOpen ? respond('question') : setAskOpen(true)} disabled={sending}
                className="text-[13px] font-medium px-4 py-2 rounded-xl border border-[#e4e4e0] text-[#6b6b66] hover:text-[#111110] hover:border-[#111110] disabled:opacity-40 transition-colors">
                {askOpen ? 'Отправить вопрос' : 'Есть вопрос'}
              </button>
            </div>
          </div>
        )}

        <p className="text-[11px] text-[#9a9a95] text-center pb-6">M-Glass · производство изделий из стекла и зеркал</p>
      </div>
    </div>
  )
}
