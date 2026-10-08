import ShopBoard from './ShopBoard'

// Табло цеха — поручения по заказам, которые видят цех и менеджеры (docs/SHOP_BOARD_ROUTE.md).
// ?tv=1 — режим экрана в цеху: крупно, без кнопок, обновляется сам.
export default async function ShopBoardPage({ searchParams }: { searchParams: Promise<{ tv?: string }> }) {
  const sp = await searchParams
  return <ShopBoard tv={sp.tv === '1'} />
}
