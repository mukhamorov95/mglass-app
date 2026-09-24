// Текст и лимиты рассылки — отдельно от движка: экран клиентский, а reviewCampaign
// тянет service-role клиент и AmoCRM. Импорт оттуда утащил бы серверный ключ в браузер.

export const REVIEW_URL = 'https://yandex.ru/maps/org/mglass_ru/160929264216/reviews/'

// WhatsApp блокирует номер за массовую отправку, а вместе с номером уезжает вся
// переписка с клиентами. Поэтому порция в день, а не «разослать всем».
export const DAILY_LIMIT = 25
export const MIN_GAP_MS  = 40_000

const MONTHS = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря']

function firstName(full?: string | null): string {
  const n = (full ?? '').trim().split(/\s+/)[0]
  // В Amo имя клиента нередко записано телефоном или номером заказа — тогда без имени
  return /^[А-ЯЁA-Z][а-яёa-z-]{1,}$/.test(n) ? n : ''
}

export function buildMessage(name?: string | null, doneAt?: string | null): string {
  const who = firstName(name)
  const hello = who ? `Здравствуйте, ${who}!` : 'Здравствуйте!'
  const when = doneAt ? ` в ${MONTHS[new Date(doneAt).getMonth()]}` : ''
  return [
    `${hello} Это M GLASS — мы делали вам изделие${when}. Как оно, всё в порядке, ничего не беспокоит?`,
    '',
    'Мы сейчас кропотливо собираем отзывы о своей работе. Если есть что сказать хорошего — оставьте, пожалуйста, отзыв на нашей странице в Яндексе, это пара минут:',
    REVIEW_URL,
    '',
    'За отзыв закрепим за вами скидку 15% на следующий заказ. Если приложите фото — будет совсем здорово.',
  ].join('\n')
}

export function normalizePhone(raw: string): string {
  let d = (raw || '').replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('8')) d = '7' + d.slice(1)
  else if (d.length === 10) d = '7' + d
  return d
}
