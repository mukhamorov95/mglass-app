// Текст и лимиты рассылки — отдельно от движка: экран клиентский, а reviewCampaign
// тянет service-role клиент и AmoCRM. Импорт оттуда утащил бы серверный ключ в браузер.

export const REVIEW_URL = 'https://yandex.ru/maps/org/mglass_ru/160929264216/reviews/'

// WhatsApp блокирует номер за массовую отправку, а вместе с номером уезжает вся
// переписка с клиентами. Поэтому порция в день, а не «разослать всем».
export const DAILY_LIMIT = 25
export const MIN_GAP_MS  = 40_000

// Сервер Vercel живёт в UTC: setHours(0) дал бы «сутки» с 03:00 по Москве
export function mskMidnightIso(now = Date.now()): string {
  const d = new Date(now + 3 * 3600_000)
  d.setUTCHours(0, 0, 0, 0)
  return new Date(d.getTime() - 3 * 3600_000).toISOString()
}

const MONTHS = ['январе','феврале','марте','апреле','мае','июне','июле','августе','сентябре','октябре','ноябре','декабре']

function firstName(full?: string | null): string {
  const n = (full ?? '').trim().split(/\s+/)[0]
  // В Amo имя клиента нередко записано телефоном или номером заказа — тогда без имени
  return /^[А-ЯЁA-Z][а-яёa-z-]{1,}$/.test(n) ? n : ''
}

export function buildMessage(name?: string | null, doneAt?: string | null): string {
  const who = firstName(name)
  const hello = who ? `Здравствуйте, ${who}!` : 'Здравствуйте!'
  const when = doneAt ? ` в ${MONTHS[new Date(doneAt).getMonth()]}` : ''
  // Без скидки за отзыв и без «если есть что сказать хорошего»: Яндекс снимает отзывы,
  // если за них обещают скидку, просят показать отзыв или подсказывают оценку
  // (yandex.ru/support/business-priority/ru/reviews/get-and-promote, проверено 05.10).
  return [
    `${hello} Это M GLASS — мы делали вам изделие${when}. Как оно, всё в порядке, ничего не беспокоит?`,
    '',
    'Будем благодарны за честный отзыв о нашей работе на странице в Яндексе — это пара минут:',
    REVIEW_URL,
    '',
    'Если приложите фото изделия — будет совсем здорово.',
  ].join('\n')
}

export function normalizePhone(raw: string): string {
  let d = (raw || '').replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('8')) d = '7' + d.slice(1)
  else if (d.length === 10) d = '7' + d
  return d
}
