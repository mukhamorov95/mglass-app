import { describe, it, expect } from 'vitest'
import { describeMissedClient, type AmoLeadHit } from '@/lib/missedClients'

const ALINA = 8272804, SEMEN = 13677554, SASHA = 11127302
const names = new Map([[ALINA, 'Алина'], [SEMEN, 'Семён'], [SASHA, 'Александра']])
const stageNames = new Map([['1654237:49559185', 'Продажи → Кп отправлено'], ['1654237:70347794', 'Продажи → Проработка']])
const extToUser = new Map([['100', SEMEN], ['103', ALINA]])
const T = 1790000000
const lead = (over: Partial<AmoLeadHit>): AmoLeadHit =>
  ({ id: 1, name: 'сделка', responsible_user_id: ALINA, pipeline_id: 1654237, status_id: 49559185, updated_at: T, ...over })
const base = { names, stageNames, extToUser, domain: 'mglass.amocrm.ru', touches: [], amoRang: [] as number[] }

describe('чей пропущенный клиент', () => {
  it('клиент с живой сделкой: ответственный, этап, ссылка; звонок шёл на двоих', () => {
    const m = describeMissedClient({
      ...base,
      item: { at: T + 300, phone: '9264393479', attempts: 3, exts: [] },
      contacts: [{ id: 5, name: 'Юлия Горбачева', responsible_user_id: ALINA, leads: [39132991] }],
      leads: new Map([[39132991, lead({ id: 39132991, name: 'шторка на ванну' })]]),
      amoRang: [ALINA, SEMEN, ALINA],
    })
    expect(m.rangTo).toEqual(['Алина', 'Семён'])
    expect(m.owner).toMatchObject({ kind: 'deal', responsible: 'Алина', stage: 'Продажи → Кп отправлено', url: 'https://mglass.amocrm.ru/leads/detail/39132991', autoCreated: false })
    expect(m.after).toBeNull()
  })

  it('новый номер: amo сам завёл «Пропущенный…», звонок ушёл на внутренний по умолчанию', () => {
    const m = describeMissedClient({
      ...base,
      item: { at: T, phone: '9653342381', attempts: 1, exts: ['100'] },
      contacts: [{ id: 7, name: 'Пропущенный 79653342381 (74951486578)', responsible_user_id: SEMEN, leads: [] }],
      leads: new Map(),
    })
    expect(m.rangTo).toEqual(['Семён'])
    expect(m.owner).toMatchObject({ kind: 'contact', responsible: 'Семён', autoCreated: true })
  })

  it('номера нет в amo; неизвестный внутренний — как есть', () => {
    const m = describeMissedClient({ ...base, item: { at: T, phone: '9260255476', attempts: 1, exts: ['5200'] }, contacts: [], leads: new Map() })
    expect(m.owner).toEqual({ kind: 'none' })
    expect(m.rangTo).toEqual(['общая линия (вн. 5200)'])
  })

  it('касание после звонка — первое исходящее не раньше последнего пропущенного; без автора так и подписано', () => {
    const m = describeMissedClient({
      ...base,
      item: { at: T, phone: '9167107239', attempts: 1, exts: [] },
      contacts: [{ id: 9, name: 'Ya', responsible_user_id: SASHA, leads: [2] }],
      leads: new Map([[2, lead({ id: 2, responsible_user_id: SASHA })]]),
      touches: [
        { type: 'outgoing_chat_message', created_by: 0, created_at: T + 120 },
        { type: 'outgoing_call', created_by: SASHA, created_at: T + 3600 },
        { type: 'outgoing_chat_message', created_by: SASHA, created_at: T - 60 },
      ],
    })
    expect(m.after).toEqual({ at: T + 120, what: 'сообщение', by: 'без автора' })
  })

  it('из нескольких сделок — живая, а не закрытая', () => {
    const m = describeMissedClient({
      ...base,
      item: { at: T, phone: '9000000000', attempts: 1, exts: [] },
      contacts: [{ id: 1, name: 'К', responsible_user_id: ALINA, leads: [10, 11] }],
      leads: new Map([[10, lead({ id: 10, status_id: 143, updated_at: T + 999 })], [11, lead({ id: 11, status_id: 70347794, responsible_user_id: SEMEN })]]),
    })
    expect(m.owner).toMatchObject({ kind: 'deal', leadId: 11, responsible: 'Семён' })
  })
})
