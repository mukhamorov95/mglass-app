'use client'

// Вечерний отчёт в Telegram: два списка за сегодня и кнопка «скопировать».
//
// Никита каждый вечер набирает эти номера в столбик руками, хотя сам же отмечал
// упаковку и отгрузку здесь. Кнопка отдаёт ровно тот текст, который он печатает.
//
// Автоотправки в группу нет и не будет: владелец просил «нажал — скопировал —
// вставил сам». Человек видит текст перед отправкой, и списки на экране — не
// довесок к кнопке, а половина задачи: он должен понимать, что сегодня ушло.

import { useRef, useState } from 'react'
import { copyList, ordersCount } from '@/lib/production/dayLists'

export type ReportRow = { id: number; number: string; client: string; remaining?: number | null }

async function toClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Планшет цеха может отдать буфер только через выделение — старый путь
    // держим как запасной, иначе кнопка молча ничего не делает.
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch { return false }
  }
}

export default function DayReport({ title, rows, hint }: { title: string; rows: ReportRow[]; hint?: string }) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle')
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const text = copyList(rows)

  // Если буфер недоступен, «выделите текст» должно быть выполнимо: список на
  // экране идёт вперемешку с именами клиентов, и выделить из него одни номера
  // руками нельзя. Поэтому показываем поле ровно с тем текстом, что уходит в
  // группу. Выделяем сами, но и по нажатию на поле тоже: программный фокус
  // срабатывает не во всех обстоятельствах, а запасной путь обязан работать
  // именно тогда, когда основной уже отказал.
  async function copy() {
    const ok = await toClipboard(text)
    setState(ok ? 'ok' : 'fail')
    if (!ok) requestAnimationFrame(() => { areaRef.current?.focus(); areaRef.current?.select() })
  }

  return (
    <div className="bg-white rounded-xl border border-[#e4e4e0] px-4 py-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-[#111110]">{title}</p>
          <p className="text-[11px] text-[#9a9a95]">{rows.length === 0 ? 'пока пусто' : ordersCount(rows.length)}</p>
        </div>
        {rows.length > 0 && (
          <button
            onClick={copy}
            className={`px-4 py-2.5 rounded-lg text-[13px] font-semibold flex-shrink-0 ${
              state === 'ok' ? 'bg-emerald-600 text-white' : 'bg-[#111110] text-white hover:bg-black'}`}>
            {state === 'ok' ? '✓ Скопировано' : state === 'fail' ? 'Не вышло — выделите текст' : '📋 Скопировать'}
          </button>
        )}
      </div>

      {rows.length > 0 && (
        <div className="mt-2 rounded-lg bg-[#f8f8f7] border border-[#eceff1] px-3 py-2">
          {rows.map(r => (
            <p key={r.id} className="text-[13px] font-mono text-[#111110] leading-relaxed">
              {r.number}
              {r.remaining && r.remaining > 0 ? <span className="text-[#6b6b66]">{`( осталось ${r.remaining} шт)`}</span> : null}
              <span className="text-[11px] font-sans text-[#9a9a95] ml-2">{r.client}</span>
            </p>
          ))}
        </div>
      )}

      {state === 'fail' && (
        <textarea ref={areaRef} readOnly value={text} rows={Math.min(rows.length, 12)}
          onFocus={e => e.currentTarget.select()} onClick={e => e.currentTarget.select()}
          className="mt-2 w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-[13px] font-mono text-[#111110] outline-none" />
      )}

      {hint && <p className="text-[11px] text-[#9a9a95] mt-2">{hint}</p>}
    </div>
  )
}
