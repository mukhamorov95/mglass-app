import OrdersView from '../OrdersView'

// «Мои просчёты» — сохранённые расчёты (черновики) и отправленные на согласование.
export default function PartnerQuotesPage() {
  return <OrdersView view="quotes" />
}
