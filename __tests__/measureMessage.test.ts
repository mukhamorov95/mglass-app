import { describe, it, expect } from 'vitest'
import { buildMeasureMessage, splitScope, tidy, messagePhone, formatMeasureWhen, dayRouteUrl, clientHeadsUpText, whatsAppUrl, buildMeasureResultMessage } from '@/lib/measure/message'

describe('splitScope', () => {
  it('разбирает заявку 0123-4 так, как её ввели 30.09 — «- » и запятые в одну строку', () => {
    const scope = '- Стеклянная Душевая перегородка , - Зеркало в черной алюминиевой раме, - Зеркало в черной алюминиевой раме, зеркало в металической раме, зеркало с подсветкой с отверстиями под смеситель'
    expect(splitScope(scope)).toEqual([
      'Стеклянная Душевая перегородка',
      'Зеркало в черной алюминиевой раме',
      'Зеркало в черной алюминиевой раме',
      'Зеркало в металической раме',
      'Зеркало с подсветкой с отверстиями под смеситель',
    ])
  })

  it('запятая внутри одного изделия не режет его', () => {
    expect(splitScope('Зеркало осветлённое (900×2200 мм), от стены до зелёной зоны.'))
      .toEqual(['Зеркало осветлённое (900×2200 мм), от стены до зелёной зоны'])
  })

  it('тире между числами — не маркер списка', () => {
    expect(splitScope('Зеркало 900 - 2200 мм')).toEqual(['Зеркало 900 - 2200 мм'])
  })

  it('строки, нумерация и точка с запятой', () => {
    expect(splitScope('1. душевая угловая\n2) зеркало с подсветкой; полка стеклянная'))
      .toEqual(['Душевая угловая', 'Зеркало с подсветкой', 'Полка стеклянная'])
  })

  it('пусто — пустой список', () => {
    expect(splitScope(null)).toEqual([])
    expect(splitScope('  \n ')).toEqual([])
  })
})

describe('tidy и телефон', () => {
  it('убирает пробелы внутри скобок и перед запятой', () => {
    expect(tidy('Иван ( НО СВЯЗЬ С ЖЕНОЙ)')).toBe('Иван (НО СВЯЗЬ С ЖЕНОЙ)')
    expect(tidy('корпус 3 , этаж  21')).toBe('корпус 3, этаж 21')
  })

  it('телефон — одной строкой +7…, любой исходный вид', () => {
    expect(messagePhone('8 (900) 123-45-67')).toBe('+79001234567')
    expect(messagePhone('+79001234567')).toBe('+79001234567')
    expect(messagePhone('доб. 100')).toBe('доб. 100')
  })
})

describe('formatMeasureWhen', () => {
  it('время по Москве с концом замера', () => {
    // 09:00 UTC = 12:00 МСК, пятница 2 октября 2026
    expect(formatMeasureWhen('2026-10-02T09:00:00Z', 90)).toBe('пт 2 окт, 12:00–13:30')
  })
})

describe('buildMeasureMessage', () => {
  const base = {
    deal_number: '0123-4',
    client_name: 'Иван ( НО СВЯЗЬ С ЖЕНОЙ)',
    phone: '+79001234567',
    address: 'г Москва жк Пример корпус 3, этаж 21, квартира 138',
    scope: '- Стеклянная Душевая перегородка , - Зеркало в черной алюминиевой раме, зеркало с подсветкой',
    visit_price: 3000,
    payer: 'МГЛАСС',
    is_repeat: false,
  }

  it('ровные блоки: шапка, кто и где, что мерить списком, условия', () => {
    expect(buildMeasureMessage({ ...base, manager_name: 'Яна' })).toBe([
      '📐 ЗАМЕР НОВЫЙ · 0123-4',
      '',
      '👤 Клиент: Иван (НО СВЯЗЬ С ЖЕНОЙ)',
      '📞 Телефон: +79001234567',
      '📍 Адрес: г Москва жк Пример корпус 3, этаж 21, квартира 138',
      '',
      '📏 Что мерить:',
      '1. Стеклянная Душевая перегородка',
      '2. Зеркало в черной алюминиевой раме',
      '3. Зеркало с подсветкой',
      '',
      '💰 Выезд: 3 000 ₽ · платит МГЛАСС',
      '🗓 Когда: не назначено — договориться с клиентом',
      '👔 Менеджер: Яна',
    ].join('\n'))
  })

  it('назначенный замер — дата, время и замерщик', () => {
    const msg = buildMeasureMessage({ ...base, scheduled_at: '2026-10-02T09:00:00Z', duration_min: 90, measurer_name: 'Сергей' })
    expect(msg).toContain('🗓 Когда: пт 2 окт, 12:00–13:30 · Сергей')
  })

  it('одно изделие — в строку с подписью', () => {
    expect(buildMeasureMessage({ ...base, scope: 'Замерить Душевую' })).toContain('📏 Что мерить: Замерить Душевую')
  })

  it('цена выезда не указана — так и пишем, а не «бесплатно»', () => {
    expect(buildMeasureMessage({ ...base, visit_price: 0, payer: null })).toContain('💰 Выезд: цена не указана')
    expect(buildMeasureMessage({ ...base, visit_price: 0, payer: 'включено в договор' })).toContain('💰 Выезд: включено в договор')
  })

  it('повторный замер, примечание и ссылка amo', () => {
    const msg = buildMeasureMessage({ ...base, is_repeat: true, notes: 'домофон 12 , после 18:00', amo_url: 'https://mglass.amocrm.ru/leads/detail/1' })
    expect(msg.startsWith('🔁 ЗАМЕР ПОВТОРНЫЙ · 0123-4')).toBe(true)
    expect(msg).toContain('💬 Примечание: домофон 12, после 18:00')
    expect(msg).toContain('🔗 amoCRM: https://mglass.amocrm.ru/leads/detail/1')
  })
})

describe('день замерщика: маршрут и предупреждение клиента', () => {
  it('маршрут — от текущего места по адресам по порядку, пустые пропускаем', () => {
    const url = dayRouteUrl(['Красногорск, ул Соловьиная 2', null, 'Мытищи'])!
    expect(url.startsWith('https://yandex.ru/maps/?rtext=~')).toBe(true)
    expect(decodeURIComponent(url)).toContain('~Красногорск, ул Соловьиная 2~Мытищи&rtt=auto')
    expect(dayRouteUrl([null, ''])).toBeNull()
  })

  it('текст клиенту: сегодня / завтра / дата, время по Москве', () => {
    const base = { measurer_name: 'Сергей', address: 'ул. Примерная, 1к1', today: '2026-10-02' }
    expect(clientHeadsUpText({ ...base, scheduled_at: '2026-10-02T09:00:00Z' }))
      .toBe('Здравствуйте! Это Сергей, замерщик M-Glass. Буду у вас сегодня в 12:00 по адресу ул. Примерная, 1к1. Если планы поменялись — напишите или позвоните, пожалуйста.')
    expect(clientHeadsUpText({ ...base, scheduled_at: '2026-10-03T07:30:00Z' })).toContain('завтра в 10:30')
    expect(clientHeadsUpText({ ...base, scheduled_at: '2026-10-05T07:30:00Z' })).toContain('пн 5 окт в 10:30')
  })

  it('WhatsApp — номер +7 и текст в ссылке; без номера ссылки нет', () => {
    expect(whatsAppUrl('8 (900) 123-45-67', 'Привет')).toBe('https://wa.me/79001234567?text=%D0%9F%D1%80%D0%B8%D0%B2%D0%B5%D1%82')
    expect(whatsAppUrl(null, 'x')).toBeNull()
  })
})

describe('«Замер готов» для группы', () => {
  it('новый: шапка как тема группы, итог, файлы, цена с поправкой и оплата', () => {
    expect(buildMeasureResultMessage({
      deal_number: '0123-4', client_name: 'Иван', phone: '+79001234567', address: 'Москва, ЖК Пример, кв. 138',
      scope: 'Душевая перегородка\nЗеркало в чёрной раме', is_repeat: false,
      result_note: 'Стена завалена на 15 мм', photos: ['https://x/1.jpg', 'https://x/2.pdf'],
      visit_price: 3000, actual_price: 3500, price_note: 'две душевые', visit_payment: 'onsite',
      scheduled_at: '2026-10-02T09:00:00Z', measurer_name: 'Сергей', manager_name: 'Яна',
    })).toBe([
      '✅ НОВЫЙ ЗАМЕР ГОТОВ · 0123-4',
      '',
      '👤 Клиент: Иван',
      '📞 Телефон: +79001234567',
      '📍 Адрес: Москва, ЖК Пример, кв. 138',
      '',
      '📏 Мерили:',
      '1. Душевая перегородка',
      '2. Зеркало в чёрной раме',
      '',
      '📝 Итог: Стена завалена на 15 мм',
      '📎 Файлы:',
      'https://x/1.jpg',
      'https://x/2.pdf',
      '',
      '💰 Выезд: 3 500 ₽ (менеджер закладывал 3 000 ₽: две душевые) · оплачено замерщику на объекте',
      '🗓 Замер: пт 2 окт, 12:00 · Сергей',
      '👔 Менеджер: Яна',
    ].join('\n'))
  })

  it('повторный — своя шапка; без итога и файлов блок пропускается', () => {
    const msg = buildMeasureResultMessage({ client_name: 'Елена', address: 'Красногорск', scope: 'Душевая', is_repeat: true, visit_price: 0 })
    expect(msg.startsWith('✅ ПОВТОРНЫЙ ЗАМЕР ГОТОВ')).toBe(true)
    expect(msg).not.toContain('📝')
    expect(msg).toContain('💰 Выезд: цена не указана')
  })
})
