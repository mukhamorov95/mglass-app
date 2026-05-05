'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'

type CostLine = { name: string; qty: number; unit: string; price: number; total: number }

type Calc = {
  id: number
  created_at: string
  product_type: string
  input_data: Record<string, unknown>
  cost_breakdown: { lines: CostLine[]; totalCost: number }
  financial_breakdown: {
    expensesPercent: number
    expensesAmount: number
    basePrice: number
    partnerAmount: number
    discountAmount: number
    serviceLines: CostLine[]
    servicesTotal: number
  }
  final_price: number
  discount: number
  client_text: string | null
  notes: string | null
}

export default function PrintPage() {
  const { id } = useParams()
  const [calc, setCalc] = useState<Calc | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data } = await supabase.from('calculations').select('*').eq('id', id).single()
      if (data) setCalc(data)
      setLoading(false)
    }
    load()
  }, [id])

  useEffect(() => {
    if (!loading && calc) {
      setTimeout(() => window.print(), 300)
    }
  }, [loading, calc])

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen text-gray-400">Подготовка документа...</div>
  )
  if (!calc) return (
    <div className="flex items-center justify-center min-h-screen text-gray-400">Расчёт не найден</div>
  )

  const productLabel = calc.product_type === 'mirror' ? 'Зеркало с подсветкой' : 'Лофт-перегородка'
  const params = calc.product_type === 'mirror'
    ? `${calc.input_data.width} × ${calc.input_data.height} мм`
    : `${calc.input_data.width} × ${calc.input_data.height} мм, ${calc.input_data.sections} секций`
  const date = new Date(calc.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
  const fb = calc.financial_breakdown
  const serviceLines = fb?.serviceLines ?? []

  return (
    <>
      <style>{`
        @media print {
          @page { margin: 20mm 15mm; size: A4; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-print { display: none !important; }
        }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
      `}</style>

      {/* Кнопки — скрываются при печати */}
      <div className="no-print fixed top-4 right-4 flex gap-2 z-50">
        <button
          onClick={() => window.print()}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg shadow-lg hover:bg-blue-700"
        >
          Печать / Сохранить PDF
        </button>
        <button
          onClick={() => window.close()}
          className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg shadow-lg hover:bg-gray-200"
        >
          Закрыть
        </button>
      </div>

      <div className="max-w-[700px] mx-auto px-8 py-10 text-gray-900">

        {/* Шапка */}
        <div className="flex justify-between items-start mb-8 pb-6 border-b-2 border-gray-900">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">MGlass</h1>
            <p className="text-sm text-gray-500 mt-1">Стеклянные конструкции и зеркала</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400 uppercase tracking-wide">Коммерческое предложение</p>
            <p className="text-sm text-gray-700 mt-1">№ {calc.id} от {date}</p>
          </div>
        </div>

        {/* Изделие */}
        <div className="mb-8">
          <h2 className="text-xl font-semibold mb-1">{productLabel}</h2>
          <p className="text-gray-600">{params}</p>
          {calc.notes && (
            <p className="mt-2 text-sm text-gray-600 bg-gray-50 rounded-lg px-4 py-3">{calc.notes}</p>
          )}
        </div>

        {/* Состав / клиентский текст */}
        {calc.client_text && (
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Состав</h3>
            <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">{calc.client_text}</pre>
          </div>
        )}

        {/* Дополнительные услуги */}
        {serviceLines.length > 0 && (
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Дополнительные услуги</h3>
            <table className="w-full text-sm">
              <tbody>
                {serviceLines.map((l, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="py-2 text-gray-700">{l.name}</td>
                    <td className="py-2 text-center text-gray-500">{l.qty} {l.unit}</td>
                    <td className="py-2 text-right font-mono">{l.total.toLocaleString('ru-RU')} ₽</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Итог */}
        <div className="border-t-2 border-gray-900 pt-4 mt-4">
          <div className="flex justify-between items-center">
            <div>
              <p className="text-lg font-semibold">Итоговая стоимость</p>
              {calc.discount > 0 && (
                <p className="text-sm text-gray-500">Скидка {calc.discount}% учтена</p>
              )}
            </div>
            <p className="text-3xl font-bold font-mono">{calc.final_price.toLocaleString('ru-RU')} ₽</p>
          </div>
        </div>

        {/* Футер */}
        <div className="mt-12 pt-6 border-t border-gray-200 text-xs text-gray-400 flex justify-between">
          <span>MGlass — производство стеклянных конструкций</span>
          <span>Предложение действительно 14 дней</span>
        </div>
      </div>
    </>
  )
}
