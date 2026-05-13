'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'

type ServiceLine = { name: string; qty?: number; unit?: string; price?: number; total: number }

type Calc = {
  id: number
  created_at: string
  product_type: string
  input_data: Record<string, unknown>
  cost_breakdown: { lines: { name: string; qty: number; unit: string; price: number; total: number }[]; totalCost: number }
  financial_breakdown: {
    serviceLines: ServiceLine[]
    servicesTotal: number
    expensesPercent?: number
  }
  final_price: number
  discount: number
  client_text: string | null
  notes: string | null
  client_name?: string | null
  client_phone?: string | null
}

function fmt(n: number) {
  return n.toLocaleString('ru-RU') + ' ₽'
}

function addDays(date: Date, days: number) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

function buildProductDescription(calc: Calc): string {
  const d = calc.input_data
  if (calc.product_type === 'shower' || calc.product_type === 'shower_budget') {
    const tier    = d.tier === 'budget' ? 'Бюджетная серия' : 'Стандарт'
    const model   = d.model as string || ''
    const dims    = (d.dimStr as string) || `${d.width}×${d.height}`
    const glass   = d.glassType as string || d.glass as string || ''
    const thick   = d.thickness || 8
    const color   = d.hwColor as string || ''
    const colorLabel: Record<string, string> = { chrome: 'Хром', black: 'Чёрный', bronze: 'Бронза', gold: 'Золото', white: 'Белый' }
    const colorRu = colorLabel[color] || color
    const parts = [
      `Стеклянная душевая перегородка${model ? '. ' + model : ''}.`,
      `Стекло ${thick}мм, ${glass || 'М1 прозрачное'}, закалённое.`,
      colorRu ? `Фурнитура ${colorRu}, Алюминиевый профиль, фурнитура нержавейка.` : '',
      `Размеры ${dims}мм.`,
      `[${tier}]`,
    ]
    return parts.filter(Boolean).join(' ')
  }
  if (calc.product_type === 'mirror') {
    const shape = d.shape === 'circle' ? 'круглое' : d.shape === 'oval' ? 'овальное' : 'прямоугольное'
    const dims  = d.shape === 'circle' ? `Ø${d.width} мм` : `${d.width}×${d.height} мм`
    const glass = d.glassType as string || 'М1 прозрачное'
    return `Зеркало ${shape}, ${glass}. Размер: ${dims}.`
  }
  if (calc.product_type === 'loft') {
    const dims = `${d.width}×${d.height} мм`
    const sys  = d.systemType === 'sliding' ? 'раздвижная' : d.systemType === 'swing' ? 'распашная' : ''
    return `Лофт-перегородка${sys ? ', ' + sys : ''}. Размеры: ${dims}.`
  }
  return 'Изделие из стекла'
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
      setTimeout(() => window.print(), 400)
    }
  }, [loading, calc])

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', color: '#9a9a95', fontSize: 14 }}>
      Подготовка документа...
    </div>
  )
  if (!calc) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', color: '#9a9a95', fontSize: 14 }}>
      Расчёт не найден
    </div>
  )

  const createdAt     = new Date(calc.created_at)
  const dateStr       = createdAt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const validUntil    = addDays(createdAt, 7)
  const kpNum         = String(calc.id).padStart(4, '0') + '-0'
  const serviceLines  = calc.financial_breakdown?.serviceLines ?? []
  const servicesTotal = calc.financial_breakdown?.servicesTotal ?? 0
  const productPrice  = calc.final_price - servicesTotal
  const grandTotal    = calc.final_price
  const vatAmount     = Math.round(grandTotal / 1.05 * 0.05 * 100) / 100
  const description   = buildProductDescription(calc)

  const hasMounting  = serviceLines.some(s => s.name === 'Монтаж')
  const hasLifting   = serviceLines.some(s => s.name === 'Подъём на этаж')
  const deliveryLine = serviceLines.find(s => s.name.startsWith('Доставка'))

  const tableRows: { id: number; name: string; qty: number | string; price: number | string; total: number | string; italic?: boolean; isZero?: boolean }[] = [
    { id: 1, name: description, qty: 1, price: productPrice, total: productPrice },
  ]

  let rowIdx = 2
  if (hasMounting) {
    const ml = serviceLines.find(s => s.name === 'Монтаж')!
    tableRows.push({ id: rowIdx++, name: 'Монтаж', qty: ml.qty ?? 1, price: ml.price ?? ml.total, total: ml.total })
  }
  if (hasLifting) {
    const ll = serviceLines.find(s => s.name === 'Подъём на этаж')!
    tableRows.push({ id: rowIdx++, name: 'Подъём*', qty: ll.qty ?? 0, price: ll.price ?? 500, total: ll.total })
  } else {
    tableRows.push({ id: rowIdx++, name: 'Подъём*', qty: 0, price: 500, total: 0, isZero: true })
  }
  if (deliveryLine) {
    tableRows.push({ id: rowIdx++, name: `Доставка\n${deliveryLine.name.replace('Доставка', '').trim()}`, qty: 1, price: deliveryLine.total, total: deliveryLine.total, italic: true })
  }

  return (
    <>
      <style>{`
        @page { margin: 15mm 14mm; size: A4 portrait; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif;
          background: #fff;
          color: #111;
          font-size: 13px;
          line-height: 1.45;
        }
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-print { display: none !important; }
        }
        table { border-collapse: collapse; width: 100%; }
        th, td { padding: 8px 10px; }
      `}</style>

      {/* Кнопки — только на экране */}
      <div className="no-print" style={{ position: 'fixed', top: 16, right: 16, display: 'flex', gap: 8, zIndex: 100 }}>
        <button onClick={() => window.print()}
          style={{ padding: '8px 18px', background: '#111', color: '#fff', fontSize: 13, fontWeight: 600, borderRadius: 8, border: 'none', cursor: 'pointer' }}>
          Скачать PDF
        </button>
        <button onClick={() => window.close()}
          style={{ padding: '8px 18px', background: '#fff', color: '#555', fontSize: 13, border: '1px solid #ddd', borderRadius: 8, cursor: 'pointer' }}>
          Закрыть
        </button>
      </div>

      <div style={{ maxWidth: 720, margin: '0 auto', padding: '10px 0' }}>

        {/* ── Шапка ─────────────────────────────────── */}
        <table style={{ marginBottom: 18 }}>
          <tbody>
            <tr>
              <td style={{ verticalAlign: 'top', width: '55%' }}>
                {/* Логотип */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <svg width="44" height="44" viewBox="0 0 44 44" fill="none">
                    <rect width="44" height="44" rx="8" fill="#111110"/>
                    <text x="22" y="28" textAnchor="middle" fill="white" fontSize="14" fontWeight="800" fontFamily="Arial">MG</text>
                  </svg>
                  <div>
                    <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.5px', lineHeight: 1 }}>GLASS</div>
                    <div style={{ fontSize: 10, color: '#888', letterSpacing: 0.5 }}>ИЗДЕЛИЯ ИЗ СТЕКЛА</div>
                  </div>
                </div>
                <div style={{ fontSize: 11, color: '#555', lineHeight: 1.9 }}>
                  <div><a href="https://mglass.pro/" style={{ color: '#0071e3', textDecoration: 'none' }}>https://mglass.pro/</a></div>
                  <div>8 (925) 788 58 37</div>
                  <div>mglass.ceo@gmail.com</div>
                </div>
              </td>
              <td style={{ verticalAlign: 'top', textAlign: 'right' }}>
                <div style={{ fontSize: 11, color: '#555', lineHeight: 2.1 }}>
                  <div><span style={{ color: '#888' }}>Дата</span>{'  '}<strong>{dateStr}</strong></div>
                  <div><span style={{ color: '#888' }}>Номер КП</span>{'  '}<strong>{calc.id}</strong></div>
                  <div><span style={{ color: '#888' }}>Код сделки</span>{'  '}<strong>{kpNum}</strong></div>
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        {/* ── Заголовок ─────────────────────────────── */}
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.3px' }}>Коммерческое предложение</div>
        </div>

        {/* ── Клиент + срок ─────────────────────────── */}
        <table style={{ marginBottom: 14, fontSize: 12 }}>
          <tbody>
            <tr>
              <td style={{ width: '40%', paddingBottom: 6 }}>
                <span style={{ color: '#888' }}>Заказчик</span>{'  '}
                <strong>{calc.client_name || '___________________________'}</strong>
                {calc.client_phone && <span style={{ color: '#555', marginLeft: 8 }}>{calc.client_phone}</span>}
              </td>
              <td style={{ textAlign: 'right', paddingBottom: 6 }}>
                <span style={{ color: '#888' }}>Предложение актуально до</span>{'  '}<strong>{validUntil}</strong>
              </td>
            </tr>
            <tr>
              <td/>
              <td style={{ textAlign: 'right' }}>
                <span style={{ color: '#888' }}>Кем подготовлено</span>{'  '}<strong>Владислав</strong>
              </td>
            </tr>
          </tbody>
        </table>

        {/* ── Таблица позиций ───────────────────────── */}
        <table style={{ border: '1px solid #ddd', marginBottom: 0, fontSize: 12 }}>
          <thead>
            <tr style={{ background: '#f7f7f7', borderBottom: '2px solid #ccc' }}>
              <th style={{ width: 36, textAlign: 'center', fontWeight: 700, borderRight: '1px solid #ddd' }}>№</th>
              <th style={{ textAlign: 'left', fontWeight: 700, borderRight: '1px solid #ddd' }}>Изделие</th>
              <th style={{ width: 80, textAlign: 'center', fontWeight: 700, borderRight: '1px solid #ddd' }}>Количество</th>
              <th style={{ width: 110, textAlign: 'right', fontWeight: 700, borderRight: '1px solid #ddd' }}>Цена за единицу</th>
              <th style={{ width: 100, textAlign: 'right', fontWeight: 700 }}>Сумма</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map((row, i) => (
              <tr key={row.id} style={{ borderBottom: '1px solid #eee', background: i % 2 === 1 ? '#fafafa' : '#fff' }}>
                <td style={{ textAlign: 'center', color: '#888', borderRight: '1px solid #eee', verticalAlign: 'top', paddingTop: 10 }}>{row.id}</td>
                <td style={{ borderRight: '1px solid #eee', verticalAlign: 'top', fontStyle: row.italic ? 'italic' : 'normal', fontWeight: i === 0 ? 600 : 400 }}>
                  {row.name.split('\n').map((line, j) => (
                    <div key={j}>{line}</div>
                  ))}
                </td>
                <td style={{ textAlign: 'center', borderRight: '1px solid #eee', verticalAlign: 'top', color: row.isZero ? '#aaa' : '#111' }}>
                  {row.qty}
                </td>
                <td style={{ textAlign: 'right', borderRight: '1px solid #eee', verticalAlign: 'top', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {typeof row.price === 'number' ? fmt(row.price) : row.price}
                </td>
                <td style={{ textAlign: 'right', verticalAlign: 'top', fontWeight: row.isZero ? 400 : 700, fontVariantNumeric: 'tabular-nums', color: row.isZero ? '#aaa' : '#111' }}>
                  {row.isZero ? '— ₽' : typeof row.total === 'number' ? fmt(row.total) : row.total}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* ── Промежуточный итог ────────────────────── */}
        <table style={{ width: '100%', fontSize: 12, marginBottom: 0 }}>
          <tbody>
            <tr>
              <td style={{ paddingTop: 8 }}>
                <div style={{ fontSize: 11, color: '#666', lineHeight: 1.8 }}>
                  <div>Срок изготовления изделий из стекла <strong><u>15 рабочих дней</u></strong></div>
                  <div>*Подъём одного изделия 500р./этаж при необходимости</div>
                </div>
              </td>
              <td style={{ textAlign: 'right', paddingTop: 8, verticalAlign: 'bottom', width: 220 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 4, color: '#555' }}>
                  <span>Промежуточный итог</span>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(grandTotal)}</span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        {/* ── ИТОГО ─────────────────────────────────── */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4, marginBottom: 4 }}>
          <div style={{ width: 280, borderTop: '2px solid #ccc', paddingTop: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0' }}>
              <span style={{ fontSize: 14, fontWeight: 700 }}>ИТОГО:</span>
              <span style={{ fontSize: 18, fontWeight: 800, background: '#FFD700', padding: '2px 10px', borderRadius: 4, fontVariantNumeric: 'tabular-nums' }}>
                {fmt(grandTotal)}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#555', paddingBottom: 4 }}>
              <span>В т.ч. НДС 5%</span>
              <span style={{ fontVariantNumeric: 'tabular-nums', fontStyle: 'italic' }}>
                {vatAmount.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽
              </span>
            </div>
          </div>
        </div>

        {/* ── Примечание ────────────────────────────── */}
        {calc.notes && (
          <div style={{ marginTop: 12, fontSize: 11, color: '#555', background: '#f8f8f7', borderRadius: 6, padding: '8px 12px' }}>
            {calc.notes}
          </div>
        )}

        {/* ── Душевые ограждения описание ───────────── */}
        <div style={{ marginTop: 12, fontSize: 11, color: '#666' }}>
          Душевые ограждения выполняют функцию защиты от брызг и обеспечивают герметичность на 80%
        </div>

        {/* ── Благодарим ────────────────────────────── */}
        <div style={{ marginTop: 20, borderTop: '2px solid #111', paddingTop: 14 }}>
          <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 4 }}>Благодарим за обращение!</div>
          <div style={{ fontSize: 11, color: '#888' }}>душевые, зеркала и лофт</div>
        </div>

      </div>
    </>
  )
}
