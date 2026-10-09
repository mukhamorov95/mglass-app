import { supplierColorToFinish, type FINISH_IDS } from '@/lib/configurator/pricing'
import { isDefectRow, rowCost, type ColorAxis, type SupplierRowLike } from '@/lib/supplier/colorCode'

// Строки прайса Ветро для конструктора и расчёта по составу (CONSTRUCTOR_ROUTE.md, К5).
// Артикул Ветро — «модель/цвет[/исполнение]»: «Dessau-103/CP.», «Dessau-103/CP/Sa»,
// «MS-90/3000/Black», «DP-70/Diamond BrGold»; у части строк цвета в артикуле нет совсем
// («КП-001», «Binz-11»), он только в поле color. Поэтому модель = артикул без сегмента цвета,
// а цвет — из поля color («Cp (хром полированный)»), как его читает визуализатор.
// colorCode.ts не трогаем: там общий для визуализатора путь «до последнего /».

type FinishId = typeof FINISH_IDS[number]
export type VetroFinish = FinishId | 'clear'

const COLOR_SEG = /^(diamond)?(black|blackgloss|white|gold|brgold|brushedgold|bronze|brbronze|agedbronze|gunmetal|satin|satinnickel|cp|chrome|brchrome|sss|pss|crystal|crystalmatt|polishrose|polishedrose|polishrosegold|brushedrose|rosegold|brrose|brrosegold|anod|an)(-c)?$/

// «Dessau-103/CP.» → «Dessau-103», «Dessau-103/CP/Sa» → «Dessau-103/Sa», «DP-70/Diamond BrGold» →
// «DP-70/Diamond», «MS-90/3000/Black» → «MS-90/3000». Исполнение и длина — часть модели.
export function vetroBase(article: string): string {
  const out: string[] = []
  ;(article || '').split('/').map(s => s.trim()).filter(Boolean).forEach((s, i) => {
    const clean = s.replace(/\.+$/, '')
    if (i === 0) { out.push(clean); return }
    const m = COLOR_SEG.exec(s.toLowerCase().replace(/[\s.]/g, ''))
    if (!m) out.push(clean)
    else if (m[1]) out.push('Diamond')
  })
  return out.join('/')
}

// Базы Ветро шире артикула АВ24: кириллица («КП-001»), апостроф («Casa d'acqua-101»), «=».
export const VETRO_BASE_RE = /^[\p{L}\p{N}][\p{L}\p{N}.,'’()=×+\- /]{1,60}$/u

// Расходник (уплотнитель, порог ПВХ) «Crystal» — прозрачный, подходит к любому цвету фурнитуры.
export function vetroFinish(r: SupplierRowLike, axis: ColorAxis): VetroFinish | null {
  const color = r.color ?? ''
  if (/crystal|прозрачн/i.test(color)) return axis === 'consumable' ? 'clear' : null
  return supplierColorToFinish(color) as FinishId | null
}

// Строка цвета: своя, у расходника — прозрачная, у позиции без цвета — одна на любой цвет.
// Из строк одного цвета — дорогая (то же правило, что у АВ24): цена не занижается.
export function pickVetroRow(rows: SupplierRowLike[], axis: ColorAxis, finish: FinishId): SupplierRowLike | null {
  const usable = rows.filter(r => !isDefectRow(r) && rowCost(r) > 0).sort((a, b) => rowCost(b) - rowCost(a))
  const own = usable.find(r => vetroFinish(r, axis) === finish)
  if (own) return own
  if (axis === 'consumable') {
    const clear = usable.find(r => vetroFinish(r, axis) === 'clear')
    if (clear) return clear
  }
  if (usable.length && usable.every(r => !(r.color ?? '').trim())) return usable[0]
  return null
}

// Строки модели — ровно той же базы: «Dessau-103» не тянет «Dessau-103/Sa» и «Dessau-1030».
export const vetroRowsFor = (base: string, rows: SupplierRowLike[]) =>
  rows.filter(r => !isDefectRow(r) && vetroBase(r.article) === base)

// «Dessau-103/CP. Петля стекло-стекло 180°» → «Петля стекло-стекло 180° Dessau-103»: описание
// с первой русской буквы, без хвоста-цвета в скобках, артикул модели — в конце.
export function vetroModelName(name: string, base: string): string {
  const i = (name || '').search(/[А-Яа-яЁё]/)
  if (i < 0) return name || base
  const desc = name.slice(i).replace(/\s*\([^)]*\)\s*$/, m => (supplierColorToFinish(m) || /прозрачн|чист|кристал/i.test(m) ? '' : m)).replace(/[\s.]+$/, '').trim()
  return `${desc} ${base}`.replace(/\s+/g, ' ').trim()
}
