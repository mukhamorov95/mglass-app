import ShopBoard from './ShopBoard'
import KanbanScreen from './KanbanScreen'

// Табло цеха (docs/production/SHOP_KANBAN_ROUTE.md): по умолчанию — заказы по этапам, как в amoCRM
// (владелец 25.11.2026); ?view=tasks — поручения (docs/SHOP_BOARD_ROUTE.md).
// ?tv=1 — режим экрана в цеху: крупно, без кнопок, обновляется сам.
export default async function ShopBoardPage({ searchParams }: { searchParams: Promise<{ tv?: string; view?: string }> }) {
  const sp = await searchParams
  const tv = sp.tv === '1'
  return sp.view === 'tasks' ? <ShopBoard tv={tv} /> : <KanbanScreen tv={tv} />
}
