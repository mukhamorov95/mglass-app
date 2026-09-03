import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getRole } from '@/lib/getRole'
import { redirect } from 'next/navigation'
import { PrintButton } from './PrintButton'

function fmt(n: number) { return n.toLocaleString('ru-RU') + ' ₽' }

export default async function RouteSheetPage() {
  const role = await getRole()
  if (!role) redirect('/login')

  const supabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // Orders in 'completed' status with delivery address (ready for delivery)
  const { data: orders } = await supabase
    .from('orders')
    .select('id, number, client_name, client_phone, delivery_address, total_sale_price, payment_status, prepayment_amount, notes')
    .eq('status', 'completed')
    .not('delivery_address', 'is', null)
    .order('created_at', { ascending: true })

  const today = new Date().toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long', year: 'numeric' })
  type RouteOrder = {
    id: number; number: string; client_name: string | null; client_phone: string | null
    delivery_address: string | null; total_sale_price: number; payment_status: string | null
    prepayment_amount: number | null; notes: string | null
  }
  const items = (orders ?? []) as RouteOrder[]

  return (
    <>
      <style>{`
        @page { margin: 16mm 12mm; size: A4; }
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-print { display: none !important; }
        }
        * { box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, sans-serif; background: #fff; }
      `}</style>

      <div className="no-print fixed top-4 right-4 flex gap-2 z-50">
        <PrintButton />
      </div>

      <div className="max-w-[760px] mx-auto px-8 py-10">

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, paddingBottom: 14, borderBottom: '2px solid #111110' }}>
          <div>
            <p style={{ fontSize: 10, color: '#9a9a95', textTransform: 'uppercase', letterSpacing: 1, margin: '0 0 4px' }}>MGlass</p>
            <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>Маршрутный лист доставок</h1>
          </div>
          <p style={{ fontSize: 13, color: '#6b6b66', margin: 0 }}>{today}</p>
        </div>

        {items.length === 0 ? (
          <p style={{ fontSize: 14, color: '#9a9a95', textAlign: 'center', marginTop: 40 }}>
            Нет заказов, готовых к доставке
          </p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#f8f8f7' }}>
                <th style={{ border: '1px solid #e4e4e0', padding: '8px 10px', textAlign: 'center', fontSize: 10, fontWeight: 700, color: '#6b6b66', width: 32 }}>№</th>
                <th style={{ border: '1px solid #e4e4e0', padding: '8px 10px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: '#6b6b66' }}>Заказ / Клиент</th>
                <th style={{ border: '1px solid #e4e4e0', padding: '8px 10px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: '#6b6b66' }}>Адрес доставки</th>
                <th style={{ border: '1px solid #e4e4e0', padding: '8px 10px', textAlign: 'right', fontSize: 10, fontWeight: 700, color: '#6b6b66' }}>Сумма</th>
                <th style={{ border: '1px solid #e4e4e0', padding: '8px 10px', textAlign: 'center', fontSize: 10, fontWeight: 700, color: '#6b6b66' }}>Оплата</th>
                <th style={{ border: '1px solid #e4e4e0', padding: '8px 10px', textAlign: 'center', fontSize: 10, fontWeight: 700, color: '#6b6b66' }}>✓</th>
              </tr>
            </thead>
            <tbody>
              {items.map((o, i) => {
                const payLabel =
                  o.payment_status === 'paid' ? 'Оплачен' :
                  o.payment_status === 'partial' ? `Предоплата ${o.prepayment_amount ? fmt(o.prepayment_amount) : ''}` :
                  'Не оплачен'
                const payColor =
                  o.payment_status === 'paid'    ? '#16a34a' :
                  o.payment_status === 'partial' ? '#d97706' : '#dc2626'
                return (
                  <tr key={o.id} style={{ background: i % 2 === 0 ? '#fff' : '#fafaf9' }}>
                    <td style={{ border: '1px solid #e4e4e0', padding: '10px', textAlign: 'center', color: '#6b6b66' }}>{i + 1}</td>
                    <td style={{ border: '1px solid #e4e4e0', padding: '10px' }}>
                      <p style={{ margin: '0 0 2px', fontWeight: 700 }}>{o.number}</p>
                      <p style={{ margin: 0, color: '#4b4b47' }}>{o.client_name}</p>
                      {o.client_phone && <p style={{ margin: '2px 0 0', fontSize: 11, color: '#9a9a95' }}>{o.client_phone}</p>}
                    </td>
                    <td style={{ border: '1px solid #e4e4e0', padding: '10px', color: '#4b4b47' }}>
                      {o.delivery_address}
                      {o.notes && <p style={{ margin: '4px 0 0', fontSize: 11, color: '#9a9a95' }}>{o.notes}</p>}
                    </td>
                    <td style={{ border: '1px solid #e4e4e0', padding: '10px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                      {fmt(o.total_sale_price)}
                    </td>
                    <td style={{ border: '1px solid #e4e4e0', padding: '10px', textAlign: 'center', fontSize: 11, fontWeight: 600, color: payColor }}>
                      {payLabel}
                    </td>
                    <td style={{ border: '1px solid #e4e4e0', padding: '10px', textAlign: 'center', width: 32 }}>&nbsp;</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        <div style={{ marginTop: 20, padding: '12px 16px', background: '#f8f8f7', borderRadius: 8, display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
          <span style={{ fontWeight: 700 }}>Итого к доставке: {items.length} заказов</span>
          <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
            {fmt(items.reduce((s, o) => s + (o.total_sale_price ?? 0), 0))}
          </span>
        </div>
      </div>
    </>
  )
}
