import { createClient } from '@/lib/supabase-server'
import ProductionTabs from '@/components/ProductionTabs'
import MaterialCheck from './MaterialCheck'

// Экран Сергея (материал) — ТОЛЬКО ПРОСМОТР: какой материал по каким заявкам
// ещё не приехал. Ничего не меняет. Заявки, у которых нет даты получения.

type PO = {
  id: number
  supplier_name: string | null
  items_list: string | null
  items: unknown
  amount: number | null
  currency: string | null
  status: string | null
  expected_date: string | null
  expected_at: string | null
  b2b_order_ids: number[] | null
  comment: string | null
}

function fmtDate(d: string | null): string {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) } catch { return d }
}

export default async function MaterialPage() {
  const sb = await createClient()
  const { data } = await sb
    .from('purchase_orders')
    .select('id,supplier_name,items_list,items,amount,currency,status,expected_date,expected_at,b2b_order_ids,comment')
    .is('received_date', null)
    .order('expected_date', { ascending: true, nullsFirst: false })

  const pos = (data ?? []) as PO[]

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-4 pt-12 pb-3 lg:pt-6">
        <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Материал</h1>
        <p className="text-[13px] text-[#9a9a95] mt-0.5">{pos.length} заявок ждут прихода</p>
        <ProductionTabs />
      </div>

      <MaterialCheck />

      <div className="px-4 pt-4 space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-[#9a9a95]">Заявки в пути · {pos.length}</p>
        {pos.length === 0 && (
          <div className="bg-white rounded-xl border border-[#e4e4e0] p-8 text-center">
            <p className="text-[14px] text-[#9a9a95]">Нет заявок на материал в пути</p>
          </div>
        )}
        {pos.map(po => {
          const materials = po.items_list?.trim()
            || (Array.isArray(po.items) ? (po.items as Record<string, unknown>[]).map(i => String(i.name ?? i.material ?? '')).filter(Boolean).join(', ') : '')
          const when = po.expected_date || po.expected_at
          return (
            <div key={po.id} className="bg-white rounded-xl border border-[#e4e4e0] px-4 py-3">
              <div className="flex items-start justify-between gap-2 mb-1">
                <p className="text-[14px] font-bold text-[#111110] truncate">{po.supplier_name?.trim() || `Заявка #${po.id}`}</p>
                <span className="text-[11px] font-medium px-2 py-1 rounded-full bg-amber-50 text-amber-700 whitespace-nowrap flex-shrink-0">
                  к {fmtDate(when)}
                </span>
              </div>
              {materials && <p className="text-[13px] text-[#111110]">{materials}</p>}
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[12px] text-[#9a9a95]">
                {po.amount ? <span>{Number(po.amount).toLocaleString('ru-RU')} {po.currency ?? '₽'}</span> : null}
                {po.b2b_order_ids?.length ? <span>· по {po.b2b_order_ids.length} заказам</span> : null}
                {po.status ? <span>· {po.status}</span> : null}
              </div>
              {po.comment && <p className="text-[12px] text-[#6b6b66] mt-1">{po.comment}</p>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
