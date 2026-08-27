import { describe, it, expect } from 'vitest'
import { countClosable, pickFinalTasks, type ClosableTask } from '@/lib/production/completeOrder'

const t = (id: number, item: number, seq: number, status = 'queued'): ClosableTask =>
  ({ id, item_index: item, sequence_order: seq, status })

describe('pickFinalTasks — по одной задаче на деталь, остальное закроет каскад', () => {
  it('деталь из четырёх этапов — шлём только последний', () => {
    const r = pickFinalTasks([t(1, 0, 1), t(2, 0, 2), t(3, 0, 3), t(4, 0, 4)])
    expect(r.map(x => x.id)).toEqual([4])
  })

  it('две детали — по одной задаче на каждую', () => {
    const r = pickFinalTasks([t(1, 0, 1), t(2, 0, 2), t(3, 1, 1), t(4, 1, 2)])
    expect(r.map(x => x.id)).toEqual([2, 4])
  })

  it('уже закрытые этапы не мешают выбрать последний открытый', () => {
    const r = pickFinalTasks([t(1, 0, 1, 'done'), t(2, 0, 2, 'done'), t(3, 0, 3)])
    expect(r.map(x => x.id)).toEqual([3])
  })

  it('деталь закрыта целиком — не шлём ничего', () => {
    expect(pickFinalTasks([t(1, 0, 1, 'done'), t(2, 0, 2, 'done')])).toEqual([])
  })

  it('проблемная задача тоже закрывается: «Всё готово» снимает андон', () => {
    expect(pickFinalTasks([t(1, 0, 1, 'problem')]).map(x => x.id)).toEqual([1])
  })

  it('триплекс: этапы слоёв идут раньше склейки и упаковки — берётся упаковка', () => {
    // слой 1: резка(1) закалка(2); слой 2: резка(3) закалка(4); склейка(5); упаковка(6)
    const triplex = [t(11, 0, 1), t(12, 0, 2), t(13, 0, 3), t(14, 0, 4), t(15, 0, 5), t(16, 0, 6)]
    expect(pickFinalTasks(triplex).map(x => x.id)).toEqual([16])
  })

  it('порядок деталей сохраняется — отметки идут как в заказе', () => {
    const r = pickFinalTasks([t(9, 2, 1), t(7, 0, 1), t(8, 1, 1)])
    expect(r.map(x => x.item_index)).toEqual([0, 1, 2])
  })
})

describe('countClosable — что показать на кнопке', () => {
  it('считает все незакрытые, а не только отправляемые', () => {
    expect(countClosable([t(1, 0, 1), t(2, 0, 2), t(3, 0, 3, 'done')])).toBe(2)
  })
  it('нечего закрывать — ноль', () => {
    expect(countClosable([t(1, 0, 1, 'done')])).toBe(0)
  })
})
