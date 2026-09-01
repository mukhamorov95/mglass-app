import { describe, it, expect } from 'vitest'

// Фильтры оборота партнёрки закреплены тестом не ради кода, а ради вывода,
// который однажды уже был сделан неверно: 01.09.2026 из расчёта убрали условие
// «без архива», решив, что архив вычёркивает живую работу. Оборот вырос почти
// втрое, и владелец поймал это здравым смыслом: «не мог клиент столько заказать».
//
// На деле заказы грузились из Google-таблицы тремя поколениями импорта: старые
// поколения ушли в архив, актуальное осталось. Один заказ лежал трижды с суммой,
// совпадающей до рубля. Архив здесь — вытеснение старой версии, а не отмена.

type Order = { archived: boolean; launched: boolean; quote: boolean; historical: boolean }

// Правило в одном месте: что именно считается оборотом партнёра.
const counts = (o: Order) => !o.archived && o.launched && !o.quote && !o.historical

describe('что входит в оборот партнёра', () => {
  it('запущенный в работу активный заказ считается', () => {
    expect(counts({ archived: false, launched: true, quote: false, historical: false })).toBe(true)
  })

  it('просчёт НЕ считается, даже если он свежий: просчёт — не заказ', () => {
    expect(counts({ archived: false, launched: false, quote: false, historical: false })).toBe(false)
  })

  it('архивный не считается, даже будучи запущенным — это вытесненное поколение импорта', () => {
    expect(counts({ archived: true, launched: true, quote: false, historical: false })).toBe(false)
  })

  it('помеченный как quote не считается', () => {
    expect(counts({ archived: false, launched: true, quote: true, historical: false })).toBe(false)
  })

  it('импортированная история не считается', () => {
    expect(counts({ archived: false, launched: true, quote: false, historical: true })).toBe(false)
  })

  it('три поколения одного импорта дают ОДИН заказ, а не три', () => {
    // v1 и v2 в архиве, v3 активна — считается только последняя.
    const generations: Order[] = [
      { archived: true,  launched: true, quote: false, historical: false },
      { archived: true,  launched: true, quote: false, historical: false },
      { archived: false, launched: true, quote: false, historical: false },
    ]
    expect(generations.filter(counts)).toHaveLength(1)
  })
})
