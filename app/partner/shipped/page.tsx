import OrdersView from '../OrdersView'

// «Отгруженные заказы» — завершённые заказы клиента.
export default function PartnerShippedPage() {
  return <OrdersView view="shipped" />
}
