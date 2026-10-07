import { redirect } from 'next/navigation'

// Воронка перетаскиванием меняла notes.status без даты запуска и без задач цеху: заказ,
// брошенный в «В производстве», пропадал из цеха (этап 8 docs/SYSTEM_ORDER_ROUTE.md).
// Запуск — только через «Просчёты» и карточку сделки (lib/b2b/launchOrder.ts).
export default function B2BPipelineRetired() {
  redirect('/b2b-quotes')
}
