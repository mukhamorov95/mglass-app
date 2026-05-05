'use client'

import { useEffect, useState } from 'react'
import { CartItem } from '@/lib/CartContext'
import { aggregateOrder } from '@/lib/cartAggregator'

const TYPE_LABELS: Record<string, string> = {
  mirror: 'Зеркало с подсветкой',
  loft: 'Лофт-перегородка',
}

function fmt(n: number) { return n.toLocaleString('ru-RU') + ' ₽' }

export default function CartPrintPage() {
  const [items, setItems] = useState<CartItem[]>([])
  const [ready, setReady] = useState(false)

  useEffect(() => {
    try {
      const stored = localStorage.getItem('mglass_cart_v1')
      if (stored) setItems(JSON.parse(stored))
    } catch {}
    setReady(true)
  }, [])

  useEffect(() => {
    if (ready && items.length > 0) setTimeout(() => window.print(), 300)
  }, [ready, items])

  if (!ready) return <div className="flex items-center justify-center min-h-screen text-gray-400">Подготовка документа...</div>
  if (items.length === 0) return <div className="flex items-center justify-center min-h-screen text-gray-400">Корзина пуста</div>

  const summary = aggregateOrder(items)
  const date = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <>
      <style>{`
        @media print {
          @page { margin: 20mm 18mm; size: A4; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-print { display: none !important; }
        }
        body { font-family: 'Times New Roman', Times, serif; color: #111; }
        table { border-collapse: collapse; }
      `}</style>

      <div className="no-print fixed top-4 right-4 flex gap-2 z-50">
        <button onClick={() => window.print()} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg shadow-lg hover:bg-blue-700">
          Печать / PDF
        </button>
        <button onClick={() => window.close()} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg shadow-lg hover:bg-gray-200">
          Закрыть
        </button>
      </div>

      <div className="max-w-[680px] mx-auto px-10 py-10">

        {/* Шапка */}
        <div className="mb-8">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-2xl font-bold tracking-tight" style={{ fontFamily: 'Arial, sans-serif' }}>MGlass</p>
              <p className="text-xs text-gray-500 mt-0.5">Производство стеклянных конструкций и зеркал</p>
            </div>
            <div className="text-right">
              <p className="text-sm font-semibold">Коммерческое предложение</p>
              <p className="text-xs text-gray-500 mt-0.5">от {date}</p>
            </div>
          </div>
          <div className="mt-4 border-b-2 border-black" />
        </div>

        {/* Таблица изделий */}
        <table className="w-full" style={{ fontFamily: 'Arial, sans-serif', fontSize: '13px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #999' }}>
              <th style={{ textAlign: 'left', paddingBottom: '8px', paddingRight: '12px', width: '32px', color: '#555', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>№</th>
              <th style={{ textAlign: 'left', paddingBottom: '8px', color: '#555', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Изделие</th>
              <th style={{ textAlign: 'right', paddingBottom: '8px', paddingLeft: '16px', color: '#555', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>Стоимость</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr key={item.localId} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '10px 12px 10px 0', verticalAlign: 'top', color: '#666' }}>{idx + 1}.</td>
                <td style={{ padding: '10px 0', verticalAlign: 'top' }}>
                  <div style={{ fontWeight: 600 }}>{TYPE_LABELS[item.product_type]}</div>
                  <div style={{ color: '#555', marginTop: '2px' }}>{item.label}</div>
                </td>
                <td style={{ padding: '10px 0 10px 16px', textAlign: 'right', verticalAlign: 'top', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', fontWeight: 600 }}>
                  {fmt(item.final_price)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            {/* Пустая строка-разделитель */}
            <tr><td colSpan={3} style={{ paddingTop: '4px' }} /></tr>

            {/* Итого по изделиям */}
            <tr style={{ borderTop: '1px solid #bbb' }}>
              <td />
              <td style={{ padding: '8px 0', color: '#333' }}>Итого по изделиям</td>
              <td style={{ padding: '8px 0 8px 16px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmt(summary.itemsTotal)}</td>
            </tr>

            {summary.mounting > 0 && (
              <tr>
                <td />
                <td style={{ padding: '4px 0', color: '#333' }}>Монтаж</td>
                <td style={{ padding: '4px 0 4px 16px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmt(summary.mounting)}</td>
              </tr>
            )}
            {summary.lifting > 0 && (
              <tr>
                <td />
                <td style={{ padding: '4px 0', color: '#333' }}>Подъём на этаж</td>
                <td style={{ padding: '4px 0 4px 16px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmt(summary.lifting)}</td>
              </tr>
            )}
            {summary.delivery > 0 && (
              <tr>
                <td />
                <td style={{ padding: '4px 0', color: '#333' }}>Доставка</td>
                <td style={{ padding: '4px 0 4px 16px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmt(summary.delivery)}</td>
              </tr>
            )}

            {/* Итого */}
            <tr style={{ borderTop: '2px solid #111' }}>
              <td />
              <td style={{ padding: '10px 0', fontWeight: 700, fontSize: '15px' }}>ИТОГО</td>
              <td style={{ padding: '10px 0 10px 16px', textAlign: 'right', fontWeight: 700, fontSize: '15px', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                {fmt(summary.grandTotal)}
              </td>
            </tr>
          </tfoot>
        </table>

        {/* Футер */}
        <div style={{ marginTop: '48px', paddingTop: '16px', borderTop: '1px solid #ddd', display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#888', fontFamily: 'Arial, sans-serif' }}>
          <span>MGlass — производство стеклянных конструкций и зеркал</span>
          <span>Предложение действительно 14 дней</span>
        </div>
      </div>
    </>
  )
}
