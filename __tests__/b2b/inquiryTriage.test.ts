import { describe, it, expect } from 'vitest'
import {
  extractVolume, tierOf, specGaps, buildTriage, triageLine, STARTER_THRESHOLDS,
} from '@/lib/b2b/inquiryTriage'

// Оракул — настоящие сообщения из чатов кабинета GLASMEN, прочитанные 27.11.2026.
// Тексты обезличены: имён и адресов тут нет, только то, что клиент просит сделать.
const CHATS = {
  partiya: 'В таких стёклах нужно просверлить отверстие внизу, так же как сверху. 224 шт',
  polki: 'Сколько будет стоить нарезка стекла следующих размеров: Полки (9шт) 768х150мм. Дверки (2шт) 1413х380мм. Никакая фурнитура не требуется.',
  zerkala: 'Добрый день подскажите пожалуйста сколько будет стоить изготовление 10 зеркал диаметром 139мм. Толщина 1.5мм',
  tri: 'Здраствуйте 142.5 на 53 1шт 142.5 на 57 1ш т 102 на 57 1шт Нужно 3 стекла Скажите стоимость и где забирать?',
  korotko: 'стекло 4мм режете?',
  dveri: 'У вас есть матовые стекла на двери? Межкомнатные',
  ograzhdenie: 'Нужна замена треснувшего стекла в ограждении лестницы. Размер примерно: 1000 × 500 мм. Толщина: 8 мм обычное стекло с полировкой кромки / еврокромкой',
}

describe('extractVolume — числа берутся только из написанного', () => {
  it('«224 шт» — партия одной строкой', () => {
    expect(extractVolume(CHATS.partiya).units).toBe(224)
  })

  it('«Полки (9шт) … Дверки (2шт)» — детали складываются', () => {
    expect(extractVolume(CHATS.polki).units).toBe(11)
  })

  it('«10 зеркал» без слова «шт» — число перед изделием', () => {
    expect(extractVolume(CHATS.zerkala).units).toBe(10)
  })

  it('«1шт 1шт 1шт» — три отдельные детали, а не три заказа по одной', () => {
    expect(extractVolume(CHATS.tri).units).toBe(3)
  })

  it('количество не названо — null, а не 0: «ноль штук» и «не знаем» это разное', () => {
    expect(extractVolume(CHATS.korotko).units).toBeNull()
    expect(extractVolume(CHATS.dveri).units).toBeNull()
  })

  it('размеры: считает пары и самую длинную сторону в мм', () => {
    const v = extractVolume(CHATS.polki)
    expect(v.sizesCount).toBe(2)
    expect(v.maxSideMm).toBe(1413)
  })

  it('сантиметры с дробью переводятся в мм: «142.5 на 53» → 1425', () => {
    const v = extractVolume(CHATS.tri)
    expect(v.sizesCount).toBe(3)
    expect(v.maxSideMm).toBe(1425)
  })

  it('«1000 × 500 мм» — целые числа остаются миллиметрами', () => {
    expect(extractVolume(CHATS.ograzhdenie).maxSideMm).toBe(1000)
  })
})

describe('tierOf — уровень из чисел и порогов, без модели', () => {
  it('224 шт при стартовых порогах — крупное', () => {
    expect(tierOf(224)).toBe('large')
  })

  it('11 шт — партия, 3 шт — мелочь', () => {
    expect(tierOf(11)).toBe('batch')
    expect(tierOf(3)).toBe('small')
  })

  it('ровно на пороге — уже партия и уже крупное', () => {
    expect(tierOf(STARTER_THRESHOLDS.batchFrom)).toBe('batch')
    expect(tierOf(STARTER_THRESHOLDS.largeFrom)).toBe('large')
  })

  it('пороги владельца меняют уровень, код не трогается', () => {
    expect(tierOf(11, { batchFrom: 30, largeFrom: 200 })).toBe('small')
    expect(tierOf(224, { batchFrom: 30, largeFrom: 200 })).toBe('large')
  })

  it('объём не назван — «small», а не «large по подозрению»', () => {
    expect(tierOf(null)).toBe('small')
  })
})

describe('specGaps — чего не хватает для просчёта', () => {
  it('«стекло 4мм режете?» — есть толщина, нет размеров, кромки и количества', () => {
    const t = CHATS.korotko
    expect(specGaps(t, extractVolume(t))).toEqual(['sizes', 'edge', 'count'])
  })

  it('ни один из семи ждущих чатов не полон — иначе этап В4 не нужен', () => {
    for (const [name, text] of Object.entries(CHATS)) {
      expect(specGaps(text, extractVolume(text)).length, name).toBeGreaterThan(0)
    }
  })

  it('полное ТЗ не даёт пропусков', () => {
    const full = 'Нужно 4 шт 800х600 мм, толщина 8 мм, кромка полированная'
    expect(specGaps(full, extractVolume(full))).toEqual([])
  })
})

describe('buildTriage — мнение модели не двигает уровень', () => {
  it('модель говорит «производство», но чисел нет — уровень остаётся мелким', () => {
    const t = buildTriage(CHATS.dveri, { segment: 'manufacturer', repeat: 'repeat' })
    expect(t.segment).toBe('manufacturer')
    expect(t.tier).toBe('small')
    expect(t.reason).toContain('не названо')
  })

  it('мусор от модели сводится к «не ясно» и «неизвестно»', () => {
    const t = buildTriage(CHATS.partiya, { segment: 'ооо-ромашка', repeat: 42 })
    expect(t.segment).toBe('unclear')
    expect(t.repeat).toBe('unknown')
    expect(t.tier).toBe('large')
  })

  it('без мнения модели светофор всё равно считается', () => {
    const t = buildTriage(CHATS.partiya, null)
    expect(t.tier).toBe('large')
    expect(t.units).toBe(224)
  })

  it('строка для Telegram называет объём и пропуски', () => {
    const line = triageLine(buildTriage(CHATS.partiya, { segment: 'workshop', repeat: 'repeat' }))
    expect(line).toContain('Мастерская')
    expect(line).toContain('224 шт')
    expect(line).toContain('повторяется')
    expect(line).toContain('не хватает')
  })

  it('пустой текст не роняет разбор', () => {
    const t = buildTriage('', null)
    expect(t.units).toBeNull()
    expect(t.tier).toBe('small')
  })
})
