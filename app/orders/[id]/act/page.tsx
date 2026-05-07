import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { getRole } from '@/lib/getRole'
import { notFound } from 'next/navigation'
import type { Order, OrderLine } from '@/lib/types'

function fmt(n: number) { return n.toLocaleString('ru-RU') + ' ₽' }

const PRODUCT_LABELS: Record<string, string> = {
  mirror:          'Зеркало с подсветкой',
  loft:            'Лофт-перегородка',
  shower_budget:   'Душевая перегородка',
  shower_standard: 'Душевая перегородка',
  b2b:             'Стеклоизделие',
  service:         'Услуга',
  custom:          'Прочее',
}

export default async function ActPage({
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

  const actDate = o.actual_completion_date
    ? new Date(o.actual_completion_date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
    : new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })

  const actNumber = `АВР-${o.number}`

  return (
    <>
      <style>{`
        @page { margin: 20mm 15mm; size: A4; }
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
        <div className="text-center mb-8">
          <h1 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 4px' }}>АКТ ВЫПОЛНЕННЫХ РАБОТ</h1>
          <p style={{ fontSize: 14, color: '#6b6b66' }}>{actNumber} от {actDate}</p>
        </div>

        {/* Parties */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 28 }}>
          <div style={{ border: '1px solid #e4e4e0', borderRadius: 8, padding: '14px 16px' }}>
            <p style={{ fontSize: 10, color: '#9a9a95', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Исполнитель</p>
            <p style={{ fontSize: 14, fontWeight: 700, margin: '0 0 4px' }}>MGlass</p>
            <p style={{ fontSize: 12, color: '#6b6b66', margin: 0 }}>Производство стеклянных конструкций</p>
            <p style={{ fontSize: 12, color: '#6b6b66', margin: '4px 0 0' }}>Москва</p>
          </div>
          <div style={{ border: '1px solid #e4e4e0', borderRadius: 8, padding: '14px 16px' }}>
            <p style={{ fontSize: 10, color: '#9a9a95', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Заказчик</p>
            <p style={{ fontSize: 14, fontWeight: 700, margin: '0 0 4px' }}>{o.client_name}</p>
            {o.client_phone   && <p style={{ fontSize: 12, color: '#6b6b66', margin: '2px 0 0' }}>{o.client_phone}</p>}
            {o.object_address && <p style={{ fontSize: 12, color: '#6b6b66', margin: '2px 0 0' }}>{o.object_address}</p>}
          </div>
        </div>

        {/* Work table */}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginBottom: 20 }}>
          <thead>
            <tr style={{ background: '#f8f8f7' }}>
              <th style={{ border: '1px solid #e4e4e0', padding: '8px 10px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#6b6b66' }}>№</th>
              <th style={{ border: '1px solid #e4e4e0', padding: '8px 10px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#6b6b66' }}>Наименование</th>
              <th style={{ border: '1px solid #e4e4e0', padding: '8px 10px', textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#6b6b66' }}>Ед.</th>
              <th style={{ border: '1px solid #e4e4e0', padding: '8px 10px', textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#6b6b66' }}>Кол-во</th>
              <th style={{ border: '1px solid #e4e4e0', padding: '8px 10px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: '#6b6b66' }}>Сумма</th>
            </tr>
          </thead>
          <tbody>
            {l.map((line, i) => (
              <tr key={line.id}>
                <td style={{ border: '1px solid #e4e4e0', padding: '8px 10px', color: '#6b6b66' }}>{i + 1}</td>
                <td style={{ border: '1px solid #e4e4e0', padding: '8px 10px' }}>
                  <p style={{ margin: 0, fontWeight: 600 }}>{line.product_name}</p>
                  <p style={{ margin: '2px 0 0', fontSize: 11, color: '#6b6b66' }}>
                    {PRODUCT_LABELS[line.product_type] ?? line.product_type}
                    {line.dimensions_text ? ` · ${line.dimensions_text}` : ''}
                  </p>
                </td>
                <td style={{ border: '1px solid #e4e4e0', padding: '8px 10px', textAlign: 'center', color: '#6b6b66' }}>шт.</td>
                <td style={{ border: '1px solid #e4e4e0', padding: '8px 10px', textAlign: 'center' }}>1</td>
                <td style={{ border: '1px solid #e4e4e0', padding: '8px 10px', textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {fmt(line.line_sale_price)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: '#f8f8f7', fontWeight: 700 }}>
              <td colSpan={4} style={{ border: '1px solid #e4e4e0', padding: '10px', textAlign: 'right', fontSize: 14 }}>
                ИТОГО:
              </td>
              <td style={{ border: '1px solid #e4e4e0', padding: '10px', textAlign: 'right', fontSize: 16, fontVariantNumeric: 'tabular-nums' }}>
                {fmt(o.total_sale_price)}
              </td>
            </tr>
          </tfoot>
        </table>

        {/* Act text */}
        <div style={{ background: '#f8f8f7', borderRadius: 8, padding: '14px 16px', marginBottom: 28, fontSize: 13, color: '#4b4b47', lineHeight: 1.6 }}>
          Исполнитель выполнил, а Заказчик принял следующие работы (товары): изготовление и установку изделий согласно заказу {o.number}.
          Работы выполнены в полном объёме, в установленные сроки, надлежащего качества. Претензий по объёму, качеству и срокам оказания услуг Заказчик не имеет.
        </div>

        {/* Signatures */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 40 }}>
          {[
            { title: 'Исполнитель', name: 'MGlass', role: 'Директор' },
            { title: 'Заказчик',   name: o.client_name, role: '' },
          ].map(p => (
            <div key={p.title}>
              <p style={{ fontSize: 11, color: '#9a9a95', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>{p.title}</p>
              <p style={{ fontSize: 13, fontWeight: 600, margin: '0 0 4px' }}>{p.name}</p>
              {p.role && <p style={{ fontSize: 12, color: '#6b6b66', margin: '0 0 20px' }}>{p.role}</p>}
              <div style={{ marginTop: p.role ? 0 : 20 }}>
                <div style={{ borderBottom: '1px solid #111110', width: 200, marginBottom: 4 }} />
                <p style={{ fontSize: 11, color: '#9a9a95' }}>подпись / дата</p>
              </div>
            </div>
          ))}
        </div>

      </div>
    </>
  )
}
