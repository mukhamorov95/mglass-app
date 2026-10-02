import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { phoneKey } from '@/lib/b2c/phoneKey'

// Заявка 3D-конструктора → сделка в приложении (Ш3, решение 11 от 02.10). AmoCRM не трогаем.
// Телефон уже есть в живой сделке — вторую не заводим: повторное обращение того же
// человека ложится в его последнюю сделку. Расчёты так не склеиваются (это решает
// менеджер в ensure), но заявка — не расчёт, а «клиент снова пришёл».
export async function dealForLead(svc: SupabaseClient, lead: { name: string; phone: string }): Promise<{ dealId: number; created: boolean } | null> {
  const pk = phoneKey(lead.phone)
  if (pk) {
    const { data } = await svc.from('deals').select('id')
      .eq('phone_key', pk).is('archived_at', null).is('lost_at', null)
      .order('updated_at', { ascending: false }).limit(1)
    const id = Number((data ?? [])[0]?.id)
    if (Number.isFinite(id) && id > 0) return { dealId: id, created: false }
  }
  const { data, error } = await svc.from('deals').insert({
    client_name: lead.name,
    phone: lead.phone,
    phone_key: pk,
    source: 'site',
    created_by_name: 'Сайт · 3D-конструктор',
  }).select('id').single()
  if (error || !data) {
    console.error('[configurator/lead] deal insert:', error?.message)
    return null
  }
  return { dealId: Number(data.id), created: true }
}
