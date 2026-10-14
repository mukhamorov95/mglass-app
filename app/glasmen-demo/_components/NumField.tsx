'use client'

import { useState } from 'react'

// Числовое поле: пока человек набирает — держим его текст; запятая = точка; не число — рамка
// красная и значение не меняется. После ухода с поля показываем принятое число.
export function parseNum(raw: string): number | null {
  const t = raw.trim().replace(/\s/g, '').replace(',', '.')
  if (!/^-?\d+(\.\d+)?$|^-?\d*\.\d+$/.test(t)) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

export default function NumField({
  value, onChange, id, ariaLabel, className = '', suffix,
}: {
  value: number
  onChange: (n: number) => void
  id?: string
  ariaLabel?: string
  className?: string
  suffix?: string
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? (Number.isFinite(value) ? String(value).replace('.', ',') : '')
  const invalid = draft !== null && parseNum(draft) === null
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        value={shown}
        onChange={e => {
          setDraft(e.target.value)
          const n = parseNum(e.target.value)
          if (n !== null) onChange(n)
        }}
        onBlur={() => setDraft(null)}
        className={`w-full min-w-0 rounded-lg border bg-white px-2 py-1.5 text-right text-[13px] tabular-nums outline-none focus:border-[#111110] ${invalid ? 'border-red-400' : 'border-[#e4e4e0]'}`}
      />
      {suffix && <span className="shrink-0 text-[12px] text-[#9a9a95]">{suffix}</span>}
    </span>
  )
}
