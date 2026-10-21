// Чья выписка — по номеру нашего счёта: 40802… — счёт ИП, 40702… — коммерческой организации (ООО).
// 21.10 выписку ООО загрузили под переключателем ИП: 105 строк легли в ИП, 4 провелись в его ДДС.

export type BankUnit = 'ip' | 'ooo'

const LABEL: Record<BankUnit, string> = { ip: 'ИП', ooo: 'ООО' }

export function unitOfAccount(account: string | null | undefined): BankUnit | null {
  const a = (account ?? '').replace(/\D/g, '')
  if (a.startsWith('40802')) return 'ip'
  if (a.startsWith('40702')) return 'ooo'
  return null
}

// Текст отказа, если хоть один наш счёт в выписке чужой выбранному переключателю; неизвестный счёт не мешает
export function unitMismatch(accounts: string[], unit: BankUnit): string | null {
  for (const acc of accounts) {
    const real = unitOfAccount(acc)
    if (real && real !== unit) {
      return `Это выписка счёта ${LABEL[real]} (${acc}), а выбрано ${LABEL[unit]}. Переключите на ${LABEL[real]} и загрузите снова`
    }
  }
  return null
}
