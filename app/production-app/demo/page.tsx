import { createClient } from '@/lib/supabase-server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import ProductionTabs from '@/components/ProductionTabs'

// «Учебный заказ» — находит актуальный демо-заказ (ДЕМО-1) и открывает его карточку.
// Отдельный роут, чтобы ссылка в меню не ломалась при пересоздании демо-заказа.
export const dynamic = 'force-dynamic'

export default async function DemoOrderPage() {
  const sb = await createClient()
  const { data } = await sb
    .from('b2b_orders')
    .select('id')
    .eq('custom_number', 'ДЕМО-1')
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (data?.id) redirect(`/production-app/orders/${data.id}`)

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-4 pt-12 pb-4 lg:pt-6">
        <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Учебный заказ</h1>
        <ProductionTabs />
      </div>
      <div className="px-4 pt-6 max-w-[560px]">
        <div className="bg-white rounded-xl border border-[#e4e4e0] p-6 text-center">
          <p className="text-[15px] font-semibold text-[#111110]">Учебный заказ сейчас не создан</p>
          <p className="text-[13px] text-[#9a9a95] mt-1.5">Попросите администратора создать заказ «ДЕМО-1» — на нём тренируемся отмечать этапы без риска для реальных заказов.</p>
          <Link href="/production-app/guide" className="inline-block mt-4 text-[13px] font-semibold px-4 py-2 rounded-lg bg-[#111110] text-white hover:bg-[#2a2a28]">📘 Открыть регламент</Link>
        </div>
      </div>
    </div>
  )
}
