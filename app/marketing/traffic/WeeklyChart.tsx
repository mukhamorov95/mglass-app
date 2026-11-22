import type { WeekRow } from '@/lib/marketing/traffic'

// Линии по неделям: визиты всего и с поиска Яндекс/Google. Одна ось — все три в визитах.
// Неполная текущая неделя — пунктиром и полой точкой: её нельзя сравнивать с полными.

const SERIES = [
  { key: 'visits', label: 'Все визиты', color: '#2a78d6' },
  { key: 'yandex', label: 'Поиск Яндекс', color: '#eb6834' },
  { key: 'google', label: 'Поиск Google', color: '#1baf7a' },
] as const

const W = 720
const H = 260
const PAD = { l: 40, r: 16, t: 12, b: 28 }

const short = (s: string) => `${s.slice(8, 10)}.${s.slice(5, 7)}`
export const weekLabel = (w: { from: string; to: string }) => `${short(w.from)}–${short(w.to)}`

function niceMax(v: number) {
  if (v <= 5) return 5
  const p = 10 ** Math.floor(Math.log10(v))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p
  return 10 * p
}

export function WeeklyChart({ weeks }: { weeks: WeekRow[] }) {
  const n = weeks.length
  const max = niceMax(Math.max(1, ...weeks.map((w) => w.visits)))
  const x = (i: number) => PAD.l + (n === 1 ? 0 : (i * (W - PAD.l - PAD.r)) / (n - 1))
  const y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - v / max)
  const ticks = [0, 0.2, 0.4, 0.6, 0.8, 1].map((f) => Math.round(max * f))
  const lastFull = weeks.findLastIndex((w) => !w.partial)

  return (
    <figure className="m-0">
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#111110]/80">
        {SERIES.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 rounded" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
        <span className="text-[#9a9a95]">пунктир — текущая неделя, ещё идёт</span>
      </div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[560px]" role="img" aria-label="Визиты по неделям">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="#e4e4e0" strokeWidth={1} />
              <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="#9a9a95">{t}</text>
            </g>
          ))}
          {weeks.map((w, i) => (
            <text key={w.from} x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill="#9a9a95">
              {i % 2 === (n - 1) % 2 || n <= 8 ? short(w.from) : ''}
            </text>
          ))}
          {SERIES.map((s) => {
            const pts = weeks.map((w, i) => `${x(i)},${y(w[s.key])}`)
            const solid = pts.slice(0, lastFull + 1).join(' ')
            const dashed = lastFull >= 0 && lastFull < n - 1 ? pts.slice(lastFull).join(' ') : ''
            return (
              <g key={s.key}>
                <polyline points={solid} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {dashed && <polyline points={dashed} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray="4 4" />}
                {weeks.map((w, i) => (
                  <circle key={w.from} cx={x(i)} cy={y(w[s.key])} r={4} fill={w.partial ? '#fff' : s.color} stroke={w.partial ? s.color : '#fff'} strokeWidth={2} />
                ))}
              </g>
            )
          })}
          {weeks.map((w, i) => (
            <rect key={w.from} x={x(i) - (W - PAD.l - PAD.r) / Math.max(1, n - 1) / 2} y={PAD.t} width={(W - PAD.l - PAD.r) / Math.max(1, n - 1)} height={H - PAD.t - PAD.b} fill="transparent">
              <title>{`${weekLabel(w)}${w.partial ? ' (идёт)' : ''}\nВсе визиты: ${w.visits}\nЯндекс: ${w.yandex}\nGoogle: ${w.google}\nЗаявок: ${w.leads}`}</title>
            </rect>
          ))}
        </svg>
      </div>
      <figcaption className="mt-1 text-xs text-[#9a9a95]">Ось — визиты за неделю; наведите на неделю, чтобы увидеть числа. Таблица со всеми источниками — ниже.</figcaption>
    </figure>
  )
}
