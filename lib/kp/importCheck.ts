// Проверка КП, собранного из чужого файла. Модель читает документ, сделанный по
// другой структуре, — часть цифр она может не найти или прочитать неверно.
// Молча подгонять их нельзя: менеджер отправит это клиенту. Поэтому расхождения
// показываем словами и числами, а решает человек.

import { kpNum } from '@/lib/kpReconcile'

export type ImportedItem = { name?: unknown; qty?: unknown; price?: unknown; sum?: unknown }
export type ImportedKp = { items?: unknown; total?: unknown; subtotal?: unknown; title?: unknown; client_name?: unknown }

const rub = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'

// Что доложил reconcileKp за нас. Он закрывает единственную пустую строку
// разницей до итога и подставляет пропавший итог суммой строк — обе правки
// разумные, но менеджер должен знать, что это не из файла.
export function kpReconcileNotes(raw: ImportedKp, fixed: ImportedKp): string[] {
  const out: string[] = []
  const a = Array.isArray(raw.items) ? (raw.items as ImportedItem[]) : []
  const b = Array.isArray(fixed.items) ? (fixed.items as ImportedItem[]) : []
  for (let i = 0; i < a.length && i < b.length; i++) {
    const before = kpNum(a[i].sum), after = kpNum(b[i].sum)
    if ((!isFinite(before) || before === 0) && isFinite(after) && after !== 0) {
      out.push(`«${String(a[i].name ?? '').trim() || 'Строка без названия'}» в файле без суммы — поставили разницу до итога, ${rub(after)}. Проверьте.`)
    }
  }
  const rawTotal = kpNum(raw.total), fixedTotal = kpNum(fixed.total)
  if ((!isFinite(rawTotal) || rawTotal === 0) && isFinite(fixedTotal) && fixedTotal !== 0) {
    out.push(`Итог в файле не прочитался — поставили сумму строк, ${rub(fixedTotal)}.`)
  }
  return out
}

export function kpImportWarnings(kp: ImportedKp): string[] {
  const out: string[] = []
  const items = Array.isArray(kp.items) ? (kp.items as ImportedItem[]) : []
  if (!items.length) {
    out.push('В файле не нашлись позиции сметы — добавьте строки вручную.')
    return out
  }

  const noSum = items.filter(it => !isFinite(kpNum(it.sum)) || kpNum(it.sum) === 0)
  if (noSum.length) {
    const names = noSum.map(it => String(it.name ?? '').trim() || 'без названия').slice(0, 3).join(', ')
    out.push(`Без суммы ${noSum.length === 1 ? 'строка' : 'строк'} ${noSum.length}: ${names}${noSum.length > 3 ? '…' : ''}.`)
  }

  const lines = items.reduce((s, it) => s + (isFinite(kpNum(it.sum)) ? kpNum(it.sum) : 0), 0)
  const total = kpNum(kp.total)
  if (!isFinite(total) || total === 0) {
    out.push(`Итог в файле не прочитался. Сумма строк — ${rub(lines)}.`)
  } else if (Math.abs(total - lines) >= 1) {
    const diff = total - lines
    out.push(`Сумма строк ${rub(lines)}, а итог в файле ${rub(total)} — расхождение ${rub(Math.abs(diff))}${diff > 0 ? ' (в файле больше)' : ' (в файле меньше)'}. Проверьте, не потерялась ли строка.`)
  }

  if (!String(kp.title ?? '').trim()) out.push('Заголовок не прочитался — впишите тип изделия.')
  return out
}
