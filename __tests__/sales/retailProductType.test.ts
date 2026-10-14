import { describe, expect, it } from 'vitest'
import {
  AMO_FIELD_ORDER_NO, AMO_FIELD_PRODUCT_OLD, AMO_FIELD_PRODUCT_TYPE,
  amoProductTypes, classifyProductText, formatProductTypes, leadMatchesOrder, parseProductTypes,
  pickRetailProductType, typesFromAmoEnums, typesFromAmoLeads, typesFromCalculation,
} from '@/lib/sales/retailProductType.mjs'
import { productTypeCandidates } from '@/lib/sales/salesSheetSync'

const lead = (id: number, name: string, fields: Record<number, string[]> = {}) => ({
  id, name,
  custom_fields_values: Object.entries(fields).map(([fid, vals]) => ({ field_id: Number(fid), values: vals.map(value => ({ value })) })),
})

describe('classifyProductText — графа «изделие» книги до июня 2025', () => {
  const cases: [string, string[]][] = [
    ['Душевая', ['shower']],
    ['дУШЕВАЯ', ['shower']],
    ['Душеваю', ['shower']],
    ['2 душевые', ['shower']],
    ['Шторка', ['shower']],
    ['Стационар', ['shower']],
    ['Душевая стац.', ['shower']],
    ['Зерала', ['mirror']],
    ['душ и зекало', ['shower', 'mirror']],
    ['Душевая и зеркла', ['shower', 'mirror']],
    ['Зеркала и душ', ['shower', 'mirror']],
    ['Зеркало фигурное', ['mirror']],
    ['Шторка полка и душ', ['shower', 'other']],
    ['Душ, зеркала, лофт', ['shower', 'mirror', 'loft']],
    ['Лофт и дверь', ['loft', 'door']],
    ['Цельностеклянные перегородки', ['partition']],
    ['Лестничное ограждение', ['railing']],
    ['ограждение терассы', ['railing']],
    ['Сварная конструкция', ['welded']],
    ['Фартук', ['other']],
    ['Столешница', ['other']],
    ['Козырек', ['other']],
  ]
  it.each(cases)('«%s» → %j', (text, types) => {
    expect(classifyProductText(text)).toEqual({ types, ambiguous: false })
  })

  it('«душевая перегородка» — душевая, не межкомнатная', () => {
    expect(classifyProductText('Душевая перегородка в нишу').types).toEqual(['shower'])
  })

  // Неоднозначное — пусто, а не «другое»: марка стекла или модель, ступени или ограждение.
  it.each(['Стекло М1', 'Стекло', 'Лестница', 'Лесница', 'Полка и стекло', 'Душевая и стекло', 'душ и сауна',
    'трапеция', 'сенсорные кнопки', 'За выключатель', 'На услуги', 'Профиль', 'Стационарное стекло'])('«%s» — неоднозначно', text => {
    expect(classifyProductText(text)).toEqual({ types: [], ambiguous: true })
  })

  it('пустое и имя клиента — без типа', () => {
    expect(classifyProductText('').types).toEqual([])
    expect(classifyProductText(null).types).toEqual([])
    expect(classifyProductText('Иван Примеров').types).toEqual([])
  })

  it('слово ищется с начала: «подушка» — не душевая', () => {
    expect(classifyProductText('подушка').types).toEqual([])
  })
})

describe('поля amo', () => {
  it('«Тип изделия» и прежнее «Изделие»', () => {
    expect(typesFromAmoEnums(['Зеркала', 'Душевая перегородка'])).toEqual(['shower', 'mirror'])
    expect(typesFromAmoEnums(['Межкомнатная перегородка', 'Двери', 'Другое', 'Лофт', 'Ограждения']))
      .toEqual(['loft', 'partition', 'railing', 'door', 'other'])
    expect(typesFromAmoEnums(['Зеркало с подсветкой', 'Несколько душевых', 'Полка'])).toEqual(['shower', 'mirror', 'other'])
    expect(typesFromAmoEnums(['Неизвестное значение'])).toEqual([])
  })

  it('сделка заказа — по полю «Номер заказа», иначе по началу названия', () => {
    expect(leadMatchesOrder(lead(1, 'Заявка с сайта', { [AMO_FIELD_ORDER_NO]: ['0900-1'] }), '0900-1')).toBe(true)
    expect(leadMatchesOrder(lead(2, '0900-1 Иван', { [AMO_FIELD_ORDER_NO]: ['0901-1'] }), '0900-1')).toBe(false)
    expect(leadMatchesOrder(lead(3, '0900-1 (доп зеркало)'), '0900-1')).toBe(true)
    expect(leadMatchesOrder(lead(4, '0900-1-1 Иван'), '0900-1')).toBe(false)
    expect(leadMatchesOrder(lead(5, '0900-12 Иван'), '0900-1')).toBe(false)
    expect(leadMatchesOrder(lead(6, 'Иван 0900-1'), '0900-1')).toBe(false)
  })

  it('типы всех сделок заказа объединяются; поле важнее названия', () => {
    const leads = [
      lead(1, '0900-1 (душевая)', { [AMO_FIELD_ORDER_NO]: ['0900-1'], [AMO_FIELD_PRODUCT_TYPE]: ['Душевая перегородка'] }),
      lead(2, '0900-1 (доп зеркало)', { [AMO_FIELD_PRODUCT_OLD]: ['Зеркало на клей'] }),
      lead(3, '0777-2 лофт', { [AMO_FIELD_PRODUCT_TYPE]: ['Лофт'] }),
    ]
    expect(typesFromAmoLeads(leads, '0900-1')).toEqual({ types: ['shower', 'mirror'], source: 'amo_field', leadIds: [1, 2] })
  })

  it('без полей — правило по названию сделки; неоднозначное название — пусто', () => {
    expect(typesFromAmoLeads([lead(1, '0900-1 душевая и зеркала')], '0900-1'))
      .toEqual({ types: ['shower', 'mirror'], source: 'amo_name', leadIds: [1] })
    expect(typesFromAmoLeads([lead(1, '0900-1 стекло М1')], '0900-1').types).toEqual([])
    expect(typesFromAmoLeads([lead(1, '0900-1 Иван')], '0900-1')).toEqual({ types: [], source: null, leadIds: [1] })
    expect(typesFromAmoLeads([], '0900-1')).toEqual({ types: [], source: null, leadIds: [] })
  })

  it('amoProductTypes зовёт только GET /leads с номером заказа', async () => {
    const calls: [string, Record<string, string>][] = []
    const get = async (path: string, params: Record<string, string>) => {
      calls.push([path, params])
      return { _embedded: { leads: [lead(9, '0900-1', { [AMO_FIELD_PRODUCT_TYPE]: ['Зеркала'] })] } }
    }
    const m = await amoProductTypes(['0900-1', '0900-1', ''], get)
    expect(calls).toEqual([['/leads', { query: '0900-1', limit: '50' }]])
    expect(m.get('0900-1')?.types).toEqual(['mirror'])
  })
})

describe('расчёт и выбор источника', () => {
  it('тип калькулятора; quick/build — по названиям корзины', () => {
    expect(typesFromCalculation({ product_type: 'shower_budget' })).toEqual(['shower'])
    expect(typesFromCalculation({ product_type: 'quick', input_data: { cart: [{ title: 'Зеркало 4 мм' }, { title: 'Душевая М2' }] } }))
      .toEqual(['shower', 'mirror'])
    expect(typesFromCalculation({ product_type: 'build', input_data: { cart: [{ title: 'Стекло М1' }] } })).toEqual([])
    expect(typesFromCalculation({ product_type: 'build', input_data: {} })).toEqual([])
  })

  it('приоритет: расчёт → договор → amo → текст', () => {
    const amo = { types: ['mirror' as const], source: 'amo_field' as const, leadIds: [1] }
    expect(pickRetailProductType({ calculation: { product_type: 'loft' }, dealKinds: ['mirror'], amo, text: 'душевая' }))
      .toEqual({ value: 'loft', source: 'calculation' })
    expect(pickRetailProductType({ calculation: { product_type: 'quick' }, dealKinds: ['shower', 'mirror'], amo }))
      .toEqual({ value: 'shower,mirror', source: 'deal' })
    expect(pickRetailProductType({ dealKinds: [null], amo, text: 'душевая' })).toEqual({ value: 'mirror', source: 'amo_field' })
    expect(pickRetailProductType({ text: 'душевая' })).toEqual({ value: 'shower', source: 'text' })
  })

  it('ничего не определилось — null, не «другое»', () => {
    expect(pickRetailProductType({})).toEqual({ value: null, source: null })
    expect(pickRetailProductType({ text: 'Стекло М1' })).toEqual({ value: null, source: null })
  })

  it('колонка: коды через запятую, старый свободный текст читается тем же правилом', () => {
    expect(formatProductTypes(['mirror', 'shower', 'mirror'])).toBe('shower,mirror')
    expect(formatProductTypes([])).toBeNull()
    expect(parseProductTypes('shower,mirror')).toEqual(['shower', 'mirror'])
    expect(parseProductTypes('Душевая и зеркала')).toEqual(['shower', 'mirror'])
    expect(parseProductTypes(null)).toEqual([])
  })
})

describe('productTypeCandidates — кого спросить у amo в утреннем синке', () => {
  const s = (order_no: string | null, sale_date: string) => ({ order_no, sale_date })
  it('новые и свежие пустые, новейшие первыми, без повторов, с потолком', () => {
    const r = productTypeCandidates(
      [s('0900-1', '2026-10-10'), s(null, '2026-10-12')],
      [s('0899-1', '2026-10-12'), s('0900-1', '2026-10-10'), s('0700-1', '2026-07-01')],
      '2026-10-14', 1,
    )
    expect(r).toEqual({ take: ['0899-1'], deferred: 1 })
  })
  it('пустая продажа старше 60 дней не перепроверяется — её добирает бэкфилл', () => {
    expect(productTypeCandidates([], [s('0700-1', '2026-08-01')], '2026-10-14').take).toEqual([])
    expect(productTypeCandidates([s('0700-1', '2026-08-01')], [], '2026-10-14').take).toEqual(['0700-1'])
  })
})
