import { redirect } from 'next/navigation'
import { getRole, getSessionUser, isOwnerRole } from '@/lib/getRole'
import MeasureCalendarView from '@/components/measure/MeasureCalendarView'

// Календарь замеров. Замерщик и владелец — свой месяц и день, ниже неделя всех замерщиков:
// кто, когда и где занят, выходные и свободные окна. Менеджеры, офис, логист — неделя.
// Заявки создаются в /measure-requests, время ставит замерщик или менеджер.
export default async function MeasureCalendarPage() {
  const [role, user] = await Promise.all([getRole(), getSessionUser()])
  if (!role || !user) redirect('/login')
  const owner = isOwnerRole(role)
  const mine = role === 'measurer' || owner
  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-28 lg:pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-4 sm:px-5 pt-5 sm:pt-6 pb-4">
        <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Календарь замеров</h1>
        <p className="text-[12px] text-[#9a9a95] mt-0.5">
          {mine ? 'Месяц и день — нажми на число. Ниже — занятость всех замерщиков по неделе.'
            : 'Кто из замерщиков когда и где занят, у кого выходной и когда можно начать новый замер.'}
        </p>
      </div>
      <div className="px-4 sm:px-5 pt-4 max-w-[1100px]">
        <MeasureCalendarView meId={user.id} isOwner={owner} mine={mine} />
      </div>
    </div>
  )
}
