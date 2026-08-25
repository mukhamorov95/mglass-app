import 'server-only'

// Серверная обёртка: ходить на сайты поставщиков можно только с сервера.
// Вся логика разбора — в enrichParse (чистый модуль, покрыт тестами).
export { fetchProductInfo, type ProductInfo } from '@/lib/supplier/enrichParse'
