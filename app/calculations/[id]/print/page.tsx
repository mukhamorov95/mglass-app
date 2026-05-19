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
    discountAmount?: number
    expensesPercent?: number
  }
  final_price: number
  discount: number
  client_text: string | null
  notes: string | null
  client_name?: string | null
  client_phone?: string | null
  creator?: { name: string } | null
}

function fmt(n: number) { return n.toLocaleString('ru-RU') + ' ₽' }

function addDays(date: Date, days: number) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

function getProductDescription(calc: Calc): string {
  if (calc.client_text) {
    const lines: string[] = []
    for (const line of calc.client_text.split('\n')) {
      if (line === '') break
      if (/Стоимость|Итого с услугами/.test(line)) break
      if (/ — \d[\d\s]*₽/.test(line)) continue
      lines.push(line)
    }
    if (lines.length > 0) return lines.join('\n')
  }
  const d = calc.input_data
  if (calc.product_type === 'mirror') {
    const shape = d.shape === 'circle' ? 'круглое' : d.shape === 'oval' ? 'овальное' : 'прямоугольное'
    const dims  = d.shape === 'circle' ? `Ø${d.width} мм` : `${d.width}×${d.height} мм`
    return `Зеркало ${shape}, ${dims}`
  }
  if (calc.product_type === 'loft') {
    return `Лофт-перегородка ${d.width}×${d.height} мм`
  }
  if (calc.product_type.startsWith('shower')) {
    const dims = (d.dimStr as string) || `${d.width}×${d.height} мм`
    const glass = d.glassType as string || ''
    const thick = d.thickness ? `${d.thickness}мм` : '8мм'
    const colorLabel: Record<string, string> = { chrome: 'Хром', black: 'Чёрный', bronze: 'Бронза', gold: 'Золото', white: 'Белый' }
    const color = colorLabel[d.hwColor as string] || ''
    return [`Душевая перегородка ${dims}`, glass && `стекло ${thick} ${glass}`, color && `фурнитура ${color}`].filter(Boolean).join(', ')
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
      const { data } = await supabase.from('calculations').select('*, creator:users!created_by(name)').eq('id', id).single()
      if (data) setCalc(data)
      setLoading(false)
    }
    load()
  }, [id])

  useEffect(() => {
    if (!loading && calc) setTimeout(() => window.print(), 400)
  }, [loading, calc])

  if (loading) return <div style={S.loader}>Подготовка документа...</div>
  if (!calc)   return <div style={S.loader}>Расчёт не найден</div>

  const createdAt    = new Date(calc.created_at)
  const dateStr      = createdAt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const validUntil   = addDays(createdAt, 7)
  const serviceLines = calc.financial_breakdown?.serviceLines ?? []
  const servicesTotal= calc.financial_breakdown?.servicesTotal ?? 0
  const productPrice = calc.final_price - servicesTotal
  const grandTotal   = calc.final_price
  const vatAmount    = Math.round(grandTotal / 1.05 * 0.05 * 100) / 100
  const description  = getProductDescription(calc)
  const originalPrice = calc.discount > 0 ? Math.round(productPrice / (1 - calc.discount / 100)) : productPrice
  const discountAmount = originalPrice - productPrice

  type Row = { id: number|''; name: string; qty: number|string; price: number; total: number; isService?: boolean; isDiscount?: boolean; isZero?: boolean }
  const rows: Row[] = [{ id: 1, name: description, qty: 1, price: originalPrice, total: productPrice }]

  if (calc.discount > 0 && discountAmount > 0) {
    rows.push({ id: '', name: `Скидка ${calc.discount}%`, qty: 1, price: -discountAmount, total: -discountAmount, isDiscount: true })
  }

  let ri = 2
  const hasMounting  = serviceLines.some(s => s.name === 'Монтаж')
  const hasLifting   = serviceLines.some(s => s.name === 'Подъём на этаж')
  const deliveryLine = serviceLines.find(s => s.name.startsWith('Доставка'))

  if (hasMounting) {
    const ml = serviceLines.find(s => s.name === 'Монтаж')!
    rows.push({ id: ri++, name: 'Монтаж изделия', qty: 1, price: ml.price ?? ml.total, total: ml.total, isService: true })
  }
  if (hasLifting) {
    const ll = serviceLines.find(s => s.name === 'Подъём на этаж')!
    rows.push({ id: ri++, name: 'Подъём на этаж', qty: ll.qty ?? 1, price: ll.price ?? 500, total: ll.total, isService: true })
  } else {
    rows.push({ id: ri++, name: 'Подъём на этаж*', qty: 0, price: 500, total: 0, isService: true, isZero: true })
  }
  if (deliveryLine) {
    rows.push({ id: ri++, name: deliveryLine.name, qty: 1, price: deliveryLine.total, total: deliveryLine.total, isService: true })
  }

  return (
    <>
      <style>{`
        @page { margin: 15mm 14mm; size: A4 portrait; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; background: #fff; color: #1a1a1a; font-size: 12px; line-height: 1.5; }
        @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } .no-print { display: none !important; } }
      `}</style>

      {/* Screen buttons */}
      <div className="no-print" style={S.btnBar}>
        <button onClick={() => window.print()} style={S.btnPrimary}>Скачать PDF</button>
        <button onClick={() => window.close()} style={S.btnSecondary}>Закрыть</button>
      </div>

      <div style={S.page}>

        {/* ── HEADER BAND ─── */}
        <div style={S.header}>
          <div style={S.headerLeft}>
            <svg width="38" height="38" viewBox="0 0 38 38" fill="none" style={{ flexShrink: 0 }}>
              <rect width="38" height="38" rx="6" fill="rgba(255,255,255,0.15)"/>
              <text x="19" y="25" textAnchor="middle" fill="white" fontSize="13" fontWeight="800" fontFamily="Arial,sans-serif" letterSpacing="0.5">MG</text>
            </svg>
            <div>
              <div style={S.headerBrand}>MGLASS</div>
              <div style={S.headerSub}>Изделия из стекла и зеркал</div>
            </div>
          </div>
          <div style={S.headerRight}>
            <div style={S.headerMeta}><span style={S.metaLabel}>Дата</span><span>{dateStr}</span></div>
            <div style={S.headerMeta}><span style={S.metaLabel}>Номер КП</span><span>#{calc.id}</span></div>
          </div>
        </div>

        {/* ── DOCUMENT TITLE ─── */}
        <div style={S.titleBlock}>
          <h1 style={S.title}>Коммерческое предложение</h1>
        </div>

        {/* ── CLIENT META ─── */}
        <div style={S.clientRow}>
          <div style={S.clientLeft}>
            <span style={S.fieldLabel}>Заказчик</span>
            <span style={S.clientName}>{calc.client_name || '——————————————'}</span>
            {calc.client_phone && <span style={S.clientPhone}>{calc.client_phone}</span>}
          </div>
          <div style={S.clientRight}>
            <div><span style={S.fieldLabel}>Актуально до</span> <strong>{validUntil}</strong></div>
            <div style={{ marginTop: 3 }}><span style={S.fieldLabel}>Подготовил</span> <strong>{calc.creator?.name || 'Менеджер'}</strong></div>
          </div>
        </div>

        {/* ── TABLE ─── */}
        <table style={S.table}>
          <thead>
            <tr>
              <th style={{ ...S.th, width: 32, textAlign: 'center' }}>№</th>
              <th style={{ ...S.th, textAlign: 'left' }}>Наименование</th>
              <th style={{ ...S.th, width: 52, textAlign: 'center' }}>Кол.</th>
              <th style={{ ...S.th, width: 110, textAlign: 'right' }}>Цена</th>
              <th style={{ ...S.th, width: 110, textAlign: 'right', borderRight: 'none' }}>Сумма</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const isFirst = i === 0
              const bg = row.isDiscount ? '#fffbea' : row.isZero ? '#fafafa' : row.isService ? '#f9f9f8' : '#fff'
              return (
                <tr key={i} style={{ background: bg, borderBottom: '1px solid #ebebeb' }}>
                  <td style={{ ...S.td, textAlign: 'center', color: '#aaa', paddingTop: 11, verticalAlign: 'top' }}>
                    {row.id}
                  </td>
                  <td style={{ ...S.td, verticalAlign: 'top', paddingLeft: row.isDiscount ? 20 : row.isService ? 20 : 12 }}>
                    {row.isDiscount ? (
                      <span style={{ fontStyle: 'italic', color: '#92400e', fontSize: 11 }}>
                        🏷 {row.name}
                      </span>
                    ) : row.isService ? (
                      <span style={{ color: row.isZero ? '#bbb' : '#555', fontSize: 11 }}>{row.name}</span>
                    ) : (
                      row.name.split('\n').map((line, j) => (
                        <div key={j} style={{ fontWeight: j === 0 ? 600 : 400, color: j === 0 ? '#111' : '#555', fontSize: j === 0 ? 12 : 11, marginBottom: j === 0 && row.name.includes('\n') ? 2 : 0 }}>
                          {line}
                        </div>
                      ))
                    )}
                  </td>
                  <td style={{ ...S.td, textAlign: 'center', color: row.isZero ? '#ccc' : '#555', verticalAlign: 'top', paddingTop: 11 }}>
                    {row.qty}
                  </td>
                  <td style={{ ...S.td, textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontVariantNumeric: 'tabular-nums', color: row.isDiscount ? '#92400e' : row.isZero ? '#ccc' : '#444', verticalAlign: 'top', paddingTop: 11 }}>
                    {row.isDiscount ? `− ${fmt(Math.abs(row.price))}` : row.isZero ? '—' : fmt(row.price)}
                  </td>
                  <td style={{ ...S.td, textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontVariantNumeric: 'tabular-nums', fontWeight: isFirst ? 700 : row.isZero ? 400 : 500, color: row.isDiscount ? '#92400e' : row.isZero ? '#ccc' : '#111', verticalAlign: 'top', paddingTop: 11, borderRight: 'none' }}>
                    {row.isDiscount ? `− ${fmt(Math.abs(row.total))}` : row.isZero ? '—' : fmt(row.total)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {/* ── SUBTOTAL + TOTAL ─── */}
        <div style={S.totalsBlock}>
          <div style={S.termsText}>
            <div>Срок изготовления — <strong>15 рабочих дней</strong></div>
            <div style={{ color: '#999' }}>*Подъём одного изделия 500 ₽/этаж</div>
          </div>
          <div style={S.totalsRight}>
            <div style={S.subtotalRow}>
              <span style={{ color: '#888' }}>Промежуточный итог</span>
              <span style={{ fontFamily: 'ui-monospace, monospace', fontVariantNumeric: 'tabular-nums' }}>{fmt(grandTotal)}</span>
            </div>
            <div style={S.totalBox}>
              <div style={S.totalLabel}>ИТОГО</div>
              <div style={S.totalPrice}>{fmt(grandTotal)}</div>
            </div>
            <div style={S.vatRow}>
              В т.ч. НДС 5%&ensp;
              <span style={{ fontFamily: 'ui-monospace, monospace' }}>{vatAmount.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽</span>
            </div>
          </div>
        </div>

        {/* ── NOTES ─── */}
        {calc.notes && (
          <div style={S.notes}>{calc.notes}</div>
        )}

        {/* ── FOOTER ─── */}
        <div style={S.footer}>
          <div style={S.footerLeft}>
            <div style={S.footerBrand}>MGlass</div>
            <div><a href="https://mglass.pro/" style={{ color: '#0071e3', textDecoration: 'none' }}>mglass.pro</a></div>
            <div>8 (925) 788 58 37</div>
            <div style={{ color: '#aaa' }}>mglass.ceo@gmail.com</div>
          </div>
          <div style={S.footerRight}>
            <div style={S.footerThanks}>Благодарим за обращение!</div>
            <div style={{ color: '#999', marginTop: 4 }}>Предложение действительно до {validUntil}</div>
          </div>
        </div>

      </div>
    </>
  )
}

// ── Shared styles ──────────────────────────────────────────────────────────────
const S = {
  loader: { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', color: '#9a9a95', fontSize: 14 } as React.CSSProperties,

  btnBar: { position: 'fixed', top: 16, right: 16, display: 'flex', gap: 8, zIndex: 100 } as React.CSSProperties,
  btnPrimary:   { padding: '9px 20px', background: '#111110', color: '#fff', fontSize: 13, fontWeight: 600, borderRadius: 8, border: 'none', cursor: 'pointer' } as React.CSSProperties,
  btnSecondary: { padding: '9px 20px', background: '#fff', color: '#555', fontSize: 13, border: '1px solid #ddd', borderRadius: 8, cursor: 'pointer' } as React.CSSProperties,

  page: { maxWidth: 740, margin: '0 auto', paddingBottom: 20 } as React.CSSProperties,

  header: {
    background: '#111110',
    color: '#fff',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '18px 24px',
    borderRadius: '0 0 0 0',
  } as React.CSSProperties,
  headerLeft: { display: 'flex', alignItems: 'center', gap: 12 } as React.CSSProperties,
  headerBrand: { fontSize: 20, fontWeight: 800, letterSpacing: '0.5px', fontFamily: 'Georgia, serif', lineHeight: 1 } as React.CSSProperties,
  headerSub: { fontSize: 10, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.5px', marginTop: 2 } as React.CSSProperties,
  headerRight: { textAlign: 'right' } as React.CSSProperties,
  headerMeta: { display: 'flex', gap: 10, justifyContent: 'flex-end', fontSize: 11, marginBottom: 3 } as React.CSSProperties,
  metaLabel: { color: 'rgba(255,255,255,0.45)', marginRight: 2 } as React.CSSProperties,

  titleBlock: { textAlign: 'center', padding: '20px 24px 14px' } as React.CSSProperties,
  title: { fontFamily: 'Georgia, serif', fontSize: 20, fontWeight: 700, color: '#111', letterSpacing: '-0.2px' } as React.CSSProperties,

  clientRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '0 24px 18px', borderBottom: '1px solid #e8e8e8', gap: 16 } as React.CSSProperties,
  clientLeft: { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' as const } as React.CSSProperties,
  clientRight: { textAlign: 'right', fontSize: 11, color: '#555', flexShrink: 0 } as React.CSSProperties,
  fieldLabel: { fontSize: 10, color: '#aaa', textTransform: 'uppercase' as const, letterSpacing: '0.5px', marginRight: 4 } as React.CSSProperties,
  clientName: { fontSize: 14, fontWeight: 700, color: '#111' } as React.CSSProperties,
  clientPhone: { fontSize: 12, color: '#666' } as React.CSSProperties,

  table: { width: '100%', borderCollapse: 'collapse' as const, borderTop: '2px solid #111110', marginTop: 18 } as React.CSSProperties,
  th: {
    background: '#111110',
    color: '#fff',
    padding: '9px 12px',
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.4px',
    textTransform: 'uppercase' as const,
    borderRight: '1px solid rgba(255,255,255,0.1)',
  } as React.CSSProperties,
  td: { padding: '9px 12px', fontSize: 12, verticalAlign: 'middle', borderRight: '1px solid #f0f0f0' } as React.CSSProperties,

  totalsBlock: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', padding: '14px 0 0', gap: 20 } as React.CSSProperties,
  termsText: { fontSize: 10, color: '#777', lineHeight: 1.8, paddingLeft: 24 } as React.CSSProperties,
  totalsRight: { minWidth: 260 } as React.CSSProperties,
  subtotalRow: { display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#888', paddingBottom: 8, borderBottom: '1px solid #e0e0e0', marginBottom: 8 } as React.CSSProperties,

  totalBox: {
    background: '#111110',
    color: '#fff',
    borderRadius: 6,
    padding: '10px 16px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  } as React.CSSProperties,
  totalLabel: { fontSize: 12, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase' as const } as React.CSSProperties,
  totalPrice: { fontSize: 20, fontWeight: 800, fontFamily: 'ui-monospace, monospace', fontVariantNumeric: 'tabular-nums' } as React.CSSProperties,

  vatRow: { fontSize: 10, color: '#aaa', textAlign: 'right' as const, fontStyle: 'italic' } as React.CSSProperties,

  notes: { margin: '16px 24px 0', padding: '10px 14px', background: '#f9f9f8', borderLeft: '3px solid #d0d0d0', fontSize: 11, color: '#555', lineHeight: 1.6, borderRadius: '0 4px 4px 0' } as React.CSSProperties,

  footer: {
    marginTop: 28,
    paddingTop: 16,
    borderTop: '1px solid #e0e0e0',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingLeft: 0,
    paddingRight: 0,
  } as React.CSSProperties,
  footerLeft: { fontSize: 10, color: '#888', lineHeight: 1.9 } as React.CSSProperties,
  footerBrand: { fontFamily: 'Georgia, serif', fontWeight: 700, color: '#444', fontSize: 12, marginBottom: 2 } as React.CSSProperties,
  footerRight: { textAlign: 'right' } as React.CSSProperties,
  footerThanks: { fontFamily: 'Georgia, serif', fontSize: 15, fontWeight: 700, color: '#111' } as React.CSSProperties,
}
