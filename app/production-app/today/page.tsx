import { redirect } from 'next/navigation'

// «Пул на сегодня» слит в единый обзор цеха (П6): он отвечал на тот же вопрос
// «что сейчас в цеху», что борд и панель производства. Срез по станциям переехал
// туда же. Редирект оставлен сознательно — на этот адрес ссылается дашборд CEO
// (app/ceo/MoneyPulse.tsx), ломать чужую ссылку нельзя.
export default function TodayMergedIntoBoard() {
  redirect('/production-app/board')
}
