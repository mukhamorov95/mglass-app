import { EXECUTOR, type SellerRequisites } from './companyRequisites'

// Платёжный QR по ГОСТ Р 56042 (ST00012) — реквизиты продавца + сумма/назначение.
// Сканируется банковскими приложениями. Sum — в копейках.
export function paymentQrStringFor(seller: SellerRequisites, sum: number, purpose: string): string {
  const sumKop = Math.round((sum || 0) * 100)
  return [
    'ST00012',
    `Name=${seller.name}`,
    `PersonalAcc=${seller.account}`,
    `BankName=${seller.bankName}`,
    `BIC=${seller.bik}`,
    `CorrespAcc=${seller.corrAccount}`,
    `PayeeINN=${seller.inn}`,
    `Sum=${sumKop}`,
    `Purpose=${purpose}`.slice(0, 210),
  ].join('|')
}

// Обратная совместимость: QR от Исполнителя-ИП (розница).
export function paymentQrString(sum: number, purpose: string): string {
  return paymentQrStringFor(EXECUTOR, sum, purpose)
}
