// Поиск с любого экрана (У4): разбор запроса и сборка групп ответа. Чистые функции —
// сеть и права в /api/search, запрос к базе — функция app_search.

// Кнопка «Поиск» в меню открывает окно этим событием.
export const SEARCH_OPEN_EVENT = 'mg:search-open'

export type SearchItem = { id: string; title: string; subtitle: string; href: string; amount?: number | null }
export type SearchGroup = { key: 'orders' | 'clients' | 'deals' | 'calcs'; title: string; items: SearchItem[] }
export type QuickAction = { label: string; href: string }

// Текст для ilike без подстановочных знаков; цифры — отдельно, для номеров и телефонов.
// «+7 (926) 418-69-72» → digits «9264186972»: в deals.phone_key номер хранится без 7/8.
export function parseQuery(raw: string): { q: string; digits: string } {
  const text = raw.trim().slice(0, 60)
  const q = text.replace(/[%_\\]/g, '').replace(/\s+/g, ' ').trim()
  const compact = text.replace(/[\s()+\-#№.]/g, '')
  let digits = /^\d+$/.test(compact) ? compact : ''
  if (digits.length === 11 && (digits[0] === '7' || digits[0] === '8')) digits = digits.slice(1)
  return { q, digits }
}

type OrderRow = { id: number; custom_number: string | null; client_name: string | null; launched_at: string | null; total: number | null }
type ClientRow = { id: number; name: string | null; inn: string | null; phone: string | null }
type DealRow = { id: number; client_name: string | null; phone: string | null; amo_lead_id: string | null }
type CalcRow = { id: number; client_name: string | null; client_phone: string | null; order_number: string | null; deal_id: number | null; status: string | null; created_at: string }
export type SearchPayload = { orders?: OrderRow[]; clients?: ClientRow[]; deals?: DealRow[]; calcs?: CalcRow[] }

const dateRu = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })

export function toGroups(p: SearchPayload | null | undefined, canOpenDeal: boolean): SearchGroup[] {
  const groups: SearchGroup[] = [
    {
      key: 'orders', title: 'Заказы и просчёты B2B',
      items: (p?.orders ?? []).map(o => ({
        id: `o${o.id}`,
        title: `${o.custom_number || `#${o.id}`} · ${o.client_name || 'без клиента'}`,
        subtitle: o.launched_at ? 'заказ' : 'просчёт',
        href: `/b2b-deal/${o.id}`,
        amount: o.total,
      })),
    },
    {
      key: 'clients', title: 'Клиенты B2B',
      items: (p?.clients ?? []).map(c => ({
        id: `c${c.id}`,
        title: c.name || `Клиент #${c.id}`,
        subtitle: [c.inn && `ИНН ${c.inn}`, c.phone].filter(Boolean).join(' · '),
        href: `/b2b-crm/${c.id}`,
      })),
    },
    {
      key: 'deals', title: 'Сделки',
      items: (p?.deals ?? []).map(d => ({
        id: `d${d.id}`,
        title: d.client_name || `Сделка #${d.id}`,
        subtitle: [d.phone, d.amo_lead_id && `AmoCRM ${d.amo_lead_id}`].filter(Boolean).join(' · '),
        href: `/deal/${d.id}`,
      })),
    },
    {
      key: 'calcs', title: 'Расчёты',
      items: (p?.calcs ?? []).map(c => ({
        id: `r${c.id}`,
        title: c.client_name || `Расчёт #${c.id}`,
        subtitle: [c.order_number && `№ ${c.order_number}`, dateRu(c.created_at), c.deal_id ? 'в сделке' : 'без сделки'].filter(Boolean).join(' · '),
        href: c.deal_id && canOpenDeal ? `/deal/${c.deal_id}` : `/calculations/${c.id}`,
      })),
    },
  ]
  return groups.filter(g => g.items.length > 0)
}

// Что предложить при пустом запросе — только разделы, открытые этой роли.
const ACTIONS: QuickAction[] = [
  { label: 'Новый просчёт B2B', href: '/calculator/b2b' },
  { label: 'Новый расчёт', href: '/calculator/build' },
  { label: 'Мой день · B2B', href: '/b2b-today' },
  { label: 'Мой день', href: '/my-day' },
  { label: 'B2B Просчёты', href: '/b2b-quotes' },
  { label: 'B2B Заказы', href: '/b2b-orders' },
  { label: 'Сделки', href: '/deals' },
]
export function quickActions(can: (path: string) => boolean): QuickAction[] {
  return ACTIONS.filter(a => can(a.href)).slice(0, 6)
}
