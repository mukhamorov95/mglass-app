'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useCart } from '@/lib/CartContext'
import { aggregateOrder } from '@/lib/cartAggregator'
import { saveCalculation } from '@/lib/saveCalculation'

const TYPE_LABELS: Record<string, string> = { mirror: 'Зеркало', loft: 'Лофт', shower: 'Душевая' }
const TYPE_DOT: Record<string, string> = {
  mirror: 'bg-blue-400',
  loft:   'bg-orange-400',
  shower: 'bg-cyan-400',
}

function fmt(n: number) { return n.toLocaleString('ru-RU') + ' ₽' }

export default function CartSection() {
  const { items, removeItem, clearCart, hydrated } = useCart()
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const router = useRouter()

  if (!hydrated || items.length === 0) return null

  const summary = aggregateOrder(items)

  async function handleSaveOrder() {
    setSaving(true)
    setSaveError(null)
    const groupId = items.length > 1 ? crypto.randomUUID() : undefined
    for (const item of items) {
      const result = await saveCalculation({
        product_type: item.product_type,
        input_data: item.input_data,
        cost_breakdown: item.cost_breakdown,
        financial_breakdown: item.financial_breakdown,
        base_price: item.base_price,
        discount: item.discount,
        partner_percent: item.partner_percent,
        // grand_total = finalPrice + services (what the client actually pays)
        final_price: item.grand_total,
        margin: item.margin,
        profit: item.profit,
        manager_bonus: item.manager_bonus,
        client_text: item.client_text,
        order_group_id: groupId,
      })
      if (result && 'error' in result) {
        setSaveError(result.error ?? 'Неизвестная ошибка')
        setSaving(false)
        return
      }
    }
    clearCart()
    router.refresh()
    router.push('/calculations')
  }

  return (
    <div className="mt-4">
      {/* Заголовок */}
      <div className="flex items-center justify-between mb-1.5 px-0.5">
        <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">
          Изделия в заказ
          <span className="ml-1.5 text-[#c4c4be] font-normal normal-case tracking-normal">
            {items.length} {items.length === 1 ? 'позиция' : items.length < 5 ? 'позиции' : 'позиций'}
          </span>
        </p>
        <button onClick={clearCart} className="text-[10px] text-[#c4c4be] hover:text-red-400 transition-colors">
          Очистить
        </button>
      </div>

      {/* Список изделий */}
      <div className="bg-white rounded-lg border border-[#e4e4e0] overflow-hidden">
        {items.map((item, idx) => (
          <div key={item.localId}
            className="flex items-center gap-2.5 px-3 py-2 border-b border-[#f5f5f3] last:border-0 hover:bg-[#fafaf9] group">
            <span className="text-[10px] text-[#c4c4be] w-4 text-right flex-shrink-0">{idx + 1}</span>
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${TYPE_DOT[item.product_type] ?? 'bg-gray-300'}`} />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-[#111110] truncate">{item.label}</p>
              <p className="text-[10px] text-[#9a9a95]">{TYPE_LABELS[item.product_type]}</p>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-xs font-mono font-semibold text-[#111110]">{fmt(item.final_price)}</p>
              <span className={`text-[10px] font-medium ${item.margin >= 35 ? 'text-emerald-600' : item.margin >= 25 ? 'text-amber-600' : 'text-red-500'}`}>
                {item.margin}%
              </span>
            </div>
            <button onClick={() => removeItem(item.localId)}
              className="w-4 h-4 flex items-center justify-center text-[#d4d4d0] hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0 text-base leading-none">
              ×
            </button>
          </div>
        ))}

        {/* Итоги */}
        <div className="bg-[#fafaf9] border-t border-[#e4e4e0] px-3 py-2 space-y-0.5">
          <div className="flex justify-between">
            <span className="text-[10px] text-[#9a9a95]">Изделия</span>
            <span className="text-[10px] font-mono text-[#6b6b66]">{fmt(summary.itemsTotal)}</span>
          </div>
          {summary.mounting > 0 && (
            <div className="flex justify-between">
              <span className="text-[10px] text-[#9a9a95]">Монтаж</span>
              <span className="text-[10px] font-mono text-[#6b6b66]">{fmt(summary.mounting)}</span>
            </div>
          )}
          {summary.delivery > 0 && (
            <div className="flex justify-between">
              <span className="text-[10px] text-[#9a9a95]">Доставка</span>
              <span className="text-[10px] font-mono text-[#6b6b66]">{fmt(summary.delivery)}</span>
            </div>
          )}
          <div className="flex justify-between pt-1.5 border-t border-[#e4e4e0]">
            <span className="text-xs font-semibold text-[#111110]">Итого по заказу</span>
            <span className="text-sm font-bold font-mono text-[#111110]">{fmt(summary.grandTotal)}</span>
          </div>
        </div>
      </div>

      {/* Ошибка сохранения */}
      {saveError && (
        <div className="mt-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200">
          <p className="text-[10px] text-red-600 font-medium">Ошибка: {saveError}</p>
        </div>
      )}

      {/* Кнопки */}
      <div className="flex gap-1.5 mt-2">
        <button onClick={handleSaveOrder} disabled={saving}
          className="flex-1 py-2 rounded-lg text-xs font-semibold bg-[#111110] text-white hover:bg-[#2a2a28] disabled:opacity-50 transition-colors">
          {saving ? 'Сохранение...' : 'Сохранить заказ'}
        </button>
        <button onClick={() => window.open('/cart/print', '_blank')}
          className="px-3 py-2 rounded-lg text-xs font-medium border border-[#e4e4e0] bg-white text-[#4b4b47] hover:bg-[#fafaf9] whitespace-nowrap">
          КП (PDF)
        </button>
      </div>
    </div>
  )
}
