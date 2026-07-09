import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { buildAutoTurnover, mergeTurnover, type RefClient } from '@/lib/referralTurnover'

// Кабинет партнёра: его ставка, его клиенты и объединённый оборот
// (авто из b2b_orders для привязанных к CRM + ручной для остальных).
// Данные строго текущего пользователя — service client после auth-проверки.

export async function GET() {
  const auth = await createClient()
  const { data: { user } } = await auth.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const sb = createServiceClient()
  const { data: profile } = await sb.from('users').select('referral_rate_pct').eq('id', user.id).maybeSingle()
  const rate = (profile?.referral_rate_pct ?? null) as number | null
  if (rate == null) return NextResponse.json({ rate: null, clients: [], turnover: [] })

  const { data: cl } = await sb.from('referral_clients')
    .select('id,referrer_id,name,note,b2b_client_id')
    .eq('referrer_id', user.id).order('name')
  const clients = (cl ?? []) as RefClient[]

  const [{ data: manual }, auto] = await Promise.all([
    clients.length
      ? sb.from('referral_turnover').select('referral_client_id,ym,amount').in('referral_client_id', clients.map(c => c.id))
      : Promise.resolve({ data: [] as { referral_client_id: number; ym: string; amount: number }[] }),
    buildAutoTurnover(sb, clients),
  ])

  return NextResponse.json({
    rate,
    clients: clients.map(c => ({ id: c.id, name: c.name, note: c.note, linked: c.b2b_client_id != null })),
    turnover: mergeTurnover(clients, manual ?? [], auto),
  })
}
