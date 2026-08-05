import OrdersView from './OrdersView'

// Табло + все заказы (обзор). Просчёты и Заказы — отдельными пунктами меню
// (/partner/quotes, /partner/orders) через тот же OrdersView с фильтром.
export default function PartnerPage() {
  return <OrdersView view="all" />
}
