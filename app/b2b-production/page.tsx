import { redirect } from 'next/navigation'

// Причина №5 (убрать дубли контуров): этот экран держал ТРЕТИЙ статус-контур —
// notes.production_status (ручной коарс-статус pending/cutting/tempering/ready/
// shipped), который не читался больше нигде и расходился с detail_stages/
// production_tasks. Живой борд заказов в работе — /production-app/board (строится
// поверх production_tasks, единого источника правды). Экран свёрнут в редирект,
// контур production_status удалён.
export default function B2BProductionRetired() {
  redirect('/production-app/board')
}
