import { describe, it, expect } from 'vitest'
import { toEdits } from '@/lib/economics/lab/refEdits'
import { reviseReference, referenceStamp, type Param, type Reference } from '@/lib/economics/engine/reference'

// Значения выдуманы: репозиторий публичный, настоящие нормативы живут в базе.
const p = (over: Partial<Param> & { key: string }): Param =>
  ({ group: 'g', label: over.key, unit: 'мин', lo: 10, hi: 10, status: 'hypothesis', source: 'прикидка', date: '2026-11-27', ...over })

const REF: Reference = {
  id: 'tech', version: 3, date: '2026-11-27', author: 'тест', reason: 'тест', changes: [],
  params: [
    p({ key: 'cut.minPerSheet', lo: 20, hi: 20 }),
    p({ key: 'zm9.setupMin', lo: 10, hi: 25 }),
    p({ key: 'weld.minPerPart', lo: null, hi: null, status: 'missing', source: 'норм нет' }),
  ],
}

describe('правка справочника с экрана', () => {
  it('точное значение пишется в оба края и получает статус владельца', () => {
    const { edits, error } = toEdits(REF, { 'cut.minPerSheet': { lo: '15', hi: '15', source: 'хронометраж 20 листов' } })
    expect(error).toBeNull()
    expect(edits).toEqual([{ key: 'cut.minPerSheet', lo: 15, hi: 15, status: 'owner', source: 'хронометраж 20 листов' }])
  })

  it('строка, открытая но не изменённая, в правки не попадает', () => {
    const { edits } = toEdits(REF, { 'cut.minPerSheet': { lo: '20', hi: '20', status: 'hypothesis', source: 'прикидка' } })
    expect(edits).toEqual([])
  })

  it('один край диапазона — отказ, а не достройка вторым', () => {
    expect(toEdits(REF, { 'zm9.setupMin': { lo: '12', hi: '' } }).error).toMatch(/оба края/)
  })

  it('нечисло и перевёрнутый диапазон отклоняются', () => {
    expect(toEdits(REF, { 'zm9.setupMin': { lo: 'десять', hi: '12' } }).error).toMatch(/не число/)
    expect(toEdits(REF, { 'zm9.setupMin': { lo: '30', hi: '12' } }).error).toMatch(/0 ≤ от ≤ до/)
    expect(toEdits(REF, { 'zm9.setupMin': { lo: '-1', hi: '5' } }).error).toMatch(/0 ≤ от ≤ до/)
  })

  it('очистка значения даёт «нет значения», а не ноль', () => {
    const { edits } = toEdits(REF, { 'cut.minPerSheet': { lo: '', hi: '', status: 'owner', source: 'норма снята' } })
    expect(edits[0]).toMatchObject({ lo: null, hi: null, status: 'missing' })
  })

  it('значение со статусом «нет значения» не сходятся', () => {
    expect(toEdits(REF, { 'cut.minPerSheet': { lo: '5', hi: '5', status: 'missing' } }).error).toMatch(/не сходятся/)
  })

  it('норматив, которого в справочнике нет, не правится', () => {
    expect(toEdits(REF, { 'нет.такого': { lo: '1', hi: '1' } }).error).toMatch(/Нет такого норматива/)
  })

  it('пустой источник берётся из прежнего значения, а не теряется', () => {
    const { edits } = toEdits(REF, { 'cut.minPerSheet': { lo: '18', hi: '18', source: '  ' } })
    expect(edits[0].source).toBe('прикидка')
  })

  it('заполнение «нет значения» — такая же правка с историей', () => {
    const { edits } = toEdits(REF, { 'weld.minPerPart': { lo: '4', hi: '9', source: 'хронометраж цеха' } })
    const next = reviseReference(REF, edits, { reason: 'замерили сварку', author: 'тест', date: '2026-11-28' })
    expect(next.version).toBe(4)
    expect(next.changes).toEqual([{
      key: 'weld.minPerPart',
      before: { lo: null, hi: null, status: 'missing', source: 'норм нет' },
      after: { lo: 4, hi: 9, status: 'owner', source: 'хронометраж цеха' },
    }])
    expect(referenceStamp(next)).not.toBe(referenceStamp(REF))
    // Прежняя версия не меняется: сохранённый вариант расчёта остаётся на своих нормах (§16).
    expect(REF.params.find(x => x.key === 'weld.minPerPart')).toMatchObject({ lo: null, status: 'missing' })
    expect(REF.version).toBe(3)
  })
})
