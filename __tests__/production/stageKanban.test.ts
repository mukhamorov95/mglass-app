import { describe, it, expect } from 'vitest'
import { kanbanColumn, orderMaterials, daysLeft, kanbanSort, kanbanMatch, onKanban, materialLine } from '@/lib/production/stageKanban'

const t = (stage_key: string, done: boolean) => ({ stage_key, status: done ? 'done' : 'queued' })

describe('табло цеха по этапам', () => {
  it('колонка — самый ранний этап с незакрытой деталью', () => {
    expect(kanbanColumn([], false)).toBe('new')
    expect(kanbanColumn([t('cutting', false), t('polishing', false)], false)).toBe('new')
    expect(kanbanColumn([t('cutting', true), t('polishing', false), t('packaging', false)], false)).toBe('polishing')
    // одна деталь не нарезана — заказ ещё на резке, хотя другая уже отполирована
    expect(kanbanColumn([t('cutting', true), t('polishing', true), t('cutting', false), t('polishing', false)], false)).toBe('cutting')
    expect(kanbanColumn([t('cutting', true), t('packaging', true)], false)).toBe('packed')
    expect(kanbanColumn([t('cutting', false)], true)).toBe('shipped')
    expect(kanbanColumn([t('cutting', true), t('weird', false)], false)).toBe('packaging')
  })
  it('материалы: стекло и зеркало раздельно, триплекс по стёклам', () => {
    const m = orderMaterials([
      { materialName: 'Осветлённое CrystalVision', category: 'стекло', thickness: 8, quantity: 2 },
      { materialName: 'Осветлённое CrystalVision', category: 'стекло', thickness: 8, quantity: 1 },
      { materialName: 'Осветлённое', category: 'зеркало', thickness: 4, quantity: 1 },
      { materialName: 'Триплекс', category: 'стекло', thickness: 10, quantity: 1, hasTriplex: true, triplexGlasses: [{ materialName: 'Прозрачное', thickness: 5 }, { materialName: 'Прозрачное', thickness: 5 }] },
      { materialName: 'Монтаж', category: 'услуга', quantity: 1 },
    ])
    expect(m.map(materialLine)).toEqual(['Зеркало Осветлённое 4 мм', 'Стекло Прозрачное 5 мм', 'Стекло Осветлённое CrystalVision 8 мм'])
    expect(m.find(x => x.thickness === 8)?.pieces).toBe(3)
    expect(m.find(x => x.thickness === 5)?.pieces).toBe(2)
  })
  it('дни до отгрузки, порядок, поиск, отгруженные за неделю', () => {
    expect(daysLeft('2026-11-28', '2026-11-25')).toBe(3)
    expect(daysLeft('2026-11-23', '2026-11-25')).toBe(-2)
    expect(daysLeft(null, '2026-11-25')).toBeNull()
    const base = { client: 'ГлассДекор', column: 'new' as const, materials: [] }
    const list = kanbanSort([{ ...base, id: 1, no: '1', launch_day: '2026-11-01' }, { ...base, id: 2, no: '2', launch_day: '2026-11-20' }])
    expect(list.map(o => o.id)).toEqual([2, 1])
    expect(kanbanMatch({ ...base, id: 5, no: '05522', launch_day: null }, 'гласс 0552')).toBe(true)
    expect(kanbanMatch({ ...base, id: 5, no: '05522', launch_day: null }, 'зеркало')).toBe(false)
    expect(onKanban({ column: 'shipped', ship_day: '2026-11-20' }, '2026-11-25')).toBe(true)
    expect(onKanban({ column: 'shipped', ship_day: '2026-11-10' }, '2026-11-25')).toBe(false)
  })
})
