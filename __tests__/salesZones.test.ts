import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  SALES_ZONE_TABLE, normalizeStageName, stageZone,
  findSalesPipeline, zoneBreakdown,
} from '@/lib/salesZones'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

describe('таблица зон = SYSTEM.md', () => {
  it('строка в строку, с зонами', () => {
    const sys = read('SYSTEM.md')
    const block = sys.slice(sys.indexOf('## Воронка "Продажи" — зоны'))
    const rows = block.slice(0, block.indexOf('\n---')).split('\n')
      .map(l => l.match(/^\|\s*([^|]+?)\s*\|\s*([123])\b/))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map(m => [m[1], Number(m[2])])
    expect(rows.length).toBe(23)
    expect(SALES_ZONE_TABLE.map(([n, z]) => [n, z])).toEqual(rows)
  })

  it('каждая строка таблицы находит свою зону', () => {
    for (const [name, zone] of SALES_ZONE_TABLE) expect(stageZone(name), name).toBe(zone)
  })
})

describe('normalizeStageName', () => {
  it('регистр, ё, тире, дефис, слэш, запятая, лишние и неразрывные пробелы', () => {
    expect(normalizeStageName('Счёт выставлен — ждём оплату')).toBe('счет выставлен ждем оплату')
    expect(normalizeStageName('Счет выставлен - ждем оплату')).toBe('счет выставлен ждем оплату')
    expect(normalizeStageName('  ОПлата получена – Проверка чертежей ')).toBe('оплата получена проверка чертежей')
    expect(normalizeStageName('Монтаж начат / в процессе')).toBe('монтаж начат в процессе')
    expect(normalizeStageName('оплата сделана,  чертежи не готовы')).toBe('оплата сделана чертежи не готовы')
  })
})

describe('этапы воронки «Продажи» в AmoCRM (снимок 01.10.2026)', () => {
  const live: [string, 1 | 2 | 3 | null][] = [
    ['Неразобранное', null],
    ['получена новая заявка', 1],
    ['Назначен ответственный', 1],
    ['Проработка', 1],
    ['Разговор состоялся', 1],
    ['Долгострой', 1],
    ['Готов купить', 1],
    ['замер назначен', 2],
    ['Замер проведен', 2],
    ['согласование после замера', 2],
    ['Чертежи в Работу', 2],
    ['Чертежи готовы', null],
    ['Согласование после отправки чертежа клиенту', null],
    ['Кп отправлено', 2],
    ['Счет выставлен - ждем оплату', 2],
    ['оплата сделана, чертежи не готовы', 3],
    ['ОПлата получена - Проверка чертежей', 3],
    ['счёт Оплачен', 3],
    ['Заказ в работе', 3],
    ['Готово к Монтажу', 3],
    ['Монтаж назначен', 3],
    ['Монтаж начат и в процессе', null],
    ['Рекламация', 3],
    ['оплата остатка', 3],
    ['оплата дизайнерам', null],
    ['отложенный спрос', null],
  ]
  it.each(live)('%s → %s', (name, zone) => {
    expect(stageZone(name)).toBe(zone)
  })

  it('написания amo, отличные от таблицы словами, зоны не получают (решение владельца 01.10)', () => {
    for (const n of ['Согласование после отправки чертежа клиенту', 'Монтаж начат и в процессе', 'оплата дизайнерам']) {
      expect(stageZone(n), n).toBeNull()
    }
  })

  it('этап не из таблицы зоны не получает, даже если в названии есть слово из неё', () => {
    for (const n of ['Замер запланирован', 'Замер отменён', 'Счет выставлен', 'Счет оплачен у партнёра', 'Монтаж Январь 2025', 'Повторный контакт']) {
      expect(stageZone(n), n).toBeNull()
    }
  })
})

const st = (id: number, name: string) => ({ id, name })
const PIPELINES = [
  { id: 10, name: 'Квалификация', _embedded: { statuses: [st(101, 'Назначен ответственный'), st(142, 'Замер запланирован')] } },
  { id: 20, name: 'Продажи', _embedded: { statuses: [st(201, 'Проработка'), st(202, 'Кп отправлено'), st(203, 'оплата дизайнерам'), st(204, 'отложенный спрос'), st(205, 'Разговор состоялся'), st(142, 'реализовано успешно')] } },
  { id: 30, name: 'Партнёры', _embedded: { statuses: [st(301, 'Разговор состоялся'), st(302, 'Отвалились')] } },
]

describe('findSalesPipeline', () => {
  const env = process.env.AMOCRM_SALES_PIPELINE_ID
  afterEach(() => { if (env === undefined) delete process.env.AMOCRM_SALES_PIPELINE_ID; else process.env.AMOCRM_SALES_PIPELINE_ID = env })

  it('по имени, а не первая в списке', () => {
    delete process.env.AMOCRM_SALES_PIPELINE_ID
    expect(findSalesPipeline(PIPELINES)?.id).toBe(20)
    expect(findSalesPipeline(PIPELINES.filter(p => p.id !== 20))).toBeUndefined()
  })

  it('id из окружения важнее имени', () => {
    process.env.AMOCRM_SALES_PIPELINE_ID = '30'
    expect(findSalesPipeline(PIPELINES)?.id).toBe(30)
  })
})

describe('zoneBreakdown', () => {
  const open = [
    { pipeline_id: 20, status_id: 201 },
    { pipeline_id: 20, status_id: 202 },
    { pipeline_id: 20, status_id: 203 },
    { pipeline_id: 20, status_id: 204 },
    { pipeline_id: 20, status_id: 204 },
    { pipeline_id: 20, status_id: 205 },
    { pipeline_id: 30, status_id: 301 },
    { pipeline_id: 30, status_id: 301 },
    { pipeline_id: 30, status_id: 302 },
    { pipeline_id: 10, status_id: 101 },
  ]

  it('одноимённый этап другой воронки в зону не попадает', () => {
    const z = zoneBreakdown(open, PIPELINES)
    expect([z.zone1, z.zone2, z.zone3]).toEqual([2, 1, 0])
    expect(z.otherPipelines).toEqual([{ pipeline: 'Партнёры', count: 3 }, { pipeline: 'Квалификация', count: 1 }])
    expect(z.unzonedStages).toEqual([{ stage: 'отложенный спрос', count: 2 }, { stage: 'оплата дизайнерам', count: 1 }])
  })

  it('тождество: «Продажи» = зоны + вне таблицы; все = «Продажи» + другие воронки', () => {
    const z = zoneBreakdown(open, PIPELINES)
    const sum = (xs: { count: number }[]) => xs.reduce((s, x) => s + x.count, 0)
    expect(z.sales).toBe(z.zone1 + z.zone2 + z.zone3 + sum(z.unzonedStages))
    expect(z.sales + sum(z.otherPipelines)).toBe(open.length)
  })
})

describe('/manager и монитор продаж считают зоны одним модулем', () => {
  it.each(['app/api/manager/deals/route.ts', 'lib/salesMonitor.ts'])('%s', file => {
    const src = read(file)
    expect(src).toMatch(/from '@\/lib\/salesZones'/)
    expect(src).not.toMatch(/function\s+stageZone\s*\(/)
  })
})
