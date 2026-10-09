import { describe, it, expect } from 'vitest'
import { COMPOSE_TEMPLATES, applyTemplate } from '@/lib/calc/composeTemplates'
import { composeLayout, type LayoutHwIn } from '@/lib/calc/composeLayout'
import { composeAssembly, rowOfKey, rowKey, type AssemblyRow } from '@/lib/calc/composeAssembly'
import type { CompositionRole } from '@/lib/calc/composition'

let n = 0
const uid = () => `id${++n}`

// Роль и название — как их даст каталог: петля/ручка/держатель трубы штучные, профиль и труба —
// погонные «profile», уплотнитель — «seal».
const ROLE: [RegExp, CompositionRole, string][] = [
  [/^FDP-/, 'hinge', 'Петля стекло-стекло'],
  [/^FDR-/, 'handle', 'Ручка скоба'],
  [/^FDC-/, 'stabilizer', 'Крепление трубы'],
  [/^FDT-/, 'profile', 'Труба 30х10'],
  [/^FDPA-/, 'profile', 'Профиль П-образный'],
  [/^FDPP-/, 'seal', 'Уплотнитель'],
  [/^FDS-30/, 'other', 'Ролик с креплением к стеклу'],
  [/^FDS-/, 'other', 'Раздвижная система'],
]

function build(id: string, doorOpen = true) {
  const t = COMPOSE_TEMPLATES.find(x => x.id === id)!
  const a = applyTemplate(t, uid)
  const rows: (AssemblyRow & LayoutHwIn)[] = a.hardware.map((h, i) => {
    const [, role, label] = ROLE.find(([re]) => re.test(h.base))!
    return { id: `r${i}`, role, label: `${label} ${h.base}`, stockMm: role === 'profile' || role === 'seal' ? 2200 : null, qty: h.qty ?? 0, at: h.at, auto: h.auto }
  })
  const { elevation } = composeLayout(a.shape, a.panels.map(p => ({ ...p, w: Number(p.w), h: Number(p.h) })), rows)
  return { rows, elevation, asm: composeAssembly(a.shape, elevation, rows, 8, doorOpen) }
}

describe('3D из состава', () => {
  it('ключ детали ведёт к строке состава', () => {
    expect(rowOfKey(rowKey('ab12', 3))).toBe('ab12')
    expect(rowOfKey(rowKey('ab12', 'm0'))).toBe('ab12')
    expect(rowOfKey('f0-h1')).toBeNull()
  })
  it('две двери в нишу: стёкла своей ширины, по две петли на дверь, двери открыты наружу', () => {
    const { asm } = build('niche-two-doors')
    expect(asm.glass.map(g => +g.size[0].toFixed(3))).toEqual([0.45, 0.45])
    const hinges = asm.hardware.filter(h => rowOfKey(h.key) === 'r0')
    expect(hinges).toHaveLength(4)
    // Петли на стенах: x = 0 и x = 0,9 м, наружу не уходят.
    expect([...new Set(hinges.map(h => +h.pos[0].toFixed(3)))]).toEqual([0, 0.9])
    // Открытая дверь повёрнута, её центр снаружи (z < 0).
    for (const g of asm.glass) { expect(g.rotY).not.toBe(0); expect(g.pos[2]).toBeLessThan(0) }
    expect(asm.niche.walls).toEqual({ back: true, left: true, right: true })
  })
  it('закрытые двери — в линии стёкол', () => {
    const { asm } = build('niche-two-doors', false)
    for (const g of asm.glass) { expect(g.rotY).toBeCloseTo(0); expect(g.pos[2]).toBeCloseTo(0) }
  })
  it('угловая: боковое стекло вдоль глубины у x = ширины фронта, профиль и труба — металл, уплотнители не рисуются', () => {
    const { asm, rows } = build('corner-swing', false)
    const side = asm.glass[2]
    expect(side.pos[0]).toBeCloseTo(1.0)
    expect(side.pos[2]).toBeCloseTo(0.45)
    expect(asm.niche.depth).toBeCloseTo(0.9)
    const sealRows = rows.filter(r => r.role === 'seal').map(r => r.id)
    expect(asm.metal.some(m => sealRows.includes(rowOfKey(m.key)!))).toBe(false)
    expect(asm.metal.filter(m => m.kind === 'rail')).toHaveLength(2)   // труба над неподвижным и над дверью
  })
  it('раздвижная: створка внутри от линии стёкол, ролики на ней', () => {
    const { asm } = build('niche-sliding', false)
    expect(asm.glass[1].pos[2]).toBeCloseTo(0.04)
    expect(asm.hardware.filter(h => h.model === 'roller')).toHaveLength(2)
  })
})
