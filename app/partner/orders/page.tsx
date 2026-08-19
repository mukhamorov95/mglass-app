import OrdersView from '../OrdersView'

// «Заказы в работе» — отправленные в работу и в производстве (с % готовности и сроком).
export default function PartnerOrdersPage() {
  return <OrdersView view="inwork" />
}
