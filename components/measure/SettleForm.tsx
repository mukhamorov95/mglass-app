'use client'

import { useState } from 'react'
import { sendMeasure } from '@/lib/measure/client'
import { PAYMENT_LABEL, type VisitPayment } from '@/lib/measure/money'

// Закрытие замера (и правка у выполненного): цена менеджера остаётся видна, замерщик
// пишет, сколько вышло на объекте, и коротко почему, если иначе; отмечает, как оплачен
// выезд. Сервер (`done` / `settle`) проверяет то же самое.

export type SettleRow = {
  id: number
  deal_number: string | null
  visit_price: number
  actual_price: number | null
  price_note: string | null
  visit_payment: VisitPayment | null
  payer: string | null
  result_note?: string | null
}

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'
const CHOICES: { v: VisitPayment; l: string }[] = [
  { v: 'onsite', l: '💵 Мне на объекте' },
  { v: 'company', l: '🏢 На компанию' },
  { v: 'unpaid', l: '⏳ Не оплачено' },
]

export default function SettleForm({ r, mode, onDone, onCancel }: {
  r: SettleRow
  mode: 'done' | 'settle'
  onDone: (message: string) => void
  onCancel: () => void
}) {
  const [pay, setPay] = useState<VisitPayment | ''>(r.visit_payment ?? '')
  const [price, setPrice] = useState(r.actual_price != null ? String(r.actual_price) : '')
  const [note, setNote] = useState(r.price_note ?? '')
  const [result, setResult] = useState(r.result_note ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const managerPrice = Number(r.visit_price) || 0
  const typed = price.trim() === '' ? null : Number(price.replace(/\s/g, ''))
  const changed = typed !== null && typed !== managerPrice
  const ready = !!pay && (!changed || !!note.trim()) && (typed === null || (Number.isFinite(typed) && typed >= 0))

  async function save() {
    if (!ready) return
    setBusy(true); setError('')
    try {
      const body: Record<string, unknown> = { action: mode, visit_payment: pay }
      // Итог шлём, только если его тронули: иначе форма без итога в данных стёрла бы его.
      if (result !== (r.result_note ?? '')) body.result_note = result
      // Поле пустое: при закрытии — цена менеджера; при правке — вернуть цену менеджера.
      if (typed !== null) { body.actual_price = typed; body.price_note = note }
      else if (mode === 'settle' && r.actual_price != null) body.actual_price = managerPrice
      const res = await sendMeasure(`/api/measure-requests/${r.id}`, 'PATCH', body)
      if (!res.ok) { if (!res.cancelled) setError(res.error); return }
      const final = typed ?? managerPrice
      onDone(`${mode === 'done' ? 'Замер закрыт' : 'Сохранено'}: ${r.deal_number || `#${r.id}`} — выезд ${final > 0 ? fmt(final) : 'без цены'}, ${PAYMENT_LABEL[pay as VisitPayment]}. Итоги — во вкладке «Заработок».`)
    } finally { setBusy(false) }
  }

  const inp = 'bg-white border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[12px] outline-none focus:border-[#111110]'
  return (
    <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50/40 p-3 space-y-2 text-[12px]">
      <p>Менеджер заложил: <b>{managerPrice > 0 ? fmt(managerPrice) : 'цена не указана'}</b>{r.payer ? ` · платит ${r.payer}` : ''}</p>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[#4b4b47]">Вышло на объекте:</span>
        <input type="number" inputMode="numeric" min={0} value={price} onChange={e => setPrice(e.target.value)}
          placeholder={managerPrice > 0 ? `${managerPrice} — как у менеджера` : 'сумма'} className={`${inp} w-44`} />
        <span>₽</span>
      </div>
      {changed && (
        <input value={note} onChange={e => setNote(e.target.value)} maxLength={500}
          placeholder="Коротко почему другая цена: например, две душевые вместо одной"
          className={`${inp} w-full ${note.trim() ? '' : 'border-amber-300'}`} />
      )}
      <div>
        <p className="text-[#4b4b47] mb-1">Как оплачен выезд?</p>
        <div className="flex flex-wrap gap-1.5">
          {CHOICES.map(c => (
            <button key={c.v} type="button" onClick={() => setPay(c.v)}
              className={`rounded-lg px-2.5 py-1.5 border ${pay === c.v ? 'bg-[#111110] text-white border-[#111110]' : 'bg-white text-[#4b4b47] border-[#e4e4e0] hover:bg-[#f5f5f3]'}`}>
              {c.l}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="text-[#4b4b47] mb-1">Итог для менеджера <span className="text-[#9a9a95]">— что увидел, что важно для чертежа (по желанию)</span></p>
        <textarea value={result} onChange={e => setResult(e.target.value)} rows={2} maxLength={2000}
          placeholder="Стена завалена на 15 мм, ниша 1180, розетка справа на 1200 — учесть; клиент хочет чёрный профиль"
          className={`${inp} w-full resize-y`} />
      </div>
      {error && <p className="text-red-600">{error}</p>}
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={!ready || busy}
          className="font-semibold bg-emerald-600 text-white rounded-lg px-3 py-1.5 hover:bg-emerald-700 disabled:opacity-40">
          {busy ? '…' : mode === 'done' ? '✅ Закрыть замер' : 'Сохранить'}
        </button>
        <button onClick={onCancel} className="text-[#9a9a95]">отмена</button>
        {!pay && <span className="text-amber-700">отметь оплату выезда</span>}
        {pay && changed && !note.trim() && <span className="text-amber-700">напиши, почему цена другая</span>}
      </div>
    </div>
  )
}
