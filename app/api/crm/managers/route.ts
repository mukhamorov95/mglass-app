import { NextResponse } from 'next/server'
import { requireAnyPageAccess } from '@/lib/apiAuth'
import { createServiceClient } from '@/lib/supabase-service'

// Список менеджеров по продажам для назначения ответственного в карточке лида.
export async function GET() {
  const guard = await requireAnyPageAccess(['/crm'])
  if (guard instanceof NextResponse) return guard
  const sb = createServiceClient()
  const { data } = await sb.from('users').select('name,role')
    .in('role', ['manager', 'commercial']).order('name')
  const managers = ((data ?? []) as { name: string | null }[])
    .map(u => u.name).filter((n): n is string => !!n && n.trim() !== '')
  return NextResponse.json({ managers })
}
