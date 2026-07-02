import { EXECUTOR } from './companyRequisites'

// Платёжный QR по ГОСТ Р 56042 (ST00012) — реквизиты Исполнителя + сумма/назначение.
// Сканируется банковскими приложениями. Sum — в копейках.
export function paymentQrString(sum: number, purpose: string): string {
  const sumKop = Math.round((sum || 0) * 100)
  return [
    'ST00012',
    `Name=${EXECUTOR.name}`,
    `PersonalAcc=${EXECUTOR.account}`,
    `BankName=${EXECUTOR.bankName}`,
    `BIC=${EXECUTOR.bik}`,
    `CorrespAcc=${EXECUTOR.corrAccount}`,
    `PayeeINN=${EXECUTOR.inn}`,
    `Sum=${sumKop}`,
    `Purpose=${purpose}`.slice(0, 210),
  ].join('|')
}
