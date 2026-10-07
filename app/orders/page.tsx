import { redirect } from 'next/navigation'

// Список «Заказы» (таблица orders) убран из меню 08.10: одна строка с 13.05,
// заказы живут в /b2b-orders. Карточка /orders/[id] остаётся — на неё ведут
// «Запустить заказ →» из «Расчётов» и карточка клиента.
export default function OrdersRedirect() {
  redirect('/b2b-orders')
}
