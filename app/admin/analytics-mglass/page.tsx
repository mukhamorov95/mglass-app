import { createClient } from '@supabase/supabase-js'
import { getRole, isOwnerRole } from '@/lib/getRole'
import { redirect } from 'next/navigation'
import AnalyticsMglassClient from './AnalyticsMglassClient'
import { pageAll } from '@/lib/supabase/pageAll'

export type CalcRow = {
  id: number
  created_at: string
  created_by: string
  final_price: number
  status: string
}

export type UserRow = {
  id: string
  name: string | null
  email: string
}

export default async function AnalyticsMglassPage() {
  const role = await getRole()
  if (!isOwnerRole(role)) redirect('/')

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // По возрастанию даты без пагинации PostgREST отдал бы первую 1000 — то есть отрезал
  // бы как раз свежие расчёты. Читаем страницами; ошибку показываем, а не нули.
  const [calcsRes, { data: users, error: usersErr }] = await Promise.all([
    pageAll<CalcRow>((from, to) => admin
      .from('calculations')
      .select('id,created_at,created_by,final_price,status')
      .gte('created_at', '2025-01-01')
      .order('created_at', { ascending: true }).order('id', { ascending: true })
      .range(from, to))
      .then(rows => ({ rows, error: null as string | null }), (e: Error) => ({ rows: [] as CalcRow[], error: e.message as string | null })),
    admin
      .from('users')
      .select('id,name,email'),
  ])
  const loadError = calcsRes.error ?? usersErr?.message ?? null

  return (
    <>
      {loadError && (
        <div className="m-4 bg-red-50 border border-red-200 text-red-700 text-[13px] rounded-xl px-4 py-3">
          Данные не загрузились — цифры ниже неверны. {loadError}
        </div>
      )}
      <AnalyticsMglassClient
        calcs={calcsRes.rows}
        users={(users ?? []) as UserRow[]}
      />
    </>
  )
}
