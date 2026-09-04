import { redirect } from 'next/navigation'

// «Сделки» — это доска. Списка больше нет (владелец: оставить только доску),
// но маршрут остаётся: на /deals ведёт меню и все старые ссылки.
export default function DealsPage() {
  redirect('/deals/board')
}
