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
    priceWithPartner?: number
  }
  base_price: number
  discount: number
  final_price: number
  client_text: string | null
  notes: string | null
  client_name?: string | null
  client_phone?: string | null
  order_group_id: string | null
  creator?: { name: string } | null
}

function fmt(n: number) { return n.toLocaleString('ru-RU') + ' ₽' }

function addDays(date: Date, days: number) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

function getProductDescription(calc: Calc): string {
  const d = calc.input_data

  if (calc.product_type === 'mirror') {
    const shapeLabel: Record<string, string> = { circle: 'круглое', oval: 'овальное', arch: 'арочное', complex: 'сложная форма' }
    const shape = shapeLabel[d.shape as string] ?? 'прямоугольное'
    const dims  = d.shape === 'circle' ? `Ø${d.width} мм` : `${d.width}×${d.height} мм`
    const lines = [`Зеркало ${shape}, ${dims}`]
    const extras: string[] = []
    if (d.mirrorName) extras.push(`${d.mirrorName}${d.mirrorMm ? ` ${d.mirrorMm} мм` : ''}`)
    if (d.hasFacet && d.facetTypeMm) extras.push(`фацет ${d.facetTypeMm} мм`)
    if (d.hasLighting) extras.push('подсветка')
    if (d.hasSandblast) extras.push('пескоструй')
    if (d.hasSubstrate) extras.push('подложка')
    if (extras.length) lines.push(extras.join(' · '))
    return lines.join('\n')
  }

  if (calc.product_type === 'loft') {
    const systemNames: Record<string, string> = { fixed: 'стационарная', sliding: 'раздвижная', swing: 'распашная' }
    const system = systemNames[d.systemType as string] ?? ''
    const extras: string[] = []
    if (d.glassName) extras.push(d.glassName as string)
    if (d.withTempering) extras.push('закалка')
    if (d.withPainting) extras.push('окраска')
    const line2 = [system, ...extras].filter(Boolean).join(', ')
    return [`Лофт-перегородка ${d.width}×${d.height} мм`, line2].filter(Boolean).join('\n')
  }

  if (calc.product_type.startsWith('shower')) {
    const dims  = (d.dimStr as string) || `${d.width}×${d.height} мм`
    const glass = d.glassType as string || ''
    const thick = d.thickness ? `${d.thickness} мм` : '8 мм'
    const colorLabel: Record<string, string> = { chrome: 'Хром', black: 'Чёрный', bronze: 'Бронза', gold: 'Золото', white: 'Белый' }
    const color = colorLabel[d.hwColor as string] || ''
    return [`Душевая перегородка ${dims}`, glass && `стекло ${thick} ${glass}`, color && `фурнитура ${color}`].filter(Boolean).join('\n')
  }

  if (calc.product_type === 'railing') {
    const fixingLabel: Record<string, string> = { points: 'на точках', posts: 'на стойках', profile: 'на профиле' }
    const fixing = fixingLabel[d.fixing as string] ?? ''
    const glass  = (d.glass as string) || ''
    const thick  = d.thickness ? `${d.thickness} мм` : ''
    const spans  = (d.segCount as number) ?? (Array.isArray(d.segments) ? (d.segments as unknown[]).length : 0)
    const pog    = d.alongSlopeTotalM ? `${d.alongSlopeTotalM} пог.м` : ''
    const head   = `Стеклянное ограждение${spans ? `, ${spans} ${spans === 1 ? 'пролёт' : 'пролётов'}` : ''}${pog ? `, ${pog}` : ''}`
    const line2  = [glass && `стекло ${thick} ${glass}`.trim(), fixing, d.heightMm && `высота ${d.heightMm} мм`].filter(Boolean).join(', ')
    return [head, line2].filter(Boolean).join('\n')
  }

  return 'Изделие из стекла'
}


export default function GroupPrintPage() {
  const { groupId } = useParams<{ groupId: string }>()
  const [calcs, setCalcs]     = useState<Calc[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data } = await supabase
        .from('calculations')
        .select('*, creator:users!created_by(name)')
        .eq('order_group_id', groupId)
        .order('id', { ascending: true })
      if (data) setCalcs(data as Calc[])
      setLoading(false)
    }
    load()
  }, [groupId])

  useEffect(() => {
    if (!loading && calcs.length > 0) {
      setTimeout(() => window.print(), 400)
    }
  }, [loading, calcs])

  if (loading) return <div style={S.loader}>Подготовка документа...</div>
  if (calcs.length === 0) return <div style={S.loader}>Заказ не найден</div>

  const first      = calcs[0]
  const createdAt  = new Date(first.created_at)
  const dateStr    = createdAt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const validUntil = addDays(createdAt, 7)
  const groupNum   = first.id

  type Row = {
    id: number | ''
    name: string
    qty: number
    price: number
    total: number
    isService?: boolean
    isFirst?: boolean
  }

  // Layout: product row → service rows (монтаж etc.) below each item.
  // Delivery ("Доставка") is shown ONCE per order — not per item.
  // productPrice = final_price - servicesTotal (matches calculator)
  // grandTotal = Σ(final_price) - (duplicated deliveries removed)
  const rows: Row[] = []
  let itemIdx = 0
  // Unique delivery types across all items — shown once after all items
  const shownDeliveries = new Map<string, { qty: number; price: number; total: number }>()

  for (const calc of calcs) {
    itemIdx++
    const svcLines      = ((calc.financial_breakdown?.serviceLines ?? []) as ServiceLine[]).filter(s => s.total > 0)
    const servicesTotal = svcLines.reduce((s, l) => s + l.total, 0)
    const productPrice  = calc.final_price - servicesTotal
    const discountNote  = calc.discount > 0 ? ` (скидка ${calc.discount}%)` : ''

    rows.push({
      id:      itemIdx,
      name:    getProductDescription(calc) + discountNote,
      qty:     1,
      price:   productPrice,
      total:   productPrice,
      isFirst: itemIdx === 1,
    })

    for (const svc of svcLines) {
      if (svc.name.toLowerCase().includes('доставка')) {
        // Collect delivery — deduplicate by name, show once after all items
        if (!shownDeliveries.has(svc.name)) {
          shownDeliveries.set(svc.name, { qty: svc.qty ?? 1, price: svc.price ?? svc.total, total: svc.total })
        }
      } else {
        rows.push({
          id:        '',
          name:      svc.name,
          qty:       svc.qty ?? 1,
          price:     svc.price ?? svc.total,
          total:     svc.total,
          isService: true,
        })
      }
    }
  }

  // Add each unique delivery type once at the end
  for (const [name, d] of shownDeliveries) {
    rows.push({ id: '', name, qty: d.qty, price: d.price, total: d.total, isService: true })
  }

  // grandTotal: Σ(productPrice) + Σ(non-delivery services) + ONE delivery per type ✓
  const grandTotal = rows.reduce((s, r) => s + r.total, 0)
  const vatAmount   = Math.round(grandTotal / 1.05 * 0.05 * 100) / 100
  const clientName  = first.client_name
  const clientPhone = first.client_phone

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

        {/* ── HEADER BAND ── */}
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
            <div style={S.headerMeta}><span style={S.metaLabel}>Заказ</span><span>#{groupNum}</span></div>
            <div style={S.headerMeta}><span style={S.metaLabel}>Позиций</span><span>{calcs.length}</span></div>
          </div>
        </div>

        {/* ── DOCUMENT TITLE ── */}
        <div style={S.titleBlock}>
          <h1 style={S.title}>Коммерческое предложение</h1>
        </div>

        {/* ── CLIENT META ── */}
        <div style={S.clientRow}>
          <div style={S.clientLeft}>
            <span style={S.fieldLabel}>Заказчик</span>
            <span style={S.clientName}>{clientName || '——————————————'}</span>
            {clientPhone && <span style={S.clientPhone}>{clientPhone}</span>}
          </div>
          <div style={S.clientRight}>
            <div><span style={S.fieldLabel}>Актуально до</span> <strong>{validUntil}</strong></div>
            <div style={{ marginTop: 3 }}><span style={S.fieldLabel}>Подготовил</span> <strong>{first.creator?.name || 'Менеджер'}</strong></div>
          </div>
        </div>

        {/* ── TABLE ── */}
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
              const bg = row.isService ? '#f9f9f8' : '#fff'
              return (
                <tr key={i} style={{ background: bg, borderBottom: '1px solid #ebebeb' }}>
                  <td style={{ ...S.td, textAlign: 'center', color: '#aaa', paddingTop: row.isService ? 8 : 11, verticalAlign: 'top' }}>
                    {row.id}
                  </td>
                  <td style={{ ...S.td, verticalAlign: 'top', paddingLeft: row.isService ? 24 : 12 }}>
                    {row.isService ? (
                      <span style={{ color: '#555', fontSize: 11 }}>{row.name}</span>
                    ) : (
                      row.name.split('\n').map((line, j) => (
                        <div key={j} style={{ fontWeight: j === 0 ? 600 : 400, color: j === 0 ? '#111' : '#555', fontSize: j === 0 ? 12 : 11, marginBottom: j === 0 && row.name.includes('\n') ? 2 : 0 }}>
                          {line}
                        </div>
                      ))
                    )}
                  </td>
                  <td style={{ ...S.td, textAlign: 'center', color: '#555', verticalAlign: 'top', paddingTop: row.isService ? 8 : 11, fontSize: row.isService ? 11 : 12 }}>
                    {row.qty}
                  </td>
                  <td style={{ ...S.td, textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontVariantNumeric: 'tabular-nums', color: '#444', verticalAlign: 'top', paddingTop: row.isService ? 8 : 11, fontSize: row.isService ? 11 : 12 }}>
                    {fmt(row.price)}
                  </td>
                  <td style={{ ...S.td, textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontVariantNumeric: 'tabular-nums', fontWeight: row.isFirst ? 700 : 500, color: '#111', verticalAlign: 'top', paddingTop: row.isService ? 8 : 11, fontSize: row.isService ? 11 : 12, borderRight: 'none' }}>
                    {fmt(row.total)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {/* ── SUBTOTAL + TOTAL ── */}
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

        {/* ── FOOTER ── */}
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

  footer: {
    marginTop: 28,
    paddingTop: 16,
    borderTop: '1px solid #e0e0e0',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  } as React.CSSProperties,
  footerLeft: { fontSize: 10, color: '#888', lineHeight: 1.9 } as React.CSSProperties,
  footerBrand: { fontFamily: 'Georgia, serif', fontWeight: 700, color: '#444', fontSize: 12, marginBottom: 2 } as React.CSSProperties,
  footerRight: { textAlign: 'right' } as React.CSSProperties,
  footerThanks: { fontFamily: 'Georgia, serif', fontSize: 15, fontWeight: 700, color: '#111' } as React.CSSProperties,
}
