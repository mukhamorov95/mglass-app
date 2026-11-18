import { describe, expect, it } from 'vitest'
import { aggregate, channelOf, QUALIFICATION_PIPELINE, type AmoLeadLite } from '@/lib/marketing/channels'

const lead = (p: Partial<AmoLeadLite>): AmoLeadLite => ({ id: 1, name: 'Заявка', pipeline_id: 1, status_id: 10, created_at: 0, ...p })
const tag = (...names: string[]) => ({ tags: names.map((name) => ({ name })) })
const field = (field_name: string, value: string) => ({ field_name, values: [{ value }] })

describe('channelOf', () => {
  it('чат Envybox — «Сделка #» в «Квалификации», даже без тегов', () => {
    expect(channelOf(lead({ name: 'Сделка #39942821', pipeline_id: QUALIFICATION_PIPELINE }))).toBe('envyboxChat')
  })
  it('«Сделка #» в «Продажах» — не чат', () => {
    expect(channelOf(lead({ name: 'Сделка #39942149' }))).toBe('other')
  })
  it('сайт зеркал по тегу важнее поля «Источник»', () => {
    expect(channelOf(lead({ _embedded: tag('сайт-зеркала'), custom_fields_values: [field('ИСТОЧНИК СДЕЛКИ', 'Другое')] }))).toBe('zerkala')
  })
  it('Envybox — тег или поле, регистр и пробелы не важны', () => {
    expect(channelOf(lead({ _embedded: tag('ЭнвиБокс', 'Дизайнер') }))).toBe('envybox')
    expect(channelOf(lead({ custom_fields_values: [field('ИСТОЧНИК СДЕЛКИ', 'Энвибокс')] }))).toBe('envybox')
  })
  it('mglass.pro — поле с двойным пробелом и utm_referrer', () => {
    expect(channelOf(lead({ custom_fields_values: [field('Источник', 'сайт  mglass.pro')] }))).toBe('mglassPro')
    expect(channelOf(lead({ custom_fields_values: [field('utm_referrer', 'https://mglass.pro/')] }))).toBe('mglassPro')
  })
  it('нейросети — utm_source chatgpt.com', () => {
    expect(channelOf(lead({ custom_fields_values: [field('utm_source', 'chatgpt.com'), field('utm_referrer', 'https://mglass.pro/')] }))).toBe('ai')
  })
  it('перегородки, мессенджеры, Авито, партнёры, звонки', () => {
    expect(channelOf(lead({ custom_fields_values: [field('Источник', 'сайт  стеклянные-перегородки.рф')] }))).toBe('peregorodki')
    expect(channelOf(lead({ custom_fields_values: [field('Источник', 'Ватсап/Телеграмм с сайта')] }))).toBe('siteMessengers')
    expect(channelOf(lead({ _embedded: tag('Авито') }))).toBe('avito')
    expect(channelOf(lead({ _embedded: tag('Партнёр') }))).toBe('partners')
    expect(channelOf(lead({ custom_fields_values: [field('Источник', 'Звонок Входящий на ГОРОДСКОЙ')] }))).toBe('calls')
  })
})

describe('aggregate', () => {
  it('итог канала = в работе + успешно + не реализовано; висящие в «Квалификации» считаются отдельно', () => {
    const rows = aggregate([
      lead({ name: 'Сделка #1', pipeline_id: QUALIFICATION_PIPELINE }),
      lead({ name: 'Сделка #2', pipeline_id: QUALIFICATION_PIPELINE, status_id: 143 }),
      lead({ _embedded: tag('сайт-зеркала'), status_id: 142 }),
    ])
    const chat = rows.find((r) => r.key === 'envyboxChat')!
    expect(chat).toMatchObject({ total: 2, open: 1, lost: 1, won: 0, stuckQualification: 1 })
    for (const r of rows) expect(r.open + r.won + r.lost).toBe(r.total)
  })
})
