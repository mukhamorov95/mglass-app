'use client'

import Link from 'next/link'
import { use } from 'react'

const STAGES = [
  'Резка',
  'Полировка',
  'Сверловка',
  'Вырезы',
  'Упаковка',
]

export default function ProductionOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-4 pt-12 pb-4 lg:pt-6">
        <Link href="/production-app" className="inline-flex items-center gap-1 text-[13px] text-[#9a9a95] hover:text-[#111110] mb-2">
          ← Назад
        </Link>
        <h1 className="text-[18px] font-bold text-[#111110] tracking-tight">Заказ #{id}</h1>
        <p className="text-[13px] text-[#9a9a95] mt-0.5">Этапы производства</p>
      </div>

      <div className="p-4 space-y-2">
        {STAGES.map(stage => (
          <div key={stage} className="bg-white rounded-xl border border-[#e4e4e0] px-4 py-3.5 flex items-center gap-3">
            <div className="w-5 h-5 rounded border-2 border-[#d4d4ce] flex-shrink-0" />
            <span className="text-[15px] font-medium text-[#111110]">{stage}</span>
          </div>
        ))}
      </div>

      <p className="text-center text-[12px] text-[#b0b0aa] mt-4 px-4">
        Каркас — логика обновления статусов будет добавлена на следующем шаге
      </p>
    </div>
  )
}
