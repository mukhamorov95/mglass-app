// Кто писал клиентам из Wazzup — по таблице wazzup_outgoing_messages, которую пополняет
// вебхук /api/wazzup/webhook. Закрывает дыру amo: там больше половины исходящих без автора.

import { mskDay } from '@/lib/amoActivity'

export type WazzupOutRow = { author_name: string | null; sent_at: string }

export type WazzupAuthor = { name: string; total: number; byDay: Record<string, number>; firstAt: number; lastAt: number }
export type WazzupAuthors = { total: number; noAuthor: number; authors: WazzupAuthor[] }

export function summarizeWazzupOutgoing(rows: WazzupOutRow[]): WazzupAuthors {
  const byName = new Map<string, WazzupAuthor>()
  let noAuthor = 0
  for (const r of rows) {
    const ts = Math.floor(Date.parse(r.sent_at) / 1000)
    if (!Number.isFinite(ts)) continue
    const name = r.author_name?.trim()
    if (!name) { noAuthor++; continue }
    const a = byName.get(name) ?? { name, total: 0, byDay: {}, firstAt: ts, lastAt: ts }
    a.total++
    a.byDay[mskDay(ts)] = (a.byDay[mskDay(ts)] ?? 0) + 1
    a.firstAt = Math.min(a.firstAt, ts)
    a.lastAt = Math.max(a.lastAt, ts)
    byName.set(name, a)
  }
  const authors = [...byName.values()].sort((a, b) => b.total - a.total)
  return { total: authors.reduce((s, a) => s + a.total, 0) + noAuthor, noAuthor, authors }
}

// Имя в Wazzup и имя учётки amo заводили разные люди: сравниваем по первому слову.
export const sameName = (a: string, b: string) =>
  a.trim().split(/\s+/)[0].toLowerCase().replace(/ё/g, 'е') === b.trim().split(/\s+/)[0].toLowerCase().replace(/ё/g, 'е')
