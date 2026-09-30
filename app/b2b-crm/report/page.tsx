import { redirect } from 'next/navigation'
import { getRole, canAccessRoute } from '@/lib/getRole'
import ReportClient from './ReportClient'

// Отчёт по клиентам B2B: клиент × период → заказы и суммы (просьба владельца 30.09).
export default async function ClientReportPage({ searchParams }: {
  searchParams: Promise<{ client?: string; g?: string; from?: string; to?: string }>
}) {
  const role = await getRole()
  if (!canAccessRoute(role, '/b2b-crm/report')) redirect('/access-denied')
  const sp = await searchParams
  return <ReportClient initial={{ client: sp.client ?? null, g: sp.g ?? null, from: sp.from ?? null, to: sp.to ?? null }} />
}
