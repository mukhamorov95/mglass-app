'use client'

import type { FinishId } from '@/lib/configurator/catalog'
import { SUPPLIER_RU } from '@/lib/calc/composition'
import type { CatalogModel } from '@/lib/calc/compositionCatalog'
import { Thumb } from './ComposeThumb'

// Чем заменить выбранную деталь (CONSTRUCTOR_ROUTE.md, К9 В1): та же разновидность — кноб на
// кноб, петля стекло-стекло 180° на такую же. Касание меняет деталь в строке; количество и места
// на схеме остаются. Цена изделия пересчитывается сервером, здесь — только закупка из каталога.

const RUBk = (n: number) => `${n.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ₽`

// Чем вариант отличается от соседей: слова названия, которых нет у всех карточек ряда, без
// артикула — серия и особенности («Йота с резиновым торцом», «Регулируемый»). Название целиком
// живёт только в подсказке, а на телефоне подсказок нет.
const low = (w: string) => w.toLowerCase().replace(/ё/g, 'е').replace(/[˚º]/g, '°')
// Род детали, крепление и угол уже в заголовке ряда («Заменить на · стена-стекло 90°»).
const STOP = new Set(['петля', 'петли', 'ручка', 'ручка-кноб', 'ручка-скоба', 'кноб', 'скоба', 'коннектор', 'для', 'стекла',
  'уплотнитель', 'уплотнительный', 'профиль', 'профиля', 'под'])
// Обрывки длины и единиц («3м», «мм-», «2.5») — шум; однобуквенное оставляем только «с» и греческое (серия «Альфа α»).
const letters = (w: string) => (w.match(/[a-zа-я]/g) ?? []).length
const generic = (w: string) => !/^\d+[хx×]\d+$/.test(w) && (STOP.has(w) || /^(стена|стекло)(-|$)/.test(w) || /^\d+(°|с)?([-–]\d+(°|с)?)?$/.test(w)
  || (letters(w) < 2 && !/^(с|[α-ω])$/.test(w)) || /^[\d.,]*(мм|см|м)[-–.]*$/.test(w))
const words = (m: CatalogModel, kind: Set<string>) => m.name.replace(/[()]/g, ' ').split(/[\s,]+/)
  .filter(w => w && !(/[a-z]/i.test(w) && /\d/.test(w)) && !generic(low(w)) && !kind.has(low(w)) && !m.base.toLowerCase().split(/\s+/).includes(w.toLowerCase()))
function hints(ms: CatalogModel[], kindLabel: string): Map<CatalogModel, string> {
  const kind = new Set(kindLabel.split(/[\s·]+/).map(low))
  const per = ms.map(m => words(m, kind))
  const count = new Map<string, number>()
  per.forEach(ws => new Set(ws.map(low)).forEach(w => count.set(w, (count.get(w) ?? 0) + 1)))
  return new Map(ms.map((m, i) => [m, per[i].filter(w => count.get(low(w))! < ms.length).join(' ')]))
}

export function Variants({ current, alts, finishId, kindLabel, inUse, onSwap, onAll, was, limit = 7, cols = 'grid-cols-4 md:grid-cols-8', thumb = 'aspect-[5/4]' }: {
  current: CatalogModel
  alts: CatalogModel[]
  finishId: FinishId
  kindLabel: string
  inUse: (m: CatalogModel) => boolean      // уже другая строка состава — замена сделала бы дубль
  onSwap: (m: CatalogModel) => void
  onAll: () => void
  was?: CatalogModel                       // что стояло до последней замены: касание возвращает его
  limit?: number
  cols?: string                            // сетка зависит от того, где стоит панель: узкая колонка или во всю ширину
  thumb?: string                           // пропорция фото: в узкой панели ниже, чтобы оба ряда помещались
}) {
  const shown = [current, ...alts.slice(0, limit)]
  const hint = hints(shown, kindLabel)
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] text-[#4b4b47]"><b className="text-[#111110]">Заменить на</b> · {kindLabel}</span>
        <button onClick={onAll} className="text-[12px] text-[#2563eb] hover:underline shrink-0">Все {alts.length} →</button>
      </div>
      <div className={`grid ${cols} gap-1.5`}>
        {shown.map(m => {
          const v = m.variants[finishId]
          const now = m === current
          const busy = !now && inUse(m)
          return (
            <button key={`${m.supplier}|${m.base}`} onClick={() => !now && !busy && onSwap(m)} disabled={busy}
              title={`${m.name} · ${SUPPLIER_RU[m.supplier]}`}
              className={`relative text-left bg-white rounded-lg border p-1 flex flex-col gap-0.5 transition-colors disabled:opacity-40 ${now ? 'border-[#111110] ring-1 ring-[#111110]' : 'border-[#e4e4e0] hover:border-[#111110]'}`}>
              <span className="relative block">
                <Thumb src={v?.image ?? m.image} alt={m.name} size={`w-full ${thumb}`} />
                <span className="absolute bottom-0.5 right-0.5 bg-white/90 text-[#6b6b66] text-[9px] rounded px-1 leading-tight">{SUPPLIER_RU[m.supplier]}</span>
              </span>
              {now && <span className="absolute top-1.5 left-1.5 bg-[#111110] text-white text-[9.5px] font-semibold rounded px-1">сейчас</span>}
              {busy && <span className="absolute top-1.5 left-1.5 bg-white text-[#6b6b66] border border-[#e4e4e0] text-[9.5px] rounded px-1">в составе</span>}
              {m === was && !busy && <span className="absolute top-1.5 left-1.5 bg-[#2563eb] text-white text-[9.5px] font-semibold rounded px-1">было</span>}
              <span className="text-[10.5px] font-mono text-[#111110] leading-tight truncate">{m.base}</span>
              {hint.get(m) && <span className="text-[10px] text-[#6b6b66] leading-tight line-clamp-2">{hint.get(m)}</span>}
              <span className="text-[11.5px] font-mono font-semibold text-[#111110] leading-tight">{v ? RUBk(v.cost) : '—'}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
