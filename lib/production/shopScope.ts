import { isMGlassClient } from '@/lib/b2bScope'

// Цех глазами розницы (docs/nav/NAV_CONTOURS_ROUTE.md, Н2): розничный заказ приходит в цех
// B2B-заказом клиента M GLASS, поэтому «Производство» контура M-Glass — те же экраны цеха
// с фильтром ?client=mglass. Это вид, а не право: доступ к экранам решает production-app/layout.

export type ShopScope = 'mglass' | null

export const shopScopeOf = (v: string | null | undefined): ShopScope => (v === 'mglass' ? 'mglass' : null)

export function inShopScope(scope: ShopScope, o: { client_id?: number | null; client_name?: string | null }): boolean {
  return scope !== 'mglass' || isMGlassClient({ id: o.client_id ?? null, name: o.client_name ?? null })
}

export function withShopScope(href: string, scope: ShopScope): string {
  if (!scope) return href
  return `${href}${href.includes('?') ? '&' : '?'}client=${scope}`
}
