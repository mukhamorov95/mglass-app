import type { B2BService } from '@/lib/types'

// Доп. работы в калькуляторе кабинета — те же строки справочника b2b_services, что у
// менеджера. Только простые типы: «рассчитываемые» услуги нужны настройки цеха, плёнке —
// выбор плёнки; триплекс у кабинета свой переключатель. Себестоимость наружу не идёт.
// Сверка 24.11.2026: менеджеры Шовер Гласс за 90 дней ставили вектор, «непрямоугольную
// форму», Т/Г-образные и пескоструй — без них цена кабинета была ниже нашей.

export type PartnerService = { id: number; name: string; type: 'percent' | 'per_m2' | 'fixed'; value: number }

const TYPES = new Set(['percent', 'per_m2', 'fixed'])

export function isPartnerService(s: Pick<B2BService, 'type' | 'name' | 'active'>): boolean {
  return s.active !== false && TYPES.has(s.type) && !/триплекс/i.test(s.name)
}

export function publicServices(all: B2BService[]): PartnerService[] {
  return all.filter(isPartnerService).map(s => ({ id: s.id, name: s.name, type: s.type as PartnerService['type'], value: Number(s.value) || 0 }))
}

export function pickServices(all: B2BService[], ids: unknown): B2BService[] {
  const want = new Set((Array.isArray(ids) ? ids : []).map(Number).filter(n => Number.isInteger(n) && n > 0))
  return all.filter(s => want.has(s.id) && isPartnerService(s))
}

export const serviceIdsOf = (item: { services?: unknown }): number[] =>
  (Array.isArray(item.services) ? item.services as { id?: unknown }[] : [])
    .map(s => Number(s.id)).filter(n => Number.isInteger(n) && n > 0)
