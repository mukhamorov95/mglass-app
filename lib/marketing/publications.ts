import type { AmoLeadLite } from './channels'

// Реестр публикаций: у каждой публикации на площадке своя ссылка на сайт с UTM.
// utm_campaign = слаг объекта, utm_content = короткий id публикации — по ним
// заявка из amo (форма сайта кладёт utm в поля сделки) находит свою публикацию.

export type Platform = 'site' | 'telegram' | 'vk' | 'dzen' | 'avito' | 'yandex_maps' | 'pinterest' | 'other'

export const PLATFORMS: { key: Platform; label: string; medium: string }[] = [
  { key: 'site', label: 'Сайт (страница объекта)', medium: '' },
  { key: 'telegram', label: 'Telegram-канал', medium: 'social' },
  { key: 'vk', label: 'ВКонтакте', medium: 'social' },
  { key: 'dzen', label: 'Дзен', medium: 'social' },
  { key: 'pinterest', label: 'Pinterest', medium: 'social' },
  { key: 'yandex_maps', label: 'Яндекс Карты', medium: 'maps' },
  { key: 'avito', label: 'Авито', medium: 'classified' },
  { key: 'other', label: 'Другое', medium: 'referral' },
]

export const PUB_STATUS: Record<string, string> = { draft: 'черновик', review: 'на утверждении', published: 'опубликовано' }

export type ContentObject = {
  id: string
  slug: string
  title: string
  product: string | null
  district: string | null
  site: string
  page_url: string | null
  status: 'draft' | 'published'
}

export type Publication = {
  id: string
  object_id: string
  platform: Platform
  url: string | null
  target_url: string
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_content: string | null
  status: 'draft' | 'review' | 'published'
  published_at: string | null
}

export const shortId = (id: string) => id.replace(/-/g, '').slice(0, 8)

// Поля UTM новой публикации. Для «site» меток нет: страница объекта сама и есть цель.
export function utmFor(platform: Platform, objectSlug: string, publicationId: string) {
  if (platform === 'site') return { utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null }
  const p = PLATFORMS.find((x) => x.key === platform)!
  return { utm_source: platform, utm_medium: p.medium, utm_campaign: objectSlug, utm_content: shortId(publicationId) }
}

export function trackedUrl(p: Pick<Publication, 'target_url' | 'utm_source' | 'utm_medium' | 'utm_campaign' | 'utm_content'>): string {
  if (!p.utm_source) return p.target_url
  const u = new URL(p.target_url)
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'] as const) {
    const v = p[k]
    if (v) u.searchParams.set(k, v)
  }
  return u.toString()
}

const fieldOf = (l: AmoLeadLite, name: string) =>
  String(l.custom_fields_values?.find((f) => f.field_name.toLowerCase() === name)?.values?.[0]?.value ?? '').trim().toLowerCase()

// Заявки по публикации: совпали utm_campaign и utm_content. Публикации без меток (сайт) — не считаются.
export function leadsByPublication(leads: AmoLeadLite[], pubs: Publication[]): Map<string, AmoLeadLite[]> {
  const byKey = new Map<string, string>()
  for (const p of pubs) if (p.utm_campaign && p.utm_content) byKey.set(`${p.utm_campaign}|${p.utm_content}`.toLowerCase(), p.id)
  const out = new Map<string, AmoLeadLite[]>()
  for (const l of leads) {
    const id = byKey.get(`${fieldOf(l, 'utm_campaign')}|${fieldOf(l, 'utm_content')}`)
    if (!id) continue
    out.set(id, [...(out.get(id) ?? []), l])
  }
  return out
}

// С какого момента читать заявки amo: день до самой ранней публикации с метками (секунды unix).
export function leadsSince(pubs: Pick<Publication, 'published_at'>[], now = Date.now()): number {
  const t = Math.min(now, ...pubs.map((x) => Date.parse(x.published_at ?? '') || now))
  return Math.floor(t / 1000) - 86400
}
