import { createClient } from '@/lib/supabase-server'
import { isOwnerRole, canAccessRoute } from '@/lib/getRole'
import { amoGet, getPipelines, getDomain } from '@/lib/amocrm'
import { canSeeLead, amoFieldValue, AMO_CLOSED_STATUSES, type AmoContactRaw, type AmoLeadCard } from '@/lib/amoLead'

// Серверная сторона сделок AmoCRM: кто смотрит (его amo_user_id и право видеть чужие),
// что по сделкам уже сделано в приложении и сама карточка сделки. CRM только читаем.
export type AmoViewer = { userId: string; isOwner: boolean; canViewAll: boolean; amoUserId: number | null }

export async function getAmoViewer(): Promise<AmoViewer | { error: string; status: number }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Нужно войти', status: 401 }
  const { data, error } = await supabase.from('users')
    .select('role, amo_user_id, can_view_all_deals').eq('id', user.id).maybeSingle()
  if (error) return { error: `Профиль не прочитан: ${error.message}`, status: 500 }
  const p = data as { role?: string; amo_user_id?: number | null; can_view_all_deals?: boolean } | null
  // API middleware по ролям не режет — калитка та же, что у страницы «Сделки в AmoCRM».
  if (!canAccessRoute(p?.role, '/manager')) return { error: 'Нет доступа к сделкам AmoCRM', status: 403 }
  return {
    userId: user.id,
    isOwner: isOwnerRole(p?.role),
    canViewAll: p?.can_view_all_deals === true,
    amoUserId: p?.amo_user_id ?? null,
  }
}

// Что уже сделано по сделкам в приложении — под RLS вошедшего: видно только то,
// что он и так видит в «Расчётах» и «КП».
export async function linkedWork(leadIds: number[]): Promise<{
  calcs: { id: number; amo_lead_id: number; created_at: string; final_price: number | null; product_type: string | null }[]
  kps: { id: number; amo_lead_id: number; number: string | null; total: number | null; created_at: string }[]
  error: string | null
}> {
  if (leadIds.length === 0) return { calcs: [], kps: [], error: null }
  const supabase = await createClient()
  const [c, k] = await Promise.all([
    supabase.from('calculations').select('id, amo_lead_id, created_at, final_price, product_type')
      .in('amo_lead_id', leadIds).is('archived_at', null).order('created_at', { ascending: false }).limit(500),
    supabase.from('commercial_proposals').select('id, amo_lead_id, number, total, created_at')
      .in('amo_lead_id', leadIds).order('created_at', { ascending: false }).limit(500),
  ])
  const error = c.error?.message ?? k.error?.message ?? null
  return {
    calcs: (c.data ?? []) as { id: number; amo_lead_id: number; created_at: string; final_price: number | null; product_type: string | null }[],
    kps: (k.data ?? []) as { id: number; amo_lead_id: number; number: string | null; total: number | null; created_at: string }[],
    error,
  }
}

// Привязать расчёт или КП к сделке можно, только если она есть и видна вошедшему:
// номер из тела запроса не доверяем, иначе чужая сделка получит «свой» расчёт.
export async function checkLeadAccess(leadId: number): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  if (!Number.isInteger(leadId) || leadId <= 0 || leadId > 2_147_483_647) {
    return { ok: false, error: 'Неверный номер сделки AmoCRM', status: 400 }
  }
  const viewer = await getAmoViewer()
  if ('error' in viewer) return { ok: false, error: viewer.error, status: viewer.status }
  let lead: { responsible_user_id: number } | null
  try {
    lead = await amoGet<{ responsible_user_id: number }>(`/leads/${leadId}`)
  } catch (e) {
    return { ok: false, error: `AmoCRM не ответила, привязка к сделке не проверена: ${(e as Error).message}`, status: 502 }
  }
  if (!lead) return { ok: false, error: `Сделки №${leadId} в AmoCRM нет`, status: 422 }
  if (!canSeeLead(viewer, lead.responsible_user_id)) return { ok: false, error: 'Это сделка другого менеджера', status: 403 }
  return { ok: true }
}

type AmoLeadFull = {
  id: number; name: string; price?: number | null; status_id: number; pipeline_id: number
  responsible_user_id: number; closed_at: number | null
  _embedded?: { contacts?: { id: number; is_main?: boolean }[] }
}

// null — сделки нет. Сбой AmoCRM — исключение: «не найдено» и «CRM не ответила» — разное.
export async function fetchAmoLeadCard(id: number): Promise<AmoLeadCard | null> {
  const lead = await amoGet<AmoLeadFull>(`/leads/${id}`, { with: 'contacts' })
  if (!lead) return null
  const [pipelines, contact] = await Promise.all([
    getPipelines(),
    (async () => {
      const list = lead._embedded?.contacts ?? []
      const mainId = (list.find(c => c.is_main) ?? list[0])?.id
      return mainId ? amoGet<AmoContactRaw>(`/contacts/${mainId}`) : null
    })(),
  ])
  const stage = pipelines.find(p => p.id === lead.pipeline_id)?._embedded.statuses.find(s => s.id === lead.status_id)
  return {
    id: lead.id,
    name: lead.name,
    price: lead.price ?? null,
    stageName: stage?.name ?? null,
    responsibleUserId: lead.responsible_user_id,
    closed: lead.closed_at != null || AMO_CLOSED_STATUSES.has(lead.status_id),
    contactName: (contact?.name || '').trim(),
    phone: amoFieldValue(contact, 'PHONE'),
    url: `https://${getDomain()}/leads/detail/${lead.id}`,
  }
}
