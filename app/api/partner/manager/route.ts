import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { resolvePartnerMember } from '@/lib/partnerClient'
import { loadClientManager } from '@/lib/partner/manager'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  const svc = createServiceClient()
  const pm = await resolvePartnerMember<{ id: number }>(svc, user.id, 'id')
  if (!pm) return NextResponse.json({ error: 'Аккаунт не привязан' }, { status: 403 })
  return NextResponse.json({ manager: await loadClientManager(svc, pm.client.id) })
}
