// Номер заказа и сумма в кабинете клиента — так же, как в его документах (КП, счёт, УПД:
// custom_number или id до 5 знаков). 24.11.2026 один заказ был «#5849», «005849» и «05849».
export const partnerOrderNo = (o: { id: number; custom_number?: string | null }): string =>
  o.custom_number?.trim() || String(o.id).padStart(5, '0')

// Суммы в списках — в рублях без копеек (копейки — только в документах и акте сверки).
export const rub = (n: number): string => `${Math.round(n).toLocaleString('ru-RU')} ₽`

// Номер с экрана цеха («00» + id, если своего номера нет) → номер как в документах клиента.
export const fromShopNo = (id: number, shopNo: string): string =>
  shopNo === `00${id}` ? partnerOrderNo({ id }) : shopNo
