// Реквизиты Исполнителя (наши) — единственное место правки. Подставляются в договор и счёт.
// Извлечены из шаблонов Договор/Счёт №0157-0.

export const EXECUTOR = {
  name: 'ИП Мухаморов Владислав Сергеевич',
  nameShort: 'ИП Мухаморов В.С.',
  fio: 'Мухаморов Владислав Сергеевич',
  fioShort: 'Мухаморов В.С.',
  ogrnip: '319502700094848',
  inn: '668505859957',
  phone: '+7 (925) 933 50 33',
  legalAddress: 'Москва, ул. Кольская 8 к2, кв 204',
  account: '40802810102890006855',
  bankName: 'АО «АЛЬФА-БАНК», МОСКВА',
  bik: '044525593',
  corrAccount: '30101810200000000593',
  vatRate: 5,            // НДС 5% с 01.12.2025
  warrantyMonths: 18,
} as const

// Реквизиты Продавца для B2B (оптовое стекло листами) — отдельное юрлицо ООО, НДС 22%.
// Розница идёт от ИП (EXECUTOR, НДС 5%), опт — от ООО. Источник: карточка предприятия + Счёт-спецификация №04872.
export const SELLER_B2B = {
  name: 'ООО «МЕТАЛ & ГЛАС МАНУФАКТУР»',
  nameFull: 'ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ «МЕТАЛ & ГЛАС МАНУФАКТУР»',
  director: 'Мухаморов Владислав Сергеевич',
  directorGenitive: 'Мухаморова Владислава Сергеевича',
  inn: '7716986980',
  kpp: '771601001',
  ogrn: '1237700622246',
  phone: '+7 (925) 933 50 33',
  email: 'mglass.ceo@gmail.com',
  site: 'mglass.pro',
  legalAddress: '129329, Москва, ул. Кольская, д.8, к.2, кв.204',
  account: '40702810701300039842',
  bankName: 'АО «АЛЬФА-БАНК»',
  bik: '044525593',
  corrAccount: '30101810200000000593',
  vatRate: 22,
} as const

// Обобщённая форма продавца для платёжного QR / реквизитов.
export type SellerRequisites = {
  name: string; account: string; bankName: string; bik: string; corrAccount: string; inn: string
}

// НДС включён в сумму: выделяем из итога (по умолчанию 5% → total * 5/105; для B2B передавать 22).
export function vatIncluded(total: number, rate = EXECUTOR.vatRate): number {
  return Math.round((total * rate / (100 + rate)) * 100) / 100
}
