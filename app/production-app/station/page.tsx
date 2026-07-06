import { redirect } from 'next/navigation'

// «Станции» без выбранной станции → открываем Резку (первый этап). Дальше — вкладки станций сверху.
export default function StationIndex() {
  redirect('/production-app/station/cutting')
}
