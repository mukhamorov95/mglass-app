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

// hinge — название петли из каталога вместо условного «Петля стекло-стекло FDP-…».
function build(id: string, doorOpen = true, hinge?: string, thk = 8) {
  const t = COMPOSE_TEMPLATES.find(x => x.id === id)!
  const a = applyTemplate(t, uid)
  const rows: (AssemblyRow & LayoutHwIn)[] = a.hardware.map((h, i) => {
    const [, role, label] = ROLE.find(([re]) => re.test(h.base))!
    return { id: `r${i}`, role, label: role === 'hinge' && hinge ? hinge : `${label} ${h.base}`, stockMm: role === 'profile' || role === 'seal' ? 2200 : null, qty: h.qty ?? 0, at: h.at, auto: h.auto }
  })
  const { elevation } = composeLayout(a.shape, a.panels.map(p => ({ ...p, w: Number(p.w), h: Number(p.h) })), rows)
  return { rows, elevation, asm: composeAssembly(a.shape, elevation, rows, thk, doorOpen) }
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
    expect([...new Set(hinges.map(h => +h.pos[0].toFixed(3)))].sort()).toEqual([0, 0.9])
    // Открытая дверь повёрнута, её центр снаружи (z < 0).
    for (const g of asm.glass) { expect(g.rotY).not.toBe(0); expect(g.pos[2]).toBeLessThan(0) }
    expect(asm.niche.walls).toEqual({ back: true, left: true, right: true })
  })
  it('закрытые двери — в линии стёкол', () => {
    const { asm } = build('niche-two-doors', false)
    for (const g of asm.glass) { expect(g.rotY).toBeCloseTo(0); expect(g.pos[2]).toBeCloseTo(0) }
  })
  it('сцена совпадает со схемой: левый край схемы — слева в кадре (x = ширине фронта), ручка у правой стены', () => {
    const { asm, rows } = build('niche-glass-door', false)
    const [fixed, door] = asm.glass
    expect(fixed.pos[0]).toBeCloseTo(0.95)      // неподвижное 500 мм у левой стены: x 1,2…0,7
    expect(door.pos[0]).toBeCloseTo(0.35)       // дверь 700 мм у правой стены: x 0,7…0
    const xs = (role: string) => asm.hardware.filter(h => rowOfKey(h.key) === rows.find(r => r.role === role)!.id).map(h => h.pos[0])
    expect(Math.max(...xs('handle'))).toBeLessThan(Math.min(...xs('hinge')))
  })
  it('угловая: боковое стекло вдоль глубины у x = 0 (угол справа, как на схеме), профиль и труба — металл, уплотнители не рисуются', () => {
    const { asm, rows } = build('corner-swing', false)
    const side = asm.glass[2]
    expect(side.pos[0]).toBeCloseTo(0)
    expect(side.pos[2]).toBeCloseTo(0.45)
    expect(asm.niche.depth).toBeCloseTo(0.9)
    expect(asm.niche.walls).toEqual({ back: true, left: false, right: true })
    const sealRows = rows.filter(r => r.role === 'seal').map(r => r.id)
    expect(asm.metal.some(m => sealRows.includes(rowOfKey(m.key)!))).toBe(false)
    expect(asm.metal.filter(m => m.kind === 'rail')).toHaveLength(2)   // труба над неподвижным и над дверью
  })
  it('угловая раздвижная: оба боковых стекла в глубине ниши — неподвижное у задней стены, створка у угла и внутри', () => {
    const { asm } = build('corner-sliding', false)
    const side = asm.glass.slice(2)
    expect(side.map(g => +g.pos[2].toFixed(3)).sort()).toEqual([0.25, 0.75])
    const fixed = side.find(g => g.role === 'fixed')!, slide = side.find(g => g.role === 'door')!
    expect(fixed.pos[2]).toBeCloseTo(0.75)
    expect(fixed.pos[0]).toBeCloseTo(0)
    expect(slide.pos[0]).toBeCloseTo(0.04)
  })
  it('раздвижная: створка внутри от линии стёкол, ролики на ней', () => {
    const { asm } = build('niche-sliding', false)
    expect(asm.glass[1].pos[2]).toBeCloseTo(0.04)
    expect(asm.hardware.filter(h => h.model === 'roller')).toHaveLength(2)
  })
  it('петля из каталога с паспортом рисуется паспортом в той же точке кромки; без паспорта и не под то стекло — общей формой', () => {
    const plain = build('niche-glass-door', false)
    const hingesOf = (b: ReturnType<typeof build>) => b.asm.hardware.filter(h => rowOfKey(h.key) === b.rows.find(r => r.role === 'hinge')!.id)
    expect(hingesOf(plain).every(h => h.shape === 'hinge-glass' && !h.part)).toBe(true)
    for (const [name, part] of [['Dessau-103/CP. Петля стекло-стекло 180°', 'hinge-dessau-103'], ['Balge-004/Satin/Sa. Петля стекло-стекло 135°-180°', 'hinge-balge-004']]) {
      const hs = hingesOf(build('niche-glass-door', false, name))
      expect(hs).toHaveLength(3)
      expect(hs.every(h => h.part === part)).toBe(true)
      hs.forEach((h, i) => {
        expect(h.pos[0]).toBeCloseTo(hingesOf(plain)[i].pos[0], 6)
        expect(h.pos[1]).toBeCloseTo(hingesOf(plain)[i].pos[1], 6)
        expect(h.pos[2]).toBeCloseTo(hingesOf(plain)[i].pos[2], 6)
      })
      // паспорт под 8–10 мм: на шестёрке не врём формой, остаётся общая петля
      expect(hingesOf(build('niche-glass-door', false, name, 6)).every(h => h.shape === 'hinge-glass' && !h.part)).toBe(true)
    }
  })
})
