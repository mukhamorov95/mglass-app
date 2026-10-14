// Тексты подтверждения и итога «Брак / переделка» на карточке заказа цеха.
// Подтверждение называет последствие до записи (сколько этапов вернётся в очередь), итог —
// что записано, где деталь теперь лежит и что осталось. Чистые функции — без React и базы.

import { stageLabel } from '@/lib/productionStages'
import { FOUND_AFTER_PRODUCTION } from './rework'

export type ReworkPreview = {
  itemIndex:    number
  foundAtStage: string
  restartStage: string
  reopen:       number
  noRoute:      boolean
}

export type ReworkResult = ReworkPreview & { notified: boolean; warnings: string[] }

function stagesWord(n: number): string {
  const m10 = n % 10, m100 = n % 100
  if (m10 === 1 && m100 !== 11) return 'этап'
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'этапа'
  return 'этапов'
}

export function reworkPreviewLine(p: ReworkPreview): string {
  const pos = `Поз. ${p.itemIndex + 1}`
  if (p.noRoute) return `${pos}: маршрута в цеху нет — запишется только в журнал брака`
  if (p.reopen === 0) {
    return p.foundAtStage === FOUND_AFTER_PRODUCTION
      ? `${pos}: уже прошла цех — маршрут не меняется, о переделке решит менеджер`
      : `${pos}: маршрут не меняется — запишется в журнал брака`
  }
  return `${pos}: заново с этапа «${stageLabel(p.restartStage)}» — в очередь вернётся ${p.reopen} ${stagesWord(p.reopen)}`
}

const posList = (rs: ReworkPreview[]) => rs.map(r => r.itemIndex + 1).join(', ')

export function reworkResultText(results: ReworkResult[], reasonLabel: string): { title: string; detail: string } {
  const title = `Брак записан: ${results.length} поз. — ${reasonLabel}`
  const lines: string[] = []

  const byRestart = new Map<string, ReworkResult[]>()
  for (const r of results.filter(x => x.reopen > 0)) {
    byRestart.set(r.restartStage, [...(byRestart.get(r.restartStage) ?? []), r])
  }
  for (const [stage, rs] of byRestart) {
    lines.push(`Поз. ${posList(rs)} снова в очереди цеха с этапа «${stageLabel(stage)}» — видно в «Моей очереди».`)
  }
  const still = results.filter(x => x.reopen === 0)
  if (still.length) lines.push(`Поз. ${posList(still)}: маршрут не менялся, запись — в журнале брака.`)

  const unnotified = results.filter(x => !x.notified)
  if (unnotified.length === 0) lines.push('Менеджеру отправлено сообщение.')
  else lines.push(`Менеджеру сообщение не ушло (поз. ${posList(unnotified)}) — скажите ему.`)

  for (const r of results) for (const w of r.warnings) lines.push(`Поз. ${r.itemIndex + 1}: ${w}.`)
  return { title, detail: lines.join(' ') }
}
