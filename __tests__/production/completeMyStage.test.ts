import { describe, it, expect } from 'vitest'
import { pickMyStageTasks, countMyStageTasks, type StationTask } from '@/lib/production/completeMyStage'

const t = (id: number, item: number, seq: number, station: string, status = 'queued'): StationTask => ({
  id, item_index: item, sequence_order: seq, status, stage_key: station, station,
  rework_count: 0, started_at: null, assigned_to: null, started_by: null,
})

// Заказ из трёх деталей, полный маршрут на каждой.
const order: StationTask[] = [
  t(1, 0, 1, 'cutting'),   t(2, 0, 3, 'polishing'), t(3, 0, 6, 'tempering'), t(4, 0, 8, 'packaging'),
  t(5, 1, 1, 'cutting'),   t(6, 1, 3, 'polishing'), t(7, 1, 6, 'tempering'), t(8, 1, 8, 'packaging'),
  t(9, 2, 1, 'cutting'),   t(10, 2, 3, 'polishing'),
]

describe('«Готово на моей станции»', () => {
  it('берёт только свою станцию по всем деталям заказа', () => {
    const mine = pickMyStageTasks(order, ['cutting'])
    expect(mine.map(x => x.id)).toEqual([1, 5, 9])
  })

  it('чужие этапы не трогает — в этом весь смысл границы', () => {
    const mine = pickMyStageTasks(order, ['polishing'])
    expect(mine.every(x => x.station === 'polishing')).toBe(true)
    expect(mine.map(x => x.id)).toEqual([2, 6, 10])
  })

  it('две станции у одного человека — обе закрываются', () => {
    expect(pickMyStageTasks(order, ['tempering', 'packaging']).map(x => x.id)).toEqual([3, 4, 7, 8])
  })

  it('уже закрытое не закрывается повторно', () => {
    const done = order.map(x => (x.id === 5 ? { ...x, status: 'done' } : x))
    expect(pickMyStageTasks(done, ['cutting']).map(x => x.id)).toEqual([1, 9])
  })

  it('проблемную деталь закрываем: мастер с ней разобрался и ведёт дальше', () => {
    const prob = order.map(x => (x.id === 1 ? { ...x, status: 'problem' } : x))
    expect(pickMyStageTasks(prob, ['cutting']).map(x => x.id)).toEqual([1, 5, 9])
  })

  it('нет станций — нечего закрывать', () => {
    expect(pickMyStageTasks(order, [])).toEqual([])
  })

  it('счётчик на кнопке равен тому, что закроет сервер', () => {
    // Одна и та же функция: подпись не может разойтись с действием.
    expect(countMyStageTasks(order, ['cutting'])).toBe(pickMyStageTasks(order, ['cutting']).length)
    expect(countMyStageTasks(order, ['cutting'])).toBe(3)
  })

  it('задачу, взятую другим человеком, не закрывает', () => {
    // Его «Взял» — осознанное решение, и очередь такие задачи мне не показывает:
    // закрыв их, кнопка сделала бы больше, чем обещала.
    const taken = order.map(x => (x.id === 5 ? { ...x, assigned_to: 'другой-человек' } : x))
    expect(pickMyStageTasks(taken, ['cutting'], 'я').map(x => x.id)).toEqual([1, 9])
  })

  it('свою же взятую задачу закрывает', () => {
    const taken = order.map(x => (x.id === 5 ? { ...x, assigned_to: 'я' } : x))
    expect(pickMyStageTasks(taken, ['cutting'], 'я').map(x => x.id)).toEqual([1, 5, 9])
  })

  it('порядок — по деталям, чтобы каскад шёл предсказуемо', () => {
    const mine = pickMyStageTasks(order, ['cutting', 'polishing'])
    expect(mine.map(x => `${x.item_index}:${x.sequence_order}`)).toEqual(['0:1', '0:3', '1:1', '1:3', '2:1', '2:3'])
  })
})
