import { redirect } from 'next/navigation'

// Остатки переехали в раздел «Склад»: там журнал движений, а не редактируемое
// поле в справочнике материалов. Один источник правды.
export default function WarehouseRedirect() {
  redirect('/inventory')
}
