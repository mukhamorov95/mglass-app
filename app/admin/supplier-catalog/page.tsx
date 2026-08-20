import { SupplierCatalogClient } from './SupplierCatalogClient'

export const metadata = { title: 'Справочник поставщиков — M-Glass' }

// Общий справочник цен поставщиков (Ветро, АВ24, …): позиции, цвета, розница,
// скидка → себестоимость. Единый источник цен для калькуляторов. Доступ — owner-tier.
export default function Page() {
  return <SupplierCatalogClient />
}
