'use client'

import type { LiveCheck } from '@/lib/health/liveChecks'

// «Всё ли работает» — живые проверки AI Control Center. Красное и жёлтое — с тем,
// что сломалось и что делать; зелёное — одной строкой.

export type LiveHealth = { checks: LiveCheck[]; at: string } | { error: string } | null

const DOT: Record<LiveCheck['status'], string> = { ok: 'bg-emerald-500', warn: 'bg-amber-400', fail: 'bg-red-500' }
const BOX: Record<LiveCheck['status'], string> = {
  ok: 'border-[#e8e8e5] bg-white',
  warn: 'border-amber-200 bg-amber-50/60',
  fail: 'border-red-200 bg-red-50/70',
}

export function liveSummary(h: LiveHealth): { fail: number; warn: number } | null {
  if (!h || 'error' in h) return null
  return { fail: h.checks.filter(c => c.status === 'fail').length, warn: h.checks.filter(c => c.status === 'warn').length }
}

export default function LiveHealthPanel({ health, onRefresh, loading }: { health: LiveHealth; onRefresh: () => void; loading: boolean }) {
  const order: Record<LiveCheck['status'], number> = { fail: 0, warn: 1, ok: 2 }
  const checks = health && !('error' in health) ? [...health.checks].sort((a, b) => order[a.status] - order[b.status]) : []
  return (
    <div className="bg-white rounded-xl border border-[#e8e8e5] p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[13px] font-semibold text-[#2a2a28]">Всё ли работает</p>
        <div className="flex items-center gap-3">
          {health && !('error' in health) && (
            <span className="text-[11px] text-[#9a9a95]">
              проверено {new Date(health.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' })} МСК
            </span>
          )}
          <button onClick={onRefresh} disabled={loading}
            className="text-[11px] font-medium px-2.5 py-1 rounded-lg border border-[#d8d8d4] text-[#4a4a46] hover:bg-[#f0f0ec] disabled:opacity-40">
            {loading ? 'Проверяю…' : 'Проверить ещё раз'}
          </button>
        </div>
      </div>
      {!health && <p className="text-[12px] text-[#9a9a95]">Проверяю AI, книги, AmoCRM…</p>}
      {health && 'error' in health && <p role="alert" className="text-[12px] text-red-700">Проверки не выполнились: {health.error}</p>}
      <div className="space-y-2">
        {checks.map(c => (
          <div key={c.id} className={`rounded-lg border px-3 py-2 ${BOX[c.status]}`}>
            <div className="flex items-start gap-2">
              <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${DOT[c.status]}`} />
              <div className="min-w-0">
                <p className="text-[12px] text-[#111110]">
                  <span className="font-semibold">{c.title}</span>
                  <span className={c.status === 'ok' ? 'text-[#6b6b66]' : c.status === 'fail' ? 'text-red-700' : 'text-amber-800'}> — {c.detail}</span>
                </p>
                {c.action && c.status !== 'ok' && <p className="text-[11px] text-[#4a4a46] mt-0.5">→ {c.action}</p>}
              </div>
            </div>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-[#b4b4ae] mt-3">
        При красном в 9:30 и 14:30 МСК приходит сообщение в Telegram. Журнал запусков всех кронов — следующий этап.
      </p>
    </div>
  )
}
