'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'

type ServiceLine = { name: string; qty?: number; unit?: string; total: number }

type Calc = {
  id: number
  created_at: string
  product_type: string
  input_data: Record<string, unknown>
  cost_breakdown: { lines: { name: string; qty: number; unit: string; price: number; total: number }[]; totalCost: number }
  financial_breakdown: {
    serviceLines: ServiceLine[]
    servicesTotal: number
  }
  final_price: number
  discount: number
  client_text: string | null
  notes: string | null
}

const PRODUCT_NAMES: Record<string, string> = {
  mirror:          'Зеркало с подсветкой',
  loft:            'Лофт-перегородка',
  shower:          'Душевая перегородка',
  shower_standard: 'Душевая перегородка',
  shower_budget:   'Душевая перегородка',
}

function getDimensions(c: Calc): string {
  const d = c.input_data
  if (c.product_type === 'mirror') {
    const shape = d.shape === 'circle' ? 'круглое' : d.shape === 'oval' ? 'овальное' : ''
    const dims  = d.shape === 'circle' ? `Ø${d.width} мм` : `${d.width} × ${d.height} мм`
    return [shape, dims].filter(Boolean).join(', ')
  }
  if (c.product_type === 'loft') {
    const parts = [`${d.width} × ${d.height} мм`]
    if (d.sections) parts.push(`${d.sections} секц.`)
    if (d.systemType === 'sliding') parts.push('раздвижная')
    else if (d.systemType === 'swing') parts.push('распашная')
    return parts.join(', ')
  }
  const dims = (d.dimStr as string) ?? `${d.width} × ${d.height} мм`
  const tier = d.tier === 'budget' ? 'Бюджет' : 'Стандарт'
  return `${dims}, ${tier}`
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

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen text-gray-400 text-sm">
      Подготовка документа...
    </div>
  )
  if (!calc) return (
    <div className="flex items-center justify-center min-h-screen text-gray-400 text-sm">
      Расчёт не найден
    </div>
  )

  const productName  = PRODUCT_NAMES[calc.product_type] ?? calc.product_type
  const dimensions   = getDimensions(calc)
  const date         = new Date(calc.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
  const serviceLines = calc.financial_breakdown?.serviceLines ?? []
  const servicesTotal = calc.financial_breakdown?.servicesTotal ?? 0
  const productPrice = calc.final_price - servicesTotal
  const fmtPrice     = (n: number) => n.toLocaleString('ru-RU') + ' ₽'

  return (
    <>
      <style>{`
        @page { margin: 18mm 15mm; size: A4; }
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-print { display: none !important; }
        }
        * { box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, sans-serif; background: #fff; }
      `}</style>

      {/* Кнопки — только на экране */}
      <div className="no-print fixed top-4 right-4 flex gap-2 z-50 print:hidden">
        <button onClick={() => window.print()}
          className="px-4 py-2 bg-[#111110] text-white text-sm font-semibold rounded-lg shadow-lg hover:bg-[#2a2a28] transition-colors">
          Скачать PDF
        </button>
        <button onClick={() => window.close()}
          className="px-4 py-2 bg-white border border-gray-200 text-gray-600 text-sm font-medium rounded-lg shadow-lg hover:bg-gray-50 transition-colors">
          Закрыть
        </button>
      </div>

      <div className="max-w-[680px] mx-auto px-8 py-10 text-gray-900">

        {/* Шапка */}
        <div className="flex justify-between items-start pb-5 mb-6" style={{ borderBottom: '2px solid #111110' }}>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div style={{ width: 28, height: 28, background: '#111110', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ color: '#fff', fontSize: 10, fontWeight: 700 }}>MG</span>
              </div>
              <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.5px' }}>MGlass</span>
            </div>
            <p style={{ fontSize: 12, color: '#6b6b66', marginTop: 2 }}>Производство стеклянных конструкций · Москва</p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={{ fontSize: 10, color: '#9a9a95', textTransform: 'uppercase', letterSpacing: 1 }}>Коммерческое предложение</p>
            <p style={{ fontSize: 13, color: '#111110', marginTop: 4, fontWeight: 600 }}>№ {calc.id} от {date}</p>
          </div>
        </div>

        {/* Продукт */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 4px' }}>{productName}</h1>
          <p style={{ fontSize: 14, color: '#6b6b66', margin: 0 }}>{dimensions}</p>
          {calc.notes && (
            <div style={{ marginTop: 10, background: '#f8f8f7', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#6b6b66' }}>
              {calc.notes}
            </div>
          )}
        </div>

        {/* Состав (клиентский текст) */}
        {calc.client_text && (
          <div style={{ marginBottom: 24 }}>
            <p style={{ fontSize: 10, fontWeight: 700, color: '#9a9a95', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
              Состав изделия
            </p>
            <div style={{ fontSize: 13, color: '#111110', lineHeight: 1.7, whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>
              {calc.client_text}
            </div>
          </div>
        )}

        {/* Услуги */}
        {serviceLines.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <p style={{ fontSize: 10, fontWeight: 700, color: '#9a9a95', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
              Дополнительные услуги
            </p>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <tbody>
                {serviceLines.map((l, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f0f0ec' }}>
                    <td style={{ padding: '7px 0', color: '#111110' }}>{l.name}</td>
                    <td style={{ padding: '7px 0', textAlign: 'right', color: '#111110', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                      {fmtPrice(l.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Итого */}
        <div style={{ borderTop: '2px solid #111110', paddingTop: 16, marginTop: 8 }}>
          {serviceLines.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#6b6b66', marginBottom: 6 }}>
              <span>Стоимость изделия</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtPrice(productPrice)}</span>
            </div>
          )}
          {calc.discount > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#6b6b66', marginBottom: 6 }}>
              <span>Скидка {calc.discount}%</span>
              <span style={{ color: '#16a34a' }}>учтена</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <p style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>Итоговая стоимость</p>
            <p style={{ fontSize: 26, fontWeight: 800, margin: 0, fontVariantNumeric: 'tabular-nums' }}>
              {fmtPrice(calc.final_price)}
            </p>
          </div>
        </div>

        {/* Условия */}
        <div style={{ marginTop: 28, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          {[
            { label: 'Срок изготовления', value: '7–14 рабочих дней' },
            { label: 'Гарантия',          value: '2 года' },
            { label: 'Предложение действительно', value: '14 дней' },
          ].map(item => (
            <div key={item.label} style={{ background: '#f8f8f7', borderRadius: 8, padding: '10px 12px' }}>
              <p style={{ fontSize: 10, color: '#9a9a95', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: 0.5 }}>{item.label}</p>
              <p style={{ fontSize: 12, fontWeight: 600, color: '#111110', margin: 0 }}>{item.value}</p>
            </div>
          ))}
        </div>

        {/* Призыв к действию */}
        <div style={{ marginTop: 20, background: '#111110', borderRadius: 10, padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <p style={{ color: '#fff', fontSize: 13, fontWeight: 600, margin: '0 0 2px' }}>Готовы двигаться дальше?</p>
            <p style={{ color: '#9a9a95', fontSize: 12, margin: 0 }}>Запишитесь на бесплатный замер — уточним всё на месте</p>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 16 }}>
            <p style={{ color: '#fff', fontSize: 13, fontWeight: 700, margin: 0 }}>Замер бесплатно</p>
          </div>
        </div>

        {/* Футер */}
        <div style={{ marginTop: 24, paddingTop: 14, borderTop: '1px solid #e4e4e0', display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#9a9a95' }}>
          <span>MGlass — производство и монтаж стеклянных конструкций</span>
          <span>mglass.vercel.app</span>
        </div>

      </div>
    </>
  )
}
