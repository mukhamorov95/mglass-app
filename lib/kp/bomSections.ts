import type { KpSection } from '@/app/kp/[id]/print/KpDocument'

// Лист 3 КП «Схема комплектации» — из строк расчёта, а не из шаблона. Шаблон обещал клиенту
// петлю Dessau-103, ручку DP-35 и «золото VETRO» при любом составе. Здесь — то, что реально
// посчитано: стекло, штучная фурнитура с количеством, профили и уплотнители. Себестоимость
// и поставщик в КП не попадают: это документ клиента.

export type BomLine = { role: string; label: string; qty: number; unit: string }
export type BomItem = { title: string; glass?: string; finish?: string; panels?: number; lines: BomLine[] }

const MAX_SECTIONS = 4
const MAX_LIST = 6

// Название позиции до первой запятой: «Ручка скоба FDR-76, 20х10х200 межосевое 200» → «Ручка скоба FDR-76».
const short = (label: string) => label.split(',')[0].replace(/\s+/g, ' ').trim()

function list(names: string[]): string {
  if (names.length <= MAX_LIST) return names.join('; ')
  return `${names.slice(0, MAX_LIST).join('; ')} и ещё ${names.length - MAX_LIST}`
}

const pieces = (b: BomItem) => b.lines.filter(l => l.unit !== 'хлыст').map(l => (l.qty > 1 ? `${short(l.label)} ×${l.qty}` : short(l.label)))
const bars = (b: BomItem) => [...new Set(b.lines.filter(l => l.unit === 'хлыст').map(l => short(l.label)))]
const glassText = (b: BomItem) => [b.glass, b.panels ? `${b.panels} ${b.panels === 1 ? 'панель' : b.panels < 5 ? 'панели' : 'панелей'}` : ''].filter(Boolean).join(', ')
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function kpSectionsFromBom(items: BomItem[]): KpSection[] {
  const withLines = items.filter(i => i.lines.length > 0)
  if (withLines.length === 0) return []

  // Одно изделие — раскладываем по частям, как в шаблоне: стекло, фурнитура, профили, цвет.
  if (withLines.length === 1) {
    const b = withLines[0]
    const out: KpSection[] = []
    const g = glassText(b)
    if (g) out.push({ n: String(out.length + 1), title: 'Стекло', desc: `${cap(g)}. ${b.title}.` })
    const p = pieces(b)
    if (p.length) out.push({ n: String(out.length + 1), title: 'Фурнитура', desc: `${list(p)}.` })
    const r = bars(b)
    if (r.length) out.push({ n: String(out.length + 1), title: 'Профили и уплотнители', desc: `${list(r)}.` })
    if (b.finish) out.push({ n: '✓', title: 'Цвет фурнитуры', desc: `${cap(b.finish)} — петли, держатели, ручка, профили.` })
    return out
  }

  // Несколько изделий — по секции на изделие; цвет общий — отдельной строкой.
  const finishes = new Set(withLines.map(i => i.finish).filter(Boolean))
  const sameFinish = finishes.size === 1 ? [...finishes][0] : undefined
  const room = sameFinish ? MAX_SECTIONS - 1 : MAX_SECTIONS
  const shown = withLines.slice(0, room)
  const out: KpSection[] = shown.map((b, i) => {
    const parts = [glassText(b), list(pieces(b)), bars(b).length ? 'профили и уплотнители по контуру' : '', !sameFinish && b.finish ? `цвет — ${b.finish}` : '']
    return { n: String(i + 1), title: b.title, desc: `${cap(parts.filter(Boolean).join('. '))}.` }
  })
  if (withLines.length > shown.length) {
    const last = out[out.length - 1]
    last.desc += ` Ещё изделий: ${withLines.length - shown.length} — состав в смете.`
  }
  if (sameFinish) out.push({ n: '✓', title: 'Цвет фурнитуры', desc: `${cap(sameFinish)} — во всех изделиях.` })
  return out
}
