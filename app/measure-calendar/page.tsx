'use client'

import MeasureBoard from '@/components/measure/MeasureBoard'

// Календарь замеров — доска занятости замерщиков по неделям: кто, когда и где
// занят, выходные и свободные окна. Видят менеджеры, замерщики, офис, логист и
// владелец; заявки создаются в /measure-requests, время ставит замерщик или менеджер.

export default function MeasureCalendarPage() {
  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-5 pt-6 pb-4">
        <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Календарь замеров</h1>
        <p className="text-[12px] text-[#9a9a95] mt-0.5">Кто из замерщиков когда и где занят, у кого выходной и когда можно начать новый замер.</p>
      </div>
      <div className="px-5 pt-4 max-w-[1100px]">
        <MeasureBoard title="Неделя" />
      </div>
    </div>
  )
}
