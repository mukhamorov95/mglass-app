import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { getRole } from '@/lib/getRole'
import { notFound } from 'next/navigation'
import type { Order, OrderLine } from '@/lib/types'

function fmt(n: number) { return n.toLocaleString('ru-RU') + ' ₽' }
function qty(n: number, u: string) { return `${n} ${u}` }

const PRODUCT_LABELS: Record<string, string> = {
  mirror:          'Зеркало с подсветкой',
  loft:            'Лофт-перегородка',
  shower_budget:   'Душевая бюджет',
  shower_standard: 'Душевая стандарт',
  b2b:             'Стеклоизделие',
  service:         'Услуга',
  custom:          'Прочее',
}

export default async function SpecPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const role   = await getRole()

  const client = role === 'admin'
    ? createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    : await createServerClient()

  const [{ data: order }, { data: lines }] = await Promise.all([
    client.from('orders').select('*').eq('id', id).single(),
    client.from('order_lines').select('*').eq('order_id', id).order('position_num'),
  ])

  if (!order) notFound()

  const o = order as Order
  const l = (lines ?? []) as OrderLine[]

  // Aggregate all BOM items across lines
  const matMap = new Map<string, { name: string; qty: number; unit: string; cost: number; total: number }>()

  for (const line of l) {
    const allItems = [
      ...(line.materials_bom ?? []),
      ...(line.hardware_bom  ?? []),
      ...(line.services_bom  ?? []),
    ]
    for (const item of allItems) {
      const key      = item.name.toLowerCase()
      const existing = matMap.get(key)
      if (existing) {
        existing.qty   += item.qty
        existing.total += item.total
      } else {
        matMap.set(key, { name: item.name, qty: item.qty, unit: item.unit ?? 'шт', cost: item.unit_cost ?? 0, total: item.total })
      }
    }
  }

  const bomItems = Array.from(matMap.values()).sort((a, b) => a.name.localeCompare(b.name, 'ru'))

  const date = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <>
      <style>{`
        @page { margin: 18mm 14mm; size: A4; }
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-print { display: none !important; }
        }
        * { box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, sans-serif; background: #fff; }
      `}</style>

      <div className="no-print fixed top-4 right-4 flex gap-2 z-50">
        <button onClick={() => window.print()}
          className="px-4 py-2 bg-[#111110] text-white text-sm font-semibold rounded-lg shadow-lg hover:bg-[#2a2a28]">
          Печать / PDF
        </button>
        <a href={`/orders/${id}`}
          className="px-4 py-2 bg-white border border-gray-200 text-gray-600 text-sm font-medium rounded-lg shadow-lg hover:bg-gray-50">
          ← Назад
        </a>
      </div>

      <div className="max-w-[700px] mx-auto px-8 py-10 text-gray-900">

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, paddingBottom: 16, borderBottom: '2px solid #111110' }}>
          <div>
            <p style={{ fontSize: 10, color: '#9a9a95', textTransform: 'uppercase', letterSpacing: 1, margin: '0 0 4px' }}>Спецификация материалов</p>
            <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>Заказ {o.number}</h1>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={{ fontSize: 12, color: '#6b6b66', margin: '0 0 2px' }}>{o.client_name}</p>
            <p style={{ fontSize: 11, color: '#9a9a95', margin: 0 }}>{date}</p>
          </div>
        </div>

        {/* Positions summary */}
        <div style={{ marginBottom: 20 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: '#9a9a95', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Позиции заказа</p>
          {l.map((line, i) => (
            <div key={line.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #f0f0ec', fontSize: 13 }}>
              <span>
                <b>{i + 1}.</b> {PRODUCT_LABELS[line.product_type] ?? line.product_type}
                {line.dimensions_text ? ` · ${line.dimensions_text}` : ''}
              </span>
              <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmt(line.line_sale_price)}</span>
            </div>
          ))}
        </div>

        {/* BOM table */}
        {bomItems.length > 0 && (
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, color: '#9a9a95', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
              Материалы к комплектации ({bomItems.length} позиций)
            </p>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#f8f8f7' }}>
                  <th style={{ border: '1px solid #e4e4e0', padding: '7px 10px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: '#6b6b66' }}>Наименование</th>
                  <th style={{ border: '1px solid #e4e4e0', padding: '7px 10px', textAlign: 'center', fontSize: 10, fontWeight: 700, color: '#6b6b66' }}>Кол-во</th>
                  <th style={{ border: '1px solid #e4e4e0', padding: '7px 10px', textAlign: 'right', fontSize: 10, fontWeight: 700, color: '#6b6b66' }}>Сумма</th>
                  <th style={{ border: '1px solid #e4e4e0', padding: '7px 10px', textAlign: 'center', fontSize: 10, fontWeight: 700, color: '#6b6b66' }}>✓</th>
                </tr>
              </thead>
              <tbody>
                {bomItems.map((item, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#fafaf9' }}>
                    <td style={{ border: '1px solid #e4e4e0', padding: '7px 10px' }}>{item.name}</td>
                    <td style={{ border: '1px solid #e4e4e0', padding: '7px 10px', textAlign: 'center' }}>{qty(item.qty, item.unit)}</td>
                    <td style={{ border: '1px solid #e4e4e0', padding: '7px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(item.total)}</td>
                    <td style={{ border: '1px solid #e4e4e0', padding: '7px 10px', textAlign: 'center', width: 32 }}>&nbsp;</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {bomItems.length === 0 && (
          <div style={{ background: '#f8f8f7', borderRadius: 8, padding: '16px', fontSize: 13, color: '#9a9a95', textAlign: 'center' }}>
            Состав материалов не указан в позициях заказа
          </div>
        )}

        {/* Footer note */}
        <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid #e4e4e0', fontSize: 11, color: '#9a9a95' }}>
          Спецификация составлена автоматически на основании позиций заказа. Для уточнения обратитесь к менеджеру.
        </div>
      </div>
    </>
  )
}
