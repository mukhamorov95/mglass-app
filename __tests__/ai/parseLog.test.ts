import { describe, it, expect } from 'vitest'
import { countHoleSignals } from '@/lib/ai/parseSignals'

// Два счётчика отличают «разбор не запускали» от «запускали, а диаметров
// в чертеже не было» — вопрос, на который 02.09 ответить было нечем.
describe('сигналы отверстий в результате разбора', () => {
  it('считает детали с отверстиями по структурному полю', () => {
    expect(countHoleSignals([{ holes: 2 }, { holes: 0 }, { holes: 5 }]).withHoles).toBe(2)
  })

  it('диаметр ищет обоими знаками — и Ø, и ∅', () => {
    const items = [
      { notes: 'Отверстия Ø14, Ø14' },
      { notes: 'отв. ∅16 (2 отв.) и ∅10' },
      { notes: 'кромка полировать' },
    ]
    expect(countHoleSignals(items).withDiameter).toBe(2)
  })

  it('смотрит и notes, и comment, и label — разбор кладёт текст в разные поля', () => {
    expect(countHoleSignals([{ label: 'Ст1 (2 отв. Ø8)' }, { comment: 'Ø10' }]).withDiameter).toBe(2)
  })

  it('деталь с отверстиями, но без диаметров, попадает только в первый счётчик', () => {
    // Это и есть случай «разбор запускали, диаметров в чертеже не было».
    const r = countHoleSignals([{ holes: 3, notes: 'два сверху, одно снизу' }])
    expect(r).toEqual({ withHoles: 1, withDiameter: 0 })
  })

  it('не массив и мусор внутри — нули, а не падение', () => {
    expect(countHoleSignals(null)).toEqual({ withHoles: 0, withDiameter: 0 })
    expect(countHoleSignals('нет')).toEqual({ withHoles: 0, withDiameter: 0 })
    expect(countHoleSignals([null, undefined, 5])).toEqual({ withHoles: 0, withDiameter: 0 })
  })
})
