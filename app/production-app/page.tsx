'use client'

import Link from 'next/link'

const STAT_CARDS = [
  { label: 'Мои задачи',         value: '—', color: 'text-[#111110]'  },
  { label: 'Просрочено',         value: '—', color: 'text-red-600'     },
  { label: 'Проблемы',           value: '—', color: 'text-orange-600'  },
  { label: 'Готово к упаковке',  value: '—', color: 'text-emerald-600' },
]

export default function ProductionAppPage() {
  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-4 pt-12 pb-4 lg:pt-6">
        <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Сегодня</h1>
        <p className="text-[13px] text-[#9a9a95] mt-0.5">Производственный дашборд</p>
      </div>

      <div className="grid grid-cols-2 gap-3 p-4">
        {STAT_CARDS.map(card => (
          <div key={card.label} className="bg-white rounded-xl border border-[#e4e4e0] p-4">
            <p className="text-[11px] text-[#9a9a95] font-medium uppercase tracking-wide leading-tight">{card.label}</p>
            <p className={`text-[32px] font-bold mt-1 leading-none ${card.color}`}>{card.value}</p>
          </div>
        ))}
      </div>

      <div className="px-4 mt-1">
        <Link
          href="/production-app/orders/demo"
          className="block w-full bg-[#111110] text-white text-center py-3.5 rounded-xl text-[15px] font-semibold"
        >
          Открыть заказ (demo)
        </Link>
      </div>

      <p className="text-center text-[12px] text-[#b0b0aa] mt-6 px-4">
        Каркас — данные будут подключены на следующем шаге
      </p>
    </div>
  )
}
