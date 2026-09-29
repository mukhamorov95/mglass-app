'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useRouter } from 'next/navigation'
import { SEARCH_OPEN_EVENT, type QuickAction, type SearchGroup } from '@/lib/search'

// Поиск с любого экрана (У4): ⌘K / Ctrl+K, «/» вне поля ввода, кнопка в меню
// (событие mg:search-open). Горячей клавиши «N — новый просчёт» нет намеренно:
// одиночная буква уводила бы со страницы с несохранённой формой.


type Resp = { groups: SearchGroup[]; actions: QuickAction[]; error?: string }
type Flat = { key: string; href: string }

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

const rub = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`

export default function CommandPalette() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [data, setData] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => { setOpen(false); setQuery(''); setActive(0) }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(o => !o)
      } else if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !isTypingTarget(e.target)) {
        e.preventDefault()
        setOpen(true)
      }
    }
    const onOpen = () => setOpen(true)
    window.addEventListener('keydown', onKey)
    window.addEventListener(SEARCH_OPEN_EVENT, onOpen)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener(SEARCH_OPEN_EVENT, onOpen) }
  }, [])

  useEffect(() => { if (open) requestAnimationFrame(() => inputRef.current?.focus()) }, [open])

  useEffect(() => {
    if (!open) return
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      setLoading(true)
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: ctrl.signal })
        const j = await r.json().catch(() => ({})) as Resp
        if (!r.ok) throw new Error(j.error || `Сервер ответил ${r.status}`)
        setData(j); setError(null); setActive(0)
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setError((e as Error).message)
      } finally {
        if (!ctrl.signal.aborted) setLoading(false)
      }
    }, query ? 200 : 0)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [query, open])

  const showActions = query.trim().length < 2 && !/\d/.test(query)
  const groups = useMemo(() => (showActions ? [] : data?.groups ?? []), [showActions, data])
  const actions = useMemo(() => (showActions ? data?.actions ?? [] : []), [showActions, data])
  const flat: Flat[] = useMemo(() => showActions
    ? actions.map(a => ({ key: `a${a.href}`, href: a.href }))
    : groups.flatMap(g => g.items.map(i => ({ key: i.id, href: i.href }))),
  [showActions, actions, groups])

  const go = useCallback((href: string) => { close(); router.push(href) }, [close, router])

  const onInputKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); close() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, Math.max(flat.length - 1, 0))) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter' && flat[active]) { e.preventDefault(); go(flat[active].href) }
  }

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!open) return null

  const indexOf = new Map(flat.map((f, i) => [f.key, i]))
  const row = (key: string, href: string, title: string, subtitle?: string, amount?: number | null) => {
    const i = indexOf.get(key) ?? -1
    return (
      <button key={key} type="button" role="option" aria-selected={i === active} data-idx={i}
        id={`mg-search-opt-${i}`}
        onMouseMove={() => setActive(i)} onClick={() => go(href)}
        className={`w-full text-left grid grid-cols-[minmax(0,1fr)_auto] gap-3 items-center px-3 py-2 rounded-lg ${i === active ? 'bg-[#f0f0ec]' : ''}`}>
        <span className="min-w-0">
          <span className="block text-[13.5px] text-[#111110] truncate">{title}</span>
          {subtitle && <span className="block text-[11.5px] text-[#9a9a95] truncate">{subtitle}</span>}
        </span>
        {amount != null && <span className="text-[12.5px] text-[#6b6b66] tabular-nums whitespace-nowrap">{rub(amount)}</span>}
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center px-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Поиск">
      <div className="absolute inset-0 bg-[#111110]/30" onClick={close} />
      <div className="relative w-full max-w-[560px] bg-white border border-[#e4e4e0] rounded-2xl shadow-[0_12px_40px_rgba(17,17,16,0.18)] overflow-hidden">
        <div className="flex items-center gap-2 px-4 border-b border-[#e4e4e0]">
          <span aria-hidden className="text-[#9a9a95] text-[16px]">⌕</span>
          <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={onInputKey}
            placeholder="Номер заказа, клиент, телефон, ИНН"
            role="combobox" aria-expanded="true" aria-controls="mg-search-list"
            aria-activedescendant={flat.length ? `mg-search-opt-${active}` : undefined}
            className="flex-1 min-w-0 py-3.5 text-[15px] text-[#111110] placeholder:text-[#b0b0aa] outline-none bg-transparent" />
          {loading && <span className="text-[11px] text-[#9a9a95]">ищу…</span>}
          <kbd className="text-[10px] text-[#9a9a95] border border-[#e4e4e0] rounded px-1.5 py-0.5">Esc</kbd>
        </div>

        <div ref={listRef} id="mg-search-list" role="listbox" className="max-h-[60vh] overflow-y-auto p-2">
          {error ? (
            <p className="px-3 py-6 text-[13px] text-[#c23a2b]">Поиск не сработал: {error}. Попробуйте ещё раз через пару секунд.</p>
          ) : showActions ? (
            actions.length > 0 ? (
              <div>
                <div className="px-3 pt-1 pb-1 text-[10px] uppercase tracking-widest text-[#9a9a95]">Перейти</div>
                {actions.map(a => row(`a${a.href}`, a.href, a.label))}
              </div>
            ) : (
              <p className="px-3 py-6 text-[13px] text-[#9a9a95]">Введите номер заказа, имя клиента, телефон или ИНН.</p>
            )
          ) : groups.length === 0 ? (
            <p className="px-3 py-6 text-[13px] text-[#9a9a95]">{loading ? 'Ищу…' : 'Ничего не нашлось. Проверьте номер или попробуйте часть имени.'}</p>
          ) : (
            groups.map(g => (
              <div key={g.key} className="mb-1">
                <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-widest text-[#9a9a95]">{g.title}</div>
                {g.items.map(i => row(i.id, i.href, i.title, i.subtitle, i.amount))}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center gap-3 px-4 py-2 border-t border-[#e4e4e0] text-[11px] text-[#9a9a95]">
          <span>↑↓ выбрать</span><span>Enter открыть</span><span className="ml-auto">⌘K или / — поиск с любого экрана</span>
        </div>
      </div>
    </div>
  )
}
