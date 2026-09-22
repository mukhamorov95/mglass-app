import 'server-only'
import { getUsers, type AmoUser } from '@/lib/amocrm'
import { createServiceClient } from '@/lib/supabase-service'

// Имя человека, а не имя учётки amo. Учётки в amo переименовывали при смене людей, и сейчас
// расходятся: amo «Алина» — это Айжан, amo «Дима» — Дмитрий (владелец подтвердил 22.09.2026).
// На экранах показываем имя из приложения (users.name по amo_user_id), в подсказке — как
// учётка называется в amo, иначе не сверить с самим amo.
//
// Service-role здесь читает ТОЛЬКО имена сотрудников и их amo_user_id — ни денег, ни клиентов.
// Все, кто это зовёт, стоят за проверкой роли: /api/commercial/* (requireRole), /api/manager/coaching
// (getRole), /api/cron/* (свой секрет).

export type AmoPerson = { id: number; name: string; amoName: string; appName: string | null }

let cache: { at: number; people: AmoPerson[] } | null = null
const TTL = 5 * 60 * 1000

export async function getAmoPeople(): Promise<AmoPerson[]> {
  if (cache && Date.now() - cache.at < TTL) return cache.people
  const amo: AmoUser[] = await getUsers()
  const { data, error } = await createServiceClient()
    .from('users')
    .select('name, amo_user_id')
    .not('amo_user_id', 'is', null)
  if (error) console.error('[amoPeople] не прочитать имена сотрудников:', error.message)
  // Служебное имя учётки («Администратор») человека не называет — тогда оставляем имя из amo
  const GENERIC = /^(админ|administrator|admin|менеджер|user|пользователь)/i
  const appByAmo = new Map<number, string>()
  for (const u of data ?? []) {
    if (!u.amo_user_id || !u.name || GENERIC.test(String(u.name).trim())) continue
    appByAmo.set(Number(u.amo_user_id), String(u.name))
  }

  const people = amo.map(u => ({ id: u.id, name: appByAmo.get(u.id) ?? u.name, amoName: u.name, appName: appByAmo.get(u.id) ?? null }))
  cache = { at: Date.now(), people }
  return people
}

// Для мест, где нужен привычный список {id, name} с именем человека
export const getAmoUserNames = async () => (await getAmoPeople()).map(p => ({ id: p.id, name: p.name }))

// «Айжан (в amo «Алина»)» — когда важно показать обе стороны
export const withAmoName = (p: AmoPerson) => (p.appName && p.appName !== p.amoName ? `${p.appName} (в amo «${p.amoName}»)` : p.name)
