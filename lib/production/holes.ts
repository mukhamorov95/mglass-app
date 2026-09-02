// Отверстия в изделии: сколько и какого диаметра.
//
// До сих пор существовал только признак hasHoles — «сверлить надо». Он верно
// направлял деталь на станцию сверловки, но не говорил, ЧТО сверлить: мастер
// узнавал количество и диаметры от менеджера голосом или из чертежа, которого
// у 86% заказов нет. Просьба владельца (28.08): указывать при просчёте.
//
// Группа = «N отверстий диаметром D». Их бывает несколько: четыре ⌀12 под петли
// и два ⌀20 под ручку — это одна деталь и две группы.

export type HoleGroup = { d: number; n: number }

export function isValidHole(h: HoleGroup): boolean {
  return Number.isFinite(h.d) && h.d > 0 && Number.isFinite(h.n) && h.n > 0
}

export function normalizeHoles(raw: unknown): HoleGroup[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map(x => {
      const o = x as Record<string, unknown> | null
      return { d: Math.round(Number(o?.d) || 0), n: Math.round(Number(o?.n) || 0) }
    })
    .filter(isValidHole)
}

// Всего отверстий в детали — по нему цех планирует время, а не по числу групп.
export function totalHoles(groups: HoleGroup[]): number {
  return groups.reduce((s, g) => s + g.n, 0)
}

// Подпись для карточки цеха: «4×⌀12 · 2×⌀20».
export function holesLabel(groups: HoleGroup[]): string {
  return groups.filter(isValidHole).map(g => `${g.n}×⌀${g.d}`).join(' · ')
}

// Отверстия заявлены, но не расписаны — деталь уедет к сверловщику без размеров.
// Не ошибка (старые позиции так и заведены), но повод сказать менеджеру.
export function holesIncomplete(hasHoles: boolean, groups: HoleGroup[]): boolean {
  return hasHoles && groups.length === 0
}
