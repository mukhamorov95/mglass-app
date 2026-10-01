import { redirect } from 'next/navigation'
import { getRole, getSessionUser, isOwnerRole } from '@/lib/getRole'
import MeasurerEarnings from '@/components/measure/MeasurerEarnings'

// «Заработок» замерщика — отдельный пункт меню рядом с кабинетом и календарём (владелец 01.10).
// Видят сам замерщик и владелец; API отдаёт остальным 403, страница — уводит на главную.
export default async function MeasurerEarningsPage() {
  const [role, user] = await Promise.all([getRole(), getSessionUser()])
  if (!role || !user) redirect('/login')
  const owner = isOwnerRole(role)
  if (role !== 'measurer' && !owner) redirect('/')
  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-28 lg:pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-4 sm:px-5 pt-5 sm:pt-6 pb-4">
        <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Заработок</h1>
        <p className="text-[12px] text-[#9a9a95] mt-0.5">
          {owner ? 'Замеры за период по замерщикам: сколько сделано, как оплачен выезд, сколько компания должна.'
            : 'Сколько замеров сделал за период, что получил на объекте и сколько должна компания.'}
        </p>
      </div>
      <div className="px-4 sm:px-5 pt-4 max-w-[1100px]">
        <MeasurerEarnings meId={user.id} isOwner={owner} />
      </div>
    </div>
  )
}
