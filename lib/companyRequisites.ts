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

// НДС включён в сумму: выделяем из итога (ставка 5% → total * 5/105).
export function vatIncluded(total: number, rate = EXECUTOR.vatRate): number {
  return Math.round((total * rate / (100 + rate)) * 100) / 100
}
