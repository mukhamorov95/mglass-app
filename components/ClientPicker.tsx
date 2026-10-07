'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { searchByName } from '@/lib/search/translitMatch'

// Выбор клиента вводом вместо длинного списка (просьба владельца 07.10). Ищет в обоих
// алфавитах (lib/search/translitMatch.ts): «шо» — ShowerGlass, «гласс» — M GLASS; по юрлицам,
// контакту и ИНН. Пустое значение — «без клиента», если его разрешили.

export type ClientOption = {
  id: number
  label: string
  // Что ещё ищется: юрлица, контакт, ИНН. Первое совпавшее показывается под названием.
  extra?: (string | null | undefined)[]
}

export default function ClientPicker({ options, value, onChange, noneLabel, placeholder = 'Начните вводить: «шо», «гласс», ИНН…' }: {
  options: ClientOption[]
  value: number | null
  onChange: (id: number | null) => void
  // Задан — в списке есть пункт «без клиента».
  noneLabel?: string
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const selected = options.find(o => o.id === value) ?? null
  const found = useMemo(() => searchByName(options, query, o => [o.label, ...(o.extra ?? [])], 50), [options, query])
  const rows: (ClientOption | null)[] = noneLabel && !query.trim() ? [null, ...found] : found

  useEffect(() => {
    const close = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [active])

  function pick(o: ClientOption | null) {
    onChange(o ? o.id : null)
    setOpen(false)
    setQuery('')
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(a => Math.min(a + 1, rows.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') { if (open && rows.length) { e.preventDefault(); pick(rows[Math.min(active, rows.length - 1)]) } }
    else if (e.key === 'Escape') { setOpen(false); setQuery('') }
  }

  // Под названием — юрлицо или контакт, по которому нашли: иначе «литвин» → «СпецМонтаж» непонятно.
  const hint = (o: ClientOption) => {
    if (!query.trim()) return null
    const own = searchByName([o.label], query, s => [s], 1).length > 0
    if (own) return null
    return (o.extra ?? []).find(x => x && searchByName([x], query, s => [s], 1).length > 0) ?? null
  }

  return (
    <div ref={boxRef} className="relative">
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        value={open ? query : (selected?.label ?? '')}
        placeholder={open ? placeholder : (noneLabel ?? placeholder)}
        onFocus={() => { setOpen(true); setQuery(''); setActive(0) }}
        onChange={e => { setQuery(e.target.value); setOpen(true); setActive(0) }}
        onKeyDown={onKey}
        // Tab из поля закрывает список; клик по пункту фокус не снимает (onMouseDown + preventDefault).
        onBlur={() => { setOpen(false); setQuery('') }}
        className="w-full bg-white border border-[#e4e4e0] rounded-lg pl-3 pr-9 py-2 text-[13px] text-[#111110] outline-none placeholder:text-[#9a9a95]"
      />
      {selected && !open && noneLabel && (
        <button type="button" aria-label="Убрать клиента" onClick={() => pick(null)}
          className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full text-[#9a9a95] hover:text-[#111110] hover:bg-[#f0f0ec]">×</button>
      )}
      {open && (
        <ul ref={listRef} role="listbox"
          className="absolute z-30 left-0 right-0 mt-1 max-h-[320px] overflow-auto bg-white border border-[#e4e4e0] rounded-xl shadow-lg py-1">
          {rows.length === 0 && (
            <li className="px-3 py-2 text-[12px] text-[#9a9a95]">Ничего не нашлось{noneLabel ? ' — можно оставить без клиента или завести нового' : ''}</li>
          )}
          {rows.map((o, i) => {
            const h = o ? hint(o) : null
            return (
              <li key={o?.id ?? 'none'} role="option" aria-selected={i === active}
                onMouseDown={e => { e.preventDefault(); pick(o) }}
                onMouseEnter={() => setActive(i)}
                className={`px-3 py-2 cursor-pointer text-[13px] ${i === active ? 'bg-[#f0f0ec]' : ''} ${o?.id === value ? 'font-semibold' : ''} ${o ? 'text-[#111110]' : 'text-[#6b6b66]'}`}>
                {o ? o.label : noneLabel}
                {h && <span className="block text-[11px] text-[#9a9a95] truncate">{h}</span>}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
