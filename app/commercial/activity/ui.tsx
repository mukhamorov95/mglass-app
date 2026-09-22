// Общие мелочи экрана «Рабочий день менеджеров»: формат чисел и дат.

const WEEKDAY = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']

export const nowTs = () => Math.floor(Date.now() / 1000)
export const weekday = (day: string) => WEEKDAY[new Date(`${day}T12:00:00Z`).getUTCDay()]
export const isWeekend = (day: string) => { const d = new Date(`${day}T12:00:00Z`).getUTCDay(); return d === 0 || d === 6 }
export const shortDay = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}`
export const fmtWait = (min: number | null) =>
  min === null ? '—' : min < 60 ? `${min} мин` : `${Math.floor(min / 60)} ч ${min % 60 ? `${min % 60} мин` : ''}`.trim()
export const fmtRub = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2).replace('.', ',')} млн ₽` : `${Math.round(n / 1000)} тыс ₽`
export const fmtPhone = (d10: string) =>
  d10.length === 10 ? `+7 ${d10.slice(0, 3)} ${d10.slice(3, 6)}-${d10.slice(6, 8)}-${d10.slice(8)}` : d10

export function Num({ v, muted }: { v: number | string; muted?: boolean }) {
  return <span className={muted || v === 0 ? 'text-[#9a9a95]' : 'text-[#111110]'}>{v}</span>
}

export function Card({ title, hint, right, children }: { title: string; hint?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-[#e4e4e0] rounded-xl p-4 mb-4">
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
        <div>
          <h2 className="text-[14px] font-semibold text-[#111110]">{title}</h2>
          {hint && <p className="text-[11px] text-[#9a9a95] mt-0.5">{hint}</p>}
        </div>
        {right}
      </div>
      {children}
    </div>
  )
}
