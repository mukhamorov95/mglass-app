import { describe, it, expect } from 'vitest'
import { kpSectionsFromBom, type BomItem } from '@/lib/kp/bomSections'

const M4: BomItem = {
  title: 'М4 Прямая: стекло-дверь-стекло · 1450×2200 мм', glass: 'прозрачное 8 мм, закалённое', finish: 'чёрный матовый', panels: 3,
  lines: [
    { role: 'hinge', label: 'Петля Афродита FDP-232 стекло-стекло 180°', qty: 2, unit: 'шт' },
    { role: 'handle', label: 'Ручка скоба FDR-76, 20х10х200 межосевое 200', qty: 1, unit: 'шт' },
    { role: 'seal-magnet', label: 'Уплотнитель ПРЕМИУМ магнитный 180°', qty: 1, unit: 'хлыст' },
    { role: 'profile', label: 'Профиль для стекла FDPA-55', qty: 3, unit: 'хлыст' },
  ],
}

describe('Лист 3 КП из строк расчёта (Э7)', () => {
  it('одно изделие: стекло, фурнитура с количеством, профили, цвет', () => {
    const s = kpSectionsFromBom([M4])
    expect(s.map(x => x.title)).toEqual(['Стекло', 'Фурнитура', 'Профили и уплотнители', 'Цвет фурнитуры'])
    expect(s[0].desc).toContain('Прозрачное 8 мм, закалённое, 3 панели')
    expect(s[1].desc).toBe('Петля Афродита FDP-232 стекло-стекло 180° ×2; Ручка скоба FDR-76.')
    expect(s[2].desc).toContain('Профиль для стекла FDPA-55')
    expect(s[3]).toEqual({ n: '✓', title: 'Цвет фурнитуры', desc: 'Чёрный матовый — петли, держатели, ручка, профили.' })
  })

  it('в КП нет ни шаблонной фурнитуры, ни цифр себестоимости', () => {
    const text = JSON.stringify(kpSectionsFromBom([M4]))
    expect(text).not.toMatch(/Dessau|DP-35|VETRO|₽|АВ24/)
  })

  it('несколько изделий: по секции на изделие, общий цвет — строкой', () => {
    const M7 = { ...M4, title: 'М7 Угловая распашная · 1469×916×2200 мм' }
    const s = kpSectionsFromBom([M4, M7])
    expect(s.map(x => x.n)).toEqual(['1', '2', '✓'])
    expect(s[1].title).toBe(M7.title)
    expect(s[0].desc).toContain('профили и уплотнители по контуру')
  })

  it('изделий больше, чем помещается, — хвост назван, а не потерян', () => {
    const s = kpSectionsFromBom([M4, M4, M4, M4, M4])
    expect(s.length).toBe(4)
    expect(s[2].desc).toContain('Ещё изделий: 2')
  })

  it('без строк расчёта — пусто (печать возьмёт типовой текст)', () => {
    expect(kpSectionsFromBom([{ title: 'Зеркало', lines: [] }])).toEqual([])
  })
})

describe('Печать КП: лист 3 берёт состав расчёта', () => {
  it('секции из расчёта попадают в «Схему комплектации», шаблонной фурнитуры нет', async () => {
    const { createElement } = await import('react')
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { default: KpDocument } = await import('@/app/kp/[id]/print/KpDocument')
    const items = [{ name: 'Душевая М4', qty: 1, price: 89104, sum: 89104 }]
    const html = renderToStaticMarkup(createElement(KpDocument, { kp: { number: '0245-0', items, sections: kpSectionsFromBom([M4]) } }))
    expect(html).toContain('Петля Афродита FDP-232 стекло-стекло 180° ×2')
    expect(html).toContain('Чёрный матовый')
    expect(html).not.toMatch(/Dessau|DP-35|VETRO/)
    // КП без строк расчёта — типовой текст, тоже без чужих артикулов и цвета.
    const old = renderToStaticMarkup(createElement(KpDocument, { kp: { number: '0100', items } }))
    expect(old).toContain('СХЕМА КОМПЛЕКТАЦИИ')
    expect(old).not.toMatch(/Dessau|DP-35|VETRO|золото/)
  })
})
