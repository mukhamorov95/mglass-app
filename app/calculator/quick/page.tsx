'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { calcFinancialModel } from '@/lib/pricing/financialModel'

const numOr = (v: string) => { const n = Number(String(v ?? '').replace(/[^\d.-]/g, '')); return isFinite(n) ? n : 0 }
const RUB = (n: number) => Math.round(n).toLocaleString('ru-RU')

const L = 'block text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1'
const I = 'w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[14px] outline-none focus:border-[#111110] bg-white'

export default function QuickCalcPage() {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [glass, setGlass] = useState('')       // себестоимость стекла/зеркала
  const [hw, setHw] = useState('')             // себестоимость фурнитуры
  const [margin, setMargin] = useState('40')
  const [tax, setTax] = useState('12')
  const [perSection, setPerSection] = useState('')  // монтаж за секцию
  const [sections, setSections] = useState('1')
  const [delivery, setDelivery] = useState('')
  const [lift, setLift] = useState('')

  const glassCost = numOr(glass), hwCost = numOr(hw)
  const directCost = glassCost + hwCost
  const marginN = numOr(margin), taxN = numOr(tax)
  const fin = calcFinancialModel({ directCost, marginPercent: marginN, taxPercent: taxN })
  const productPrice = fin ? fin.basePrice : 0
  const installTotal = numOr(perSection) * numOr(sections)
  const deliveryN = numOr(delivery)
  const liftN = numOr(lift)
  const total = productPrice + installTotal + deliveryN + liftN
  const denom = 1 - marginN / 100 - taxN / 100

  function toKp() {
    const items: { name: string; qty?: number; price?: number; sum: number }[] = []
    items.push({ name: title.trim() || 'Изделие', qty: 1, price: Math.round(productPrice), sum: Math.round(productPrice) })
    if (installTotal > 0) items.push({ name: 'Монтаж', qty: numOr(sections) || 1, price: numOr(perSection), sum: Math.round(installTotal) })
    if (deliveryN > 0) items.push({ name: 'Доставка', qty: 1, sum: Math.round(deliveryN) })
    if (liftN > 0) items.push({ name: 'Подъём', qty: 1, sum: Math.round(liftN) })
    const content = {
      title: (title.trim() || 'Изделие').toUpperCase(),
      items,
      subtotal: Math.round(total),
      total: Math.round(total),
    }
    try { sessionStorage.setItem('mglass_kp_prefill', JSON.stringify(content)) } catch { /* ignore */ }
    router.push('/kp')
  }

  const Row = ({ label, value, bold, accent }: { label: string; value: string; bold?: boolean; accent?: boolean }) => (
    <div className={`flex items-center justify-between py-1.5 ${bold ? 'text-[15px] font-bold' : 'text-[13px]'} ${accent ? 'text-[#E1442E]' : 'text-[#111110]'}`}>
      <span className={bold ? '' : 'text-[#6b6b66]'}>{label}</span><span>{value}</span>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#f5f5f3] p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-5">
          <h1 className="text-[18px] font-semibold text-[#111110]">Быстрый расчёт</h1>
          <p className="text-[12px] text-[#9a9a95] mt-0.5">Прозрачный расчёт по формуле: себестоимость → рекомендованная цена. Ничего не скрыто.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_360px] gap-4 items-start">
          {/* Ввод */}
          <div className="space-y-4">
            <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
              <p className="text-[13px] font-semibold text-[#111110] mb-3">Изделие</p>
              <div className="mb-3"><label className={L}>Наименование</label>
                <input className={I} value={title} onChange={e => setTitle(e.target.value)} placeholder="Зеркало с подсветкой / Душевая перегородка…" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={L}>Себестоимость стекла/зеркала, ₽</label><input className={I} value={glass} onChange={e => setGlass(e.target.value)} placeholder="почём для M-Glass" /></div>
                <div><label className={L}>Себестоимость фурнитуры, ₽</label><input className={I} value={hw} onChange={e => setHw(e.target.value)} placeholder="0 если нет" /></div>
                <div><label className={L}>Маржа, %</label><input className={I} value={margin} onChange={e => setMargin(e.target.value)} /></div>
                <div><label className={L}>Налог, %</label><input className={I} value={tax} onChange={e => setTax(e.target.value)} /></div>
              </div>
              {denom <= 0 && <p className="text-[12px] text-red-600 mt-2">Маржа + налог ≥ 100% — формула не считается. Уменьшите.</p>}
            </div>

            <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
              <p className="text-[13px] font-semibold text-[#111110] mb-3">Работы и логистика</p>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={L}>Монтаж за секцию, ₽</label><input className={I} value={perSection} onChange={e => setPerSection(e.target.value)} placeholder="0 если нет" /></div>
                <div><label className={L}>Количество секций</label><input className={I} value={sections} onChange={e => setSections(e.target.value)} /></div>
                <div><label className={L}>Доставка, ₽</label><input className={I} value={delivery} onChange={e => setDelivery(e.target.value)} placeholder="стандартная" /></div>
                <div><label className={L}>Подъём, ₽</label><input className={I} value={lift} onChange={e => setLift(e.target.value)} placeholder="0 = не считается" /></div>
              </div>
            </div>
          </div>

          {/* Результат */}
          <div className="bg-white border border-[#e4e4e0] rounded-xl p-4 md:sticky md:top-4">
            <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-2">Расчёт</p>
            <Row label="Себестоимость (стекло + фурнитура)" value={`${RUB(directCost)} ₽`} />
            <div className="text-[11px] text-[#9a9a95] pb-1.5 leading-snug">
              {RUB(directCost)} ÷ (1 − {marginN}% − {taxN}%) = <b className="text-[#111110]">{RUB(productPrice)} ₽</b>
            </div>
            {fin && <>
              <Row label={`в т.ч. налог ${taxN}%`} value={`${RUB(fin.taxAmount)} ₽`} />
              <Row label={`в т.ч. маржа ${marginN}%`} value={`${RUB(fin.marginAmount)} ₽`} />
            </>}
            <div className="border-t border-[#f0f0ec] my-1" />
            <Row label="Цена изделия" value={`${RUB(productPrice)} ₽`} />
            {installTotal > 0 && <Row label={`Монтаж (${numOr(sections)} × ${RUB(numOr(perSection))})`} value={`${RUB(installTotal)} ₽`} />}
            {deliveryN > 0 && <Row label="Доставка" value={`${RUB(deliveryN)} ₽`} />}
            {liftN > 0 && <Row label="Подъём" value={`${RUB(liftN)} ₽`} />}
            <div className="border-t-2 border-[#111110] mt-2 mb-1" />
            <Row label="Итого клиенту" value={`${RUB(total)} ₽`} bold accent />

            <button onClick={toKp} disabled={total <= 0}
              className="w-full mt-4 px-4 py-2.5 bg-[#111110] text-white text-[13px] font-semibold rounded-lg hover:bg-[#2a2a28] disabled:opacity-50">
              Сформировать КП →
            </button>
            <p className="text-[11px] text-[#9a9a95] mt-2 text-center">Данные подтянутся в редактор КП</p>
          </div>
        </div>
      </div>
    </div>
  )
}
