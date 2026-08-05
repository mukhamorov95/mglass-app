import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'

// Статус AI-бота (Иван) + пульс Авито для шапки CRM. Только чтение, любой залогиненный.
export async function GET() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const svc = createServiceClient()
  const [{ data: setting }, { data: last }, { count }] = await Promise.all([
    svc.from('ai_settings').select('value').eq('key', 'bot_enabled').maybeSingle(),
    svc.from('crm_leads').select('created_at').eq('source', 'avito').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    svc.from('crm_leads').select('id', { count: 'exact', head: true }).eq('source', 'avito').gte('created_at', new Date(Date.now() - 24 * 3600_000).toISOString()),
  ])
  return NextResponse.json({
    botEnabled: (setting as { value?: string } | null)?.value !== 'false',
    lastAvitoAt: (last as { created_at?: string } | null)?.created_at ?? null,
    avito24h: count ?? 0,
  })
}
