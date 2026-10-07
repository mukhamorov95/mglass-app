import { redirect } from 'next/navigation'

// «Мой день» (сделки приложения: 3 за 30 дней) дублировал «Утро» на главной —
// убран из меню 08.10, старые ссылки ведут на главную. Блок «Расчёты без клиента»
// переехал туда же (components/OrphanCalcs.tsx).
export default function MyDayRedirect() {
  redirect('/')
}
