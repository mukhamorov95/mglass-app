import Link from 'next/link'
import ProductionTabs from '@/components/ProductionTabs'
import OrdersKanban from './OrdersKanban'

export default function KanbanScreen({ tv }: { tv: boolean }) {
  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      {!tv ? (
        <div className="bg-white border-b border-[#e4e4e0] px-4 pt-12 pb-3 lg:pt-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">🔥 Табло цеха</h1>
              <p className="text-[13px] text-[#9a9a95] mt-0.5">Заказы по этапам: новые сверху, берите сверху вниз</p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Link href="/production-app/control?view=tasks" className="text-[12px] px-3 py-2 rounded-lg border border-[#e4e4e0] text-[#3b3b38]">📌 Поручения</Link>
              <Link href="/production-app/control?tv=1" className="hidden sm:inline-block text-[12px] px-3 py-2 rounded-lg border border-[#e4e4e0] text-[#6b6b66]">📺 Экран цеха</Link>
            </div>
          </div>
          <ProductionTabs />
        </div>
      ) : (
        <div className="px-6 pt-5 pb-3 flex items-baseline justify-between">
          <h1 className="text-[30px] font-bold tracking-tight text-[#111110]">🔥 Табло цеха</h1>
          <Link href="/production-app/control" className="text-[16px] underline text-[#6b6b66]">выйти</Link>
        </div>
      )}
      <div className={tv ? 'px-6' : 'px-4 pt-4'}>
        <OrdersKanban tv={tv} />
      </div>
    </div>
  )
}
