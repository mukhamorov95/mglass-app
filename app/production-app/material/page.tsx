'use client'

import { useState } from 'react'
import ProductionTabs from '@/components/ProductionTabs'
import MaterialCheck from './MaterialCheck'
import NeededMaterial from './NeededMaterial'

// «Материал»: две вкладки (решение владельца 14.07). «Проверка материала» —
// новые заказы, по которым мастер жмёт есть/нет. «Нужен материал» — сводка
// закупки по материалу и толщине из всех отметок «нет материала» (заказ целиком
// или отдельные позиции из «Моих задач»). Блок «Заявки в пути» убран.

export default function MaterialPage() {
  const [tab, setTab] = useState<'check' | 'needed'>('check')
  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-4 pt-12 pb-3 lg:pt-6">
        <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Материал</h1>
        <p className="text-[13px] text-[#9a9a95] mt-0.5">Проверка под новые заказы и сводка «что докупить»</p>
        <ProductionTabs />
      </div>

      <div className="px-4 pt-4 flex gap-1.5">
        <button onClick={() => setTab('check')}
          className={`px-3.5 py-1.5 rounded-full text-[12px] font-medium border transition-colors ${tab === 'check' ? 'bg-[#111110] text-white border-[#111110]' : 'bg-white text-[#6b6b66] border-[#e4e4e0] hover:border-[#111110]'}`}>
          Проверка материала
        </button>
        <button onClick={() => setTab('needed')}
          className={`px-3.5 py-1.5 rounded-full text-[12px] font-medium border transition-colors ${tab === 'needed' ? 'bg-[#111110] text-white border-[#111110]' : 'bg-white text-[#6b6b66] border-[#e4e4e0] hover:border-[#111110]'}`}>
          🛒 Нужен материал
        </button>
      </div>

      {tab === 'check' ? <MaterialCheck /> : <NeededMaterial />}
    </div>
  )
}
