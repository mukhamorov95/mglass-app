// ФП Ф5 (ТЗ §7): заливка фондов по методике за месяц, неделя за неделей.
// 1. База — деньги клиентов завершившейся недели (чт–ср), внедоходные не входят.
// 2. Переменные — % от базы; затем фонды из маржи — % от базы (порядок ТЗ §2).
// 3. Постоянные — недельная потребность по очереди; недостача фонда делится на
//    оставшиеся недели месяца до копейки; следующая неделя снова начинает с первого.
// 4. Избыток идёт вперёд — в потребности следующих недель по очереди (опережение),
//    указатель запоминает, до какой недели и фонда дошло. Когда закрыта потребность
//    всего месяца, остаток — в последний фонд модели.
// Деньги — в копейках; на выходе рубли. Отрицательный % считается нулём.
import { splitKopecks } from '@/lib/finweek'

export type DistFund = {
  id: number; name: string; fund_class: 'variable' | 'fund' | 'fixed'; percent: number | null; sort: number
  monthlyNeed: number | null // постоянные: потребность месяца, ₽; null — % от денег недели
}
export type DistRow = {
  fund_id: number; name: string; fund_class: string
  plan: number      // план пополнения недели (с долями прошлых недостач)
  covered: number   // закрыто раньше опережением
  allocated: number // распределено в эту неделю (своя потребность + опережение)
  short: number     // недозаполнено
  advance: number   // из распределённого — в счёт будущих недель
  badPercent: boolean
}
export type DistWeek = { week_end: string; income: number; rows: DistRow[]; overflow: number; pointer: { week_end: string; fund_id: number } | null }

const k = (v: number) => Math.round(v * 100)
const r = (v: number) => v / 100
const pct = (f: DistFund) => Math.max(0, Number(f.percent ?? 0))

export function distributeMonth(weeks: { week_end: string; income: number }[], funds: DistFund[]): DistWeek[] {
  const order = (c: string) => ({ variable: 0, fund: 1, fixed: 2 } as Record<string, number>)[c] ?? 9
  const fs = [...funds].sort((a, b) => order(a.fund_class) - order(b.fund_class) || a.sort - b.sort || a.id - b.id)
  const fixed = fs.filter(f => f.fund_class === 'fixed')
  const overflowFund = [...funds].sort((a, b) => a.sort - b.sort || a.id - b.id).filter(f => f.fund_class !== 'variable').at(-1) ?? null
  const N = weeks.length
  // need[f][w] — план пополнения постоянного фонда f в неделю w (копейки)
  const need = new Map<number, number[]>()
  const covered = new Map<number, number[]>()
  for (const f of fixed) {
    need.set(f.id, f.monthlyNeed != null ? splitKopecks(k(Math.max(0, f.monthlyNeed)), weeks.map(() => 1)) : weeks.map(() => 0))
    covered.set(f.id, weeks.map(() => 0))
  }
  const out: DistWeek[] = []
  for (let w = 0; w < N; w++) {
    const inc = k(Math.max(0, weeks[w].income))
    let pool = inc
    const rows = new Map<number, DistRow>()
    const row = (f: DistFund): DistRow => {
      if (!rows.has(f.id)) rows.set(f.id, { fund_id: f.id, name: f.name, fund_class: f.fund_class, plan: 0, covered: 0, allocated: 0, short: 0, advance: 0, badPercent: Number(f.percent ?? 0) < 0 })
      return rows.get(f.id)!
    }
    for (const f of fs.filter(x => x.fund_class !== 'fixed')) {
      const plan = Math.round(inc * pct(f) / 100)
      const a = Math.min(pool, plan)
      pool -= a
      Object.assign(row(f), { plan: r(plan), allocated: r(a), short: r(plan - a) })
    }
    for (const f of fixed) {
      if (f.monthlyNeed == null) need.get(f.id)![w] = Math.round(inc * pct(f) / 100)
      const plan = need.get(f.id)![w]
      const pre = covered.get(f.id)![w]
      const want = Math.max(0, plan - pre)
      const a = Math.min(pool, want)
      pool -= a
      const short = want - a
      Object.assign(row(f), { plan: r(plan), covered: r(pre), allocated: r(a), short: r(short) })
      if (short > 0 && w < N - 1 && f.monthlyNeed != null) {
        splitKopecks(short, weeks.slice(w + 1).map(() => 1)).forEach((s, i) => { need.get(f.id)![w + 1 + i] += s })
      }
    }
    let pointer: DistWeek['pointer'] = null
    for (let v = w + 1; v < N && pool > 0; v++) {
      for (const f of fixed) {
        if (f.monthlyNeed == null || pool <= 0) continue
        const open = need.get(f.id)![v] - covered.get(f.id)![v]
        if (open <= 0) continue
        const a = Math.min(pool, open)
        covered.get(f.id)![v] += a
        pool -= a
        const x = row(f)
        x.allocated = r(k(x.allocated) + a)
        x.advance = r(k(x.advance) + a)
        pointer = { week_end: weeks[v].week_end, fund_id: f.id }
      }
    }
    let overflow = 0
    if (pool > 0) {
      overflow = pool
      if (overflowFund) {
        const x = row(overflowFund)
        x.allocated = r(k(x.allocated) + pool)
        x.advance = r(k(x.advance) + pool)
      }
    }
    out.push({ week_end: weeks[w].week_end, income: r(inc), rows: fs.map(f => row(f)), overflow: r(overflow), pointer })
  }
  return out
}

// Распределено фонду за недели месяца — основа остатка фонда.
export function allocatedByFund(dist: DistWeek[]): Map<number, number> {
  const m = new Map<number, number>()
  for (const w of dist) for (const x of w.rows) m.set(x.fund_id, r(k(m.get(x.fund_id) ?? 0) + k(x.allocated)))
  return m
}
