import { createClient } from '@supabase/supabase-js'
import { getRole, isOwnerRole } from '@/lib/getRole'
import { redirect } from 'next/navigation'
import AnalyticsMglassClient from './AnalyticsMglassClient'

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

  const [{ data: calcs }, { data: users }] = await Promise.all([
    admin
      .from('calculations')
      .select('id,created_at,created_by,final_price,status')
      .gte('created_at', '2025-01-01')
      .order('created_at', { ascending: true }),
    admin
      .from('users')
      .select('id,name,email'),
  ])

  return (
    <AnalyticsMglassClient
      calcs={(calcs ?? []) as CalcRow[]}
      users={(users ?? []) as UserRow[]}
    />
  )
}
