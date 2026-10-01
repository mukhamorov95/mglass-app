'use client'

import { useState } from 'react'
import MeasureBoard from '@/components/measure/MeasureBoard'
import MeasurerCalendar from '@/components/measure/MeasurerCalendar'
import MeasurerAvailability from '@/components/measure/MeasurerAvailability'

// Замерщику и владельцу сверху — свой месяц и день (бывшая вкладка кабинета), ниже — неделя
// всех замерщиков и мой график (часы, выходные). Остальным (менеджер, офис, логист) — неделя.
export default function MeasureCalendarView({ meId, isOwner, mine }: { meId: string; isOwner: boolean; mine: boolean }) {
  const [refreshKey, setRefreshKey] = useState(0)
  return (
    <div className="space-y-4">
      {mine && <MeasurerCalendar meId={meId} isOwner={isOwner} refreshKey={refreshKey} onChanged={() => setRefreshKey(k => k + 1)} />}
      <MeasureBoard title={mine ? 'Неделя — все замерщики' : 'Неделя'} refreshKey={refreshKey} />
      {mine && <MeasurerAvailability onChanged={() => setRefreshKey(k => k + 1)} />}
    </div>
  )
}
