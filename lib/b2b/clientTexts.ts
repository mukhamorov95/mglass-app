// Готовые тексты клиенту для кнопок «📋» в «Мой день · B2B» и карточке сделки (маршрут
// docs/SYSTEM_ORDER_ROUTE.md, этап 3). Менеджер копирует и отправляет сам — приложение
// никому ничего не шлёт. Внутреннего (себестоимость, маржа, этапы цеха) здесь нет по построению.

const rub = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`

const dayRu = (day: string | null | undefined): string | null => {
  if (!day || !/^\d{4}-\d{2}-\d{2}/.test(day)) return null
  return `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`
}

export const READY_TEXT_LABEL = '📋 Текст: готов к выдаче'
export const QUOTE_REMINDER_LABEL = '📋 Напомнить о КП'
export const PAYMENT_REMINDER_LABEL = '📋 Напомнить об оплате'

export function readyForPickupText(o: { ref: string; delivery?: string | null }): string {
  const out = ['Здравствуйте!', `Ваш заказ № ${o.ref} готов и упакован.`]
  if (o.delivery === 'delivery') out.push('Подскажите, когда удобно принять доставку, — согласуем день и время.')
  else out.push('Забрать можно в Мытищах. Подскажите, когда вам удобно приехать или нужна доставка, — согласуем день.')
  return out.join('\n')
}

export function quoteReminderText(o: { ref: string; amount: number; day?: string | null }): string {
  const date = dayRu(o.day)
  return [
    'Здравствуйте!',
    `Напоминаю о нашем расчёте № ${o.ref}${date ? ` от ${date}` : ''} на ${rub(o.amount)}.`,
    'Предложение актуально? Если нужно что-то поменять — размеры, количество, обработку, — пересчитаю.',
    'Как будете готовы — напишите, запустим в работу.',
  ].join('\n')
}

// Счёт может объединять несколько заказов; без счёта — напоминание по одному заказу.
export function paymentReminderText(o: { invoiceNo?: string | null; orderRefs: string[]; total: number; paid?: number }): string {
  const refs = o.orderRefs.filter(Boolean)
  const what = o.invoiceNo
    ? `Напоминаю об оплате счёта № ${o.invoiceNo}${refs.length ? ` (${refs.length > 1 ? 'заказы' : 'заказ'} № ${refs.join(', ')})` : ''}.`
    : `Напоминаю об оплате заказа № ${refs[0] ?? '—'}.`
  const paid = Math.max(0, o.paid ?? 0)
  const sum = paid > 0 && paid < o.total
    ? `Оплачено ${rub(paid)}, осталось ${rub(o.total - paid)}.`
    : `Сумма к оплате — ${rub(o.total)}.`
  return [
    'Здравствуйте!',
    what,
    sum,
    'Если платёж уже отправлен — пришлите, пожалуйста, платёжное поручение, чтобы мы быстрее его нашли.',
  ].join('\n')
}
