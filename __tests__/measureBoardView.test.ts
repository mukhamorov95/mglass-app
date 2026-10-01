import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { BoardGrid, type BoardData } from '@/components/measure/MeasureBoard'
import { DEFAULT_SCHEDULE, mskToIso } from '@/lib/measure/slots'

// В проде замерщиков пока нет (решение Р1), поэтому окна доски проверяются здесь:
// что человек прочтёт в сетке при живых замерах, отпуске и чужой заявке.

const data: BoardData = {
  me: { id: 'u-manager', role: 'manager', scope: 'own' },
  from: '2026-10-02', // пятница
  today: '2026-10-02',
  nowMin: 600, // 10:00 МСК
  poolCount: 2,
  measurers: [
    { id: 'm-sergey', name: 'Сергей', schedule: DEFAULT_SCHEDULE },
    { id: 'm-gleb', name: 'Глеб', schedule: DEFAULT_SCHEDULE },
  ],
  daysOff: [{ id: 1, measurer_id: 'm-gleb', date_from: '2026-10-02', date_to: '2026-10-03', note: null }],
  bookings: [
    {
      id: 2, measurer_id: 'm-sergey', measurer_name: 'Сергей', scheduled_at: mskToIso('2026-10-02', '12:00'), duration_min: 90,
      status: 'scheduled', address: 'Красногорск, ул Соловьиная 2', mine: true, deal_number: '0227-0', client_name: 'Елена',
    },
    {
      id: 7, measurer_id: 'm-sergey', measurer_name: 'Сергей', scheduled_at: mskToIso('2026-10-05', '10:00'), duration_min: 90,
      status: 'scheduled', address: 'Мытищи', mine: false, deal_number: null, client_name: null, travel_min: 120,
    },
  ],
}

const html = (pick?: Parameters<typeof BoardGrid>[0]['pick']) =>
  renderToStaticMarkup(createElement(BoardGrid, { data, dur: 90, pick }))
    .replace(/<!-- -->/g, '')

describe('доска занятости — что видно в сетке', () => {
  const out = html()

  it('ближайшее свободное считает дорогу и «сегодня не раньше чем через час»', () => {
    // 10:00 + 60 мин → с 11:00; замер 12:00–13:30 + 60 мин дороги → первое окно с 14:30
    expect(out).toContain('Ближайшее свободное: <b class="text-[#111110]">пт, 2 окт, с 14:30</b> — Сергей')
  })

  it('свой замер — время, номер, клиент и адрес', () => {
    expect(out).toContain('12:00–13:30')
    expect(out).toContain('0227-0 · Елена')
    expect(out).toContain('📍 Красногорск, ул Соловьиная 2')
  })

  it('чужая заявка — только «занято» и адрес, без клиента', () => {
    expect(out).toMatch(/10:00–11:30<\/span>\s*занято/)
    expect(out).toContain('📍 Мытищи')
  })

  it('дорога, которую замерщик заложил сам, видна на доске', () => {
    expect(out).toContain('🚗 дорога до него 120 мин')
  })

  it('отпуск Глеба и воскресенье', () => {
    expect(out).toContain('🌴 выходной')
    expect(out).toContain('не работает по графику')
  })

  it('окна «когда можно начать» и размер пула', () => {
    expect(out).toContain('14:30–16:30')
    expect(out).toContain('В пуле ждут замерщика: <b class="text-amber-700">2</b>')
  })

  it('в режиме выбора окно — кнопка, выбранное подсвечено', () => {
    const picked = html({ durationMin: 90, selected: { measurerId: 'm-sergey', measurerName: 'Сергей', date: '2026-10-02', time: '15:00' }, onPick: () => {} })
    expect(picked).toMatch(/<button[^>]*bg-emerald-600[^>]*>14:30–16:30<\/button>/)
  })
})
