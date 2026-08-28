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

function fmt(n: number) { return n.toLocaleString('ru-RU') + ' ₽' }

function addDays(date: Date, days: number) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long', year: 'numeric' })
}

// Extracts client-visible LED specs: color temp (K), wattage (W/m), LED count
function cleanLedLine(raw: string): string {
  if (!raw) return ''
  const parts: string[] = []

  // Color temperature: 3000K, 4500K/6000K, 3000K/4000K/6000K
  const kMatch = raw.match(/(\d{4}K(?:[/|]\d{4}K)*)/)
  if (kMatch) parts.push(kMatch[1].replace(/[/|]/g, ' / '))

  // Wattage per meter: 9.6W/m, 9,6W/M, 12 W/m, 9.6W/м (latin and cyrillic)
  const wMatch = raw.match(/(\d+[,.]?\d*)\s*W\s*\/?\s*[mMмМ]/i)
  if (wMatch) parts.push(`${wMatch[1].replace(',', '.')} Вт/м`)

  // LED count: 120 led, 60LED, 240LED
  const ledMatch = raw.match(/(\d{2,3})\s*[Ll][Ee][Dd]/)
  if (ledMatch) parts.push(`${ledMatch[1]} LED/м`)

  return parts.join(', ')
}

function parseClientTextSections(clientText: string | null): Record<string, string[]> {
  if (!clientText) return {}
  const STOP = /^(Стоимость изделия|Итого с услугами):/
  const lines = clientText.split('\n')
  const sections: Record<string, string[]> = {}
  let current = ''
  for (const line of lines) {
    const t = line.trim()
    if (STOP.test(t)) break
    const m = t.match(/^(.+):$/)
    if (m && t.length < 60) { current = m[1].trim(); sections[current] = []; continue }
    if (current && t) sections[current].push(t)
  }
  return sections
}

type KomponentItem = { label: string; value?: string }

function getKomplektaciya(calc: Calc): KomponentItem[] {
  const d = calc.input_data
  const sec = parseClientTextSections(calc.client_text)
  const items: KomponentItem[] = []

  if (calc.product_type === 'mirror') {
    const rawName = (d.mirrorName as string || '').trim()
    const glassName = rawName.replace(/^зеркало\s*/i, '').trim() || 'Зеркало'
    const thick = d.mirrorMm ? `${d.mirrorMm} мм` : d.thickness ? `${d.thickness} мм` : ''
    const shapeMap: Record<string, string> = { circle: `Ø${d.width} мм, круглое`, oval: `${d.width}×${d.height} мм, овальное`, complex: `${d.width}×${d.height} мм, сложная форма` }
    const dims = shapeMap[d.shape as string] ?? `${d.width}×${d.height} мм`
    items.push({ label: [glassName, thick].filter(Boolean).join(' '), value: dims })

    if (sec['Каркас']?.length && d.shape !== 'complex') {
      items.push({ label: 'Каркас', value: sec['Каркас'].join(' · ') })
    }
    if (d.hasSubstrate) {
      items.push({ label: 'Подложка' })
    }

    if (d.hasLighting) {
      const ledLines = sec['Подсветка'] ?? []
      if (ledLines.length) {
        const techSpec = cleanLedLine(ledLines[0])
        // Second line is usually a descriptive phrase ("мягкое свечение по периметру")
        const desc = ledLines.slice(1).filter(Boolean).join(', ')
        const value = [desc, techSpec ? `LED ${techSpec}` : ''].filter(Boolean).join(' · ')
        items.push({ label: 'Подсветка', value: value || 'LED подсветка' })
      } else {
        items.push({ label: 'LED подсветка' })
      }
    }

    if (d.buttonType === 'sensor') items.push({ label: 'Сенсорная кнопка' })
    if (d.hasFacet && d.facetTypeMm) items.push({ label: 'Фацет', value: `${d.facetTypeMm} мм` })
  }

  if (calc.product_type === 'loft') {
    const sysMap: Record<string, string> = { sliding: 'Раздвижная', swing: 'Распашная', fixed: 'Стационарная' }
    const sys = sysMap[d.systemType as string] || 'Конструкция'
    const dims = `${d.width}×${d.height} мм${d.sections ? `, ${d.sections} секц.` : ''}`
    items.push({ label: sys + ' конструкция', value: dims })

    const rawGlass = (d.glassName as string || '').trim()
    const thick = d.glassThickness ? `${d.glassThickness} мм` : d.thickness ? `${d.thickness} мм` : ''
    if (rawGlass || thick) items.push({ label: 'Стекло', value: [rawGlass, thick].filter(Boolean).join(' ') })

    if (sec['Каркас']?.length) items.push({ label: 'Каркас', value: sec['Каркас'].join(' · ') })
    if (d.isTempered) items.push({ label: 'Закалка стекла' })
  }

  if (calc.product_type.startsWith('shower')) {
    const dims = (d.dimStr as string) || `${d.width}×${d.height} мм`
    const model = (d.model as string || 'Душевая перегородка').trim()
    items.push({ label: model, value: dims })

    const glass = (d.glassType as string || '').trim()
    const thick = d.thickness ? `${d.thickness} мм` : '8 мм'
    items.push({ label: 'Стекло', value: [thick, glass].filter(Boolean).join(', ') })
    if (d.isTempered) items.push({ label: 'Закалка стекла' })

    const colorLabel: Record<string, string> = { chrome: 'Хром', black: 'Чёрный', bronze: 'Бронза', gold: 'Золото', white: 'Белый' }
    const color = colorLabel[d.hwColor as string] || ''
    if (color) items.push({ label: 'Фурнитура', value: color })
  }

  if (calc.product_type === 'railing') {
    const fixingLabel: Record<string, string> = { points: 'на точках', posts: 'на стойках', profile: 'на зажимном профиле' }
    const spans = (d.segCount as number) ?? (Array.isArray(d.segments) ? (d.segments as unknown[]).length : 0)
    items.push({ label: 'Стеклянное ограждение', value: `${spans} ${spans === 1 ? 'пролёт' : 'пролётов'}${d.alongSlopeTotalM ? `, ${d.alongSlopeTotalM} пог.м` : ''}` })
    const glass = (d.glass as string || '').trim()
    const thick = d.thickness ? `${d.thickness} мм` : ''
    if (glass || thick) items.push({ label: 'Стекло', value: [thick, glass].filter(Boolean).join(', ') })
    if (d.fixing) items.push({ label: 'Крепление', value: fixingLabel[d.fixing as string] ?? '' })
    if (d.heightMm) items.push({ label: 'Высота', value: `${d.heightMm} мм` })
    // Кол-во крепежа (точек/стоек/профиля) клиенту НЕ показываем — только менеджеру.
  }

  return items.filter(it => it.label || it.value)
}

function getProductTitle(calc: Calc): string {
  const d = calc.input_data
  if (calc.product_type === 'mirror') {
    const dims = d.shape === 'circle' ? `Ø${d.width} мм` : `${d.width}×${d.height} мм`
    return d.hasLighting ? `Зеркало с подсветкой · ${dims}` : `Зеркало · ${dims}`
  }
  if (calc.product_type === 'loft') {
    const sysMap: Record<string, string> = { sliding: 'раздвижная', swing: 'распашная', fixed: 'стационарная' }
    const sys = sysMap[d.systemType as string] || ''
    return `Лофт-перегородка${sys ? ' (' + sys + ')' : ''} · ${d.width}×${d.height} мм`
  }
  if (calc.product_type.startsWith('shower')) {
    const dims = (d.dimStr as string) || `${d.width}×${d.height} мм`
    return `Душевая перегородка · ${dims}`
  }
  if (calc.product_type === 'railing') {
    const spans = (d.segCount as number) ?? (Array.isArray(d.segments) ? (d.segments as unknown[]).length : 0)
    return `Стеклянное ограждение${spans ? ` · ${spans} ${spans === 1 ? 'пролёт' : 'пролётов'}` : ''}`
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
      const { data } = await supabase
        .from('calculations')
        .select('*, creator:users!created_by(name)')
        .eq('id', id)
        .single()
      if (!data) { setLoading(false); return }

      // Fallback: if join returned no name (RLS), fetch separately
      let creatorName = (data.creator as { name?: string } | null)?.name ?? null
      if (!creatorName && (data as Record<string, unknown>).created_by) {
        const { data: u } = await supabase
          .from('users')
          .select('name')
          .eq('id', (data as Record<string, unknown>).created_by as string)
          .maybeSingle()
        creatorName = (u as { name?: string } | null)?.name ?? null
      }

      setCalc({ ...data, creator: creatorName ? { name: creatorName } : null })
      setLoading(false)
    }
    load()
  }, [id])

  useEffect(() => {
    if (!loading && calc) setTimeout(() => window.print(), 400)
  }, [loading, calc])

  if (loading) return <div style={S.loader}>Подготовка документа...</div>
  if (!calc)   return <div style={S.loader}>Расчёт не найден</div>

  const createdAt     = new Date(calc.created_at)
  const dateStr       = createdAt.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric' })
  const validUntil    = addDays(createdAt, 7)
  const serviceLines  = calc.financial_breakdown?.serviceLines ?? []
  const servicesTotal = calc.financial_breakdown?.servicesTotal ?? 0
  const productPrice  = calc.final_price - servicesTotal
  const grandTotal    = calc.final_price
  const vatAmount     = Math.round(grandTotal / 1.05 * 0.05 * 100) / 100
  const originalPrice = calc.discount > 0 ? Math.round(productPrice / (1 - calc.discount / 100)) : productPrice
  const discountAmt   = originalPrice - productPrice
  const title         = getProductTitle(calc)
  const komplekt      = getKomplektaciya(calc)

  type Row = { id: number|''; name: string; qty: number|string; price: number; total: number; isService?: boolean; isDiscount?: boolean; isZero?: boolean }
  const rows: Row[] = [{ id: 1, name: title, qty: 1, price: originalPrice, total: productPrice }]

  if (calc.discount > 0 && discountAmt > 0) {
    rows.push({ id: '', name: `Скидка ${calc.discount}%`, qty: 1, price: -discountAmt, total: -discountAmt, isDiscount: true })
  }

  let ri = 2
  let hasLifting = false
  for (const line of serviceLines) {
    if (line.name === 'Подъём на этаж') {
      hasLifting = true
      rows.push({ id: ri++, name: 'Подъём на этаж', qty: line.qty ?? 1, price: line.price ?? 500, total: line.total, isService: true })
    } else {
      const unitStr = line.qty && line.unit ? ` ${line.qty} ${line.unit}` : ''
      rows.push({ id: ri++, name: line.name + unitStr, qty: 1, price: line.price ?? line.total, total: line.total, isService: true })
    }
  }
  if (!hasLifting) {
    rows.push({ id: ri++, name: 'Подъём на этаж*', qty: 0, price: 500, total: 0, isService: true, isZero: true })
  }

  return (
    <>
      <style>{`
        @page { margin: 12mm 14mm; size: A4 portrait; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; background: #fff; color: #1a1a1a; font-size: 12px; line-height: 1.5; }
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="no-print" style={S.btnBar}>
        <button onClick={() => window.print()} style={S.btnPrimary}>Скачать PDF</button>
        <button onClick={() => window.close()} style={S.btnSecondary}>Закрыть</button>
      </div>

      <div style={S.page}>

        {/* ── ШАПКА ── */}
        <div style={S.header}>
          <div style={S.headerLeft}>
            <svg width="42" height="42" viewBox="0 0 42 42" fill="none">
              <rect width="42" height="42" rx="8" fill="rgba(255,255,255,0.12)"/>
              <text x="21" y="28" textAnchor="middle" fill="white" fontSize="15" fontWeight="800" fontFamily="Georgia,serif" letterSpacing="0.5">MG</text>
            </svg>
            <div>
              <div style={S.headerBrand}>MGLASS</div>
              <div style={S.headerSub}>Изделия из стекла и зеркал</div>
            </div>
          </div>
          <div style={S.headerContacts}>
            <div style={{ fontWeight: 600 }}>8 (925) 788 58 37</div>
            <div><a href="https://mglass.pro/" style={{ color: 'rgba(255,255,255,0.7)', textDecoration: 'none' }}>mglass.pro</a></div>
            <div style={{ color: 'rgba(255,255,255,0.45)' }}>mglass.ceo@gmail.com</div>
          </div>
        </div>

        {/* ── МЕТА ПОЛОСКА ── */}
        <div style={S.metaBar}>
          <div style={S.metaItem}>
            <span style={S.metaKey}>КП №</span>
            <span style={S.metaVal}>{calc.id}</span>
          </div>
          <div style={S.metaDivider}/>
          <div style={S.metaItem}>
            <span style={S.metaKey}>Дата</span>
            <span style={S.metaVal}>{dateStr}</span>
          </div>
          <div style={S.metaDivider}/>
          <div style={S.metaItem}>
            <span style={S.metaKey}>Действует до</span>
            <span style={S.metaVal}>{validUntil}</span>
          </div>
          <div style={S.metaDivider}/>
          <div style={S.metaItem}>
            <span style={S.metaKey}>Менеджер</span>
            <span style={S.metaVal}>{calc.creator?.name || 'Менеджер'}</span>
          </div>
        </div>

        {/* ── ЗАГОЛОВОК + КЛИЕНТ ── */}
        <div style={S.titleRow}>
          <div>
            <h1 style={S.kpTitle}>Коммерческое предложение</h1>
          </div>
          <div style={S.clientBox}>
            <div style={S.microLabel}>Заказчик</div>
            <div style={S.clientName}>{calc.client_name || '—'}</div>
            {calc.client_phone && <div style={S.clientPhone}>{calc.client_phone}</div>}
          </div>
        </div>

        {/* ── КАРТОЧКА ИЗДЕЛИЯ ── */}
        <div style={S.productCard}>
          <div style={S.productCardTop}>
            <div style={S.microLabel}>Изделие</div>
            <div style={S.productTitle}>{title}</div>
          </div>

          {komplekt.length > 0 && (
            <div style={S.komplektBlock}>
              <div style={S.komplektHeader}>Комплектация</div>
              <div style={S.komplektGrid}>
                {komplekt.map((item, i) => (
                  <div key={i} style={S.komplektRow}>
                    {item.label
                      ? <span style={S.kLabel}>{item.label}</span>
                      : <span style={S.kLabel}/>}
                    {item.value && <span style={S.kValue}>{item.value}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── ТАБЛИЦА СТОИМОСТИ ── */}
        <div style={S.tableSection}>
          <div style={S.tableSectionLabel}>Состав и стоимость</div>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={{ ...S.th, width: 28, textAlign: 'center' }}>№</th>
                <th style={{ ...S.th, textAlign: 'left' }}>Наименование</th>
                <th style={{ ...S.th, width: 40, textAlign: 'center' }}>Кол.</th>
                <th style={{ ...S.th, width: 112, textAlign: 'right' }}>Цена</th>
                <th style={{ ...S.th, width: 112, textAlign: 'right', borderRight: 'none' }}>Сумма</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const isFirst = i === 0
                const bg = row.isDiscount ? '#fffbea' : row.isZero ? '#fafafa' : row.isService ? '#f8f7f5' : '#fff'
                return (
                  <tr key={i} style={{ background: bg, borderBottom: '1px solid #ebebeb' }}>
                    <td style={{ ...S.td, textAlign: 'center', color: '#ccc', paddingTop: 10, verticalAlign: 'top', fontSize: 10 }}>
                      {row.id}
                    </td>
                    <td style={{ ...S.td, verticalAlign: 'top', paddingLeft: row.isService || row.isDiscount ? 18 : 10 }}>
                      {row.isDiscount
                        ? <span style={{ fontStyle: 'italic', color: '#92400e', fontSize: 11 }}>🏷 {row.name}</span>
                        : row.isService
                          ? <span style={{ color: row.isZero ? '#c8c8c8' : '#555', fontSize: 11 }}>{row.name}</span>
                          : <span style={{ fontWeight: 600, color: '#111', fontSize: 12 }}>{row.name}</span>
                      }
                    </td>
                    <td style={{ ...S.td, textAlign: 'center', color: row.isZero ? '#ddd' : '#777', verticalAlign: 'top', paddingTop: 10, fontSize: 11 }}>
                      {row.qty}
                    </td>
                    <td style={{ ...S.td, textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontVariantNumeric: 'tabular-nums', color: row.isDiscount ? '#92400e' : row.isZero ? '#ddd' : '#555', verticalAlign: 'top', paddingTop: 10, fontSize: 11 }}>
                      {row.isDiscount ? `− ${fmt(Math.abs(row.price))}` : row.isZero ? '—' : fmt(row.price)}
                    </td>
                    <td style={{ ...S.td, textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontVariantNumeric: 'tabular-nums', fontWeight: isFirst ? 700 : row.isZero ? 400 : 500, color: row.isDiscount ? '#92400e' : row.isZero ? '#ddd' : '#111', verticalAlign: 'top', paddingTop: 10, borderRight: 'none', fontSize: isFirst ? 12 : 11 }}>
                      {row.isDiscount ? `− ${fmt(Math.abs(row.total))}` : row.isZero ? '—' : fmt(row.total)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* ── ИТОГО + УСЛОВИЯ ── */}
        <div style={S.totalsWrap}>
          <div style={S.conditionsBlock}>
            <div style={S.condLine}><strong>Срок изготовления:</strong> 15 рабочих дней</div>
            <div style={S.condLine}>Оплата: 100% предоплата</div>
            <div style={{ ...S.condLine, color: '#bbb', marginTop: 5 }}>* Подъём одного изделия — 500 ₽/этаж</div>
          </div>
          <div style={S.totalsBox}>
            <div style={S.subtotalLine}>
              <span>Сумма</span>
              <span style={{ fontFamily: 'ui-monospace, monospace', fontVariantNumeric: 'tabular-nums' }}>{fmt(grandTotal)}</span>
            </div>
            <div style={S.totalBand}>
              <span style={S.totalBandLabel}>ИТОГО</span>
              <span style={S.totalBandPrice}>{fmt(grandTotal)}</span>
            </div>
            <div style={S.vatLine}>
              В т.ч. НДС 5%&ensp;
              <span style={{ fontFamily: 'ui-monospace, monospace' }}>
                {vatAmount.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽
              </span>
            </div>
          </div>
        </div>

        {/* ── ПРИМЕЧАНИЯ ── */}
        {calc.notes && (
          <div style={S.notesBlock}>
            <div style={S.microLabel}>Примечания</div>
            <div style={S.notesText}>{calc.notes}</div>
          </div>
        )}

        {/* ── ФУТЕР ── */}
        <div style={S.footer}>
          <div>
            <div style={S.footerBrand}>MGlass</div>
            <div style={S.footerContacts}>
              <span>8 (925) 788 58 37</span>
              <span style={S.dot}>·</span>
              <a href="https://mglass.pro/" style={{ color: '#0071e3', textDecoration: 'none' }}>mglass.pro</a>
              <span style={S.dot}>·</span>
              <span>mglass.ceo@gmail.com</span>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={S.footerThanks}>Благодарим за обращение!</div>
            <div style={{ fontSize: 10, color: '#bbb', marginTop: 3 }}>
              Предложение действительно до {validUntil}
            </div>
          </div>
        </div>

      </div>
    </>
  )
}

const S: Record<string, React.CSSProperties> = {
  loader: { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', color: '#9a9a95', fontSize: 14 },

  btnBar:       { position: 'fixed', top: 16, right: 16, display: 'flex', gap: 8, zIndex: 100 },
  btnPrimary:   { padding: '9px 20px', background: '#111110', color: '#fff', fontSize: 13, fontWeight: 600, borderRadius: 8, border: 'none', cursor: 'pointer' },
  btnSecondary: { padding: '9px 20px', background: '#fff', color: '#555', fontSize: 13, border: '1px solid #ddd', borderRadius: 8, cursor: 'pointer' },

  page: { maxWidth: 740, margin: '0 auto', paddingBottom: 28 },

  // Header
  header:        { background: '#111110', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 26px' },
  headerLeft:    { display: 'flex', alignItems: 'center', gap: 14 },
  headerBrand:   { fontSize: 22, fontWeight: 800, letterSpacing: '0.5px', fontFamily: 'Georgia, serif', lineHeight: 1 },
  headerSub:     { fontSize: 10, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.5px', marginTop: 4 },
  headerContacts:{ textAlign: 'right', fontSize: 11, color: 'rgba(255,255,255,0.7)', lineHeight: 1.85 },

  // Meta bar
  metaBar:     { background: '#f4f3f1', display: 'flex', alignItems: 'center', padding: '10px 26px', borderBottom: '1px solid #e4e3e0', flexWrap: 'wrap', gap: 0 },
  metaItem:    { display: 'flex', flexDirection: 'column', paddingRight: 20 },
  metaDivider: { width: 1, height: 26, background: '#dddcda', marginRight: 20, flexShrink: 0 },
  metaKey:     { fontSize: 9, color: '#b0b0ac', textTransform: 'uppercase', letterSpacing: '0.6px' },
  metaVal:     { fontSize: 12, fontWeight: 600, color: '#111', marginTop: 2 },

  // Title + client
  titleRow:   { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', padding: '18px 26px 16px', borderBottom: '1px solid #e8e7e4' },
  kpTitle:    { fontFamily: 'Georgia, serif', fontSize: 19, fontWeight: 700, color: '#111', letterSpacing: '-0.2px' },
  clientBox:  { textAlign: 'right', flexShrink: 0 },
  microLabel: { fontSize: 9, color: '#b0b0ac', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 3 },
  clientName: { fontSize: 14, fontWeight: 700, color: '#111' },
  clientPhone:{ fontSize: 12, color: '#666', marginTop: 2 },

  // Product card
  productCard:    { background: '#f9f8f6', border: '1px solid #e6e5e2', borderRadius: 8, margin: '16px 0', overflow: 'hidden' },
  productCardTop: { padding: '14px 18px 12px' },
  productTitle:   { fontSize: 15, fontWeight: 700, color: '#111', marginTop: 4 },

  komplektBlock:  { borderTop: '1px solid #e6e5e2', padding: '12px 18px 14px', background: '#fff' },
  komplektHeader: { fontSize: 9, color: '#b0b0ac', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 8 },
  komplektGrid:   { display: 'flex', flexDirection: 'column', gap: 5 },
  komplektRow:    { display: 'flex', alignItems: 'baseline', gap: 10 },
  kLabel:         { fontSize: 11, fontWeight: 600, color: '#333', minWidth: 130, flexShrink: 0 },
  kValue:         { fontSize: 11, color: '#666' },

  // Table section
  tableSection:      { marginTop: 16 },
  tableSectionLabel: { fontSize: 9, fontWeight: 700, color: '#b0b0ac', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8 },
  table:    { width: '100%', borderCollapse: 'collapse', borderTop: '2px solid #111110' },
  th:       { background: '#111110', color: '#fff', padding: '8px 10px', fontSize: 9, fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase', borderRight: '1px solid rgba(255,255,255,0.1)' },
  td:       { padding: '8px 10px', fontSize: 12, verticalAlign: 'middle', borderRight: '1px solid #f0f0f0' },

  // Totals
  totalsWrap:     { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', padding: '16px 0 0', gap: 24 },
  conditionsBlock:{ fontSize: 11, lineHeight: 2, color: '#666' },
  condLine:       { color: '#555' },
  totalsBox:      { minWidth: 264 },
  subtotalLine:   { display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#999', paddingBottom: 8, borderBottom: '1px solid #e4e4e0', marginBottom: 8 },
  totalBand:      { background: '#111110', color: '#fff', borderRadius: 7, padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  totalBandLabel: { fontSize: 11, fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase' },
  totalBandPrice: { fontSize: 22, fontWeight: 800, fontFamily: 'ui-monospace, monospace', fontVariantNumeric: 'tabular-nums' },
  vatLine:        { fontSize: 10, color: '#bbb', textAlign: 'right', fontStyle: 'italic' },

  // Notes
  notesBlock: { margin: '18px 0 0', padding: '12px 14px', background: '#f9f8f6', borderLeft: '3px solid #d5d4d0', borderRadius: '0 4px 4px 0' },
  notesText:  { fontSize: 11, color: '#555', lineHeight: 1.65, marginTop: 4 },

  // Footer
  footer:        { marginTop: 28, paddingTop: 16, borderTop: '1px solid #e0e0dc', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
  footerBrand:   { fontFamily: 'Georgia, serif', fontWeight: 700, color: '#444', fontSize: 13, marginBottom: 4 },
  footerContacts:{ fontSize: 10, color: '#888', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' },
  dot:           { color: '#d0d0d0' },
  footerThanks:  { fontFamily: 'Georgia, serif', fontSize: 14, fontWeight: 700, color: '#111' },
}
