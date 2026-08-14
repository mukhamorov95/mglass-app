import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

// Справочник юрлиц клиентов для подстановки в договор/счёт (внутренние роли).
// Отдаёт клиентов, у которых есть активные юрлица, + сами юрлица. RLS на
// b2b_client_legal_entities уже ограничивает не-партнёрами.
const ENTITY_COLS = 'id,client_id,full_name,inn,kpp,ogrn,legal_address,bank_account,bank_name,bik,corr_account,supply_contract_no,supply_contract_date,is_default,active'

export async function GET() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: ents } = await sb.from('b2b_client_legal_entities')
    .select(ENTITY_COLS).eq('active', true)
    .order('is_default', { ascending: false }).order('id', { ascending: true })
  const entities = ents ?? []

  const clientIds = [...new Set(entities.map(e => e.client_id as number))]
  const { data: clients } = clientIds.length
    ? await sb.from('b2b_clients').select('id,name').in('id', clientIds).order('name')
    : { data: [] }

  return NextResponse.json({ clients: clients ?? [], entities })
}
