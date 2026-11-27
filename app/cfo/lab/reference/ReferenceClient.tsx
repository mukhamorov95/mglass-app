'use client'

import { Fragment, useMemo, useState } from 'react'
import Link from 'next/link'
import type { Param, Reference } from '@/lib/economics/engine/reference'
import type { RefHistoryRow } from '@/lib/lab/store'
import { STATUS_LABEL, type Status } from '@/lib/economics/values'

type RefId = 'tech' | 'finance'
type Draft = { lo: string; hi: string; status: Status; source: string }

const num = (x: number | null) => (x == null ? '' : String(x))
const same = (p: Param, d: Draft) =>
  num(p.lo) === d.lo.trim() && num(p.hi) === d.hi.trim() && p.status === d.status && p.source === d.source.trim()

const STATUSES: Status[] = ['document', 'measured', 'owner', 'hypothesis', 'missing']

export default function ReferenceClient({ refs, stamps, source, history }: {
  refs: Record<RefId, Reference | null>
  stamps: Record<RefId, string | null>
  source: Record<RefId, string | null>
  history: Record<RefId, { rows: RefHistoryRow[]; error: string | null }>
}) {
  const [tab, setTab] = useState<RefId>('tech')
  const [q, setQ] = useState('')
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [showHistory, setShowHistory] = useState(false)

  const ref = refs[tab]
  const params = useMemo(() => {
    const list = ref?.params ?? []
    const needle = q.toLowerCase().trim()
    const found = needle
      ? list.filter(p => p.key.toLowerCase().includes(needle) || p.label.toLowerCase().includes(needle) || p.group.toLowerCase().includes(needle))
      : list
    return [...found].sort((a, b) => a.group.localeCompare(b.group, 'ru') || a.label.localeCompare(b.label, 'ru'))
  }, [ref, q])

  const draftOf = (p: Param): Draft =>
    drafts[`${tab}:${p.key}`] ?? { lo: num(p.lo), hi: num(p.hi), status: p.status, source: p.source }
  const set = (p: Param, patch: Partial<Draft>) =>
    setDrafts(d => ({ ...d, [`${tab}:${p.key}`]: { ...draftOf(p), ...patch } }))

  // Изменённым считается норматив, у которого хоть одно поле отличается от справочника:
  // открытая на экране строка без правки в новую версию не попадает.
  const changed = (ref?.params ?? []).filter(p => {
    const d = drafts[`${tab}:${p.key}`]
    return d && !same(p, d)
  })

  async function save() {
    if (!changed.length || !reason.trim()) return
    setBusy(true); setMsg(null)
    const edits: Record<string, { lo: string | null; hi: string | null; status: Status; source: string }> = {}
    for (const p of changed) {
      const d = draftOf(p)
      edits[p.key] = { lo: d.lo.trim() || null, hi: d.hi.trim() || null, status: d.status, source: d.source }
    }
    try {
      const res = await fetch('/api/cfo/lab/reference', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ref: tab, reason, edits }),
      })
      const out = await res.json()
      if (!res.ok) { setMsg({ kind: 'err', text: String(out.error ?? 'не сохранилось') }); return }
      setMsg({ kind: 'ok', text: `Версия ${out.version}, изменено нормативов: ${out.changed}. Отпечаток ${out.stamp}. Страницу нужно обновить, чтобы увидеть новую версию.` })
      setDrafts({}); setReason('')
    } catch (e) {
      setMsg({ kind: 'err', text: String(e) })
    } finally { setBusy(false) }
  }

  const hist = history[tab]

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-[#111110]">Справочник нормативов</h1>
          <p className="mt-1 text-sm text-[#9a9a95]">
            Правка создаёт новую версию: прежняя целиком уходит в историю, в новой записано, что было и почему
            изменилось. Сохранённые варианты расчётов остаются на своих нормах — они не пересчитываются сами.
          </p>
        </div>
        <Link href="/cfo/lab" className="shrink-0 text-sm text-[#9a9a95] underline">← к расчётам</Link>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {(['tech', 'finance'] as const).map(id => (
          <button key={id} onClick={() => { setTab(id); setMsg(null) }}
            className={`rounded-md px-3 py-1.5 text-sm ${tab === id ? 'bg-[#111110] text-white' : 'border border-[#e4e4e0] bg-white text-[#111110]'}`}>
            {id === 'tech' ? 'Технические нормативы' : 'Финансовые параметры'}
          </button>
        ))}
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="поиск по названию, группе или ключу"
          className="ml-auto w-72 rounded-md border border-[#e4e4e0] bg-white px-3 py-1.5 text-sm" />
      </div>

      <p className="mt-2 text-xs text-[#9a9a95]">
        Источник: {source[tab] ?? 'не загружен'} · отпечаток {stamps[tab] ?? '—'} ·
        нормативов {ref?.params.length ?? 0}{q ? `, показано ${params.length}` : ''}
        {ref ? ` · версия ${ref.version} от ${ref.date}, ${ref.author}: ${ref.reason}` : ''}
      </p>
      {tab === 'finance' && (
        <p className="mt-1 text-xs text-amber-700">
          Здесь ставки, выведенные из окладов. Экран открыт владельцу, CEO и CFO; на других экранах этих цифр нет.
        </p>
      )}

      {!ref && (
        <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          Справочник не загружен — править нечего.
        </p>
      )}

      {ref && (
        <div className="mt-4 overflow-x-auto rounded-lg border border-[#e4e4e0] bg-white">
          <table className="w-full text-sm">
            <thead className="bg-[#f5f5f3] text-xs text-[#9a9a95]">
              <tr>
                <th className="px-3 py-2 text-left font-normal">Норматив</th>
                <th className="px-3 py-2 text-right font-normal">от</th>
                <th className="px-3 py-2 text-right font-normal">до</th>
                <th className="px-3 py-2 text-left font-normal">единица</th>
                <th className="px-3 py-2 text-left font-normal">статус</th>
                <th className="px-3 py-2 text-left font-normal">источник</th>
              </tr>
            </thead>
            <tbody>
              {params.map((p, i) => {
                const d = draftOf(p)
                const dirty = !same(p, d)
                const head = i === 0 || params[i - 1].group !== p.group
                return (
                  <Fragment key={p.key}>
                  {head && (
                    <tr className="border-t border-[#e4e4e0] bg-[#f5f5f3]">
                      <td colSpan={6} className="px-3 py-1.5 text-xs font-semibold text-[#111110]">{p.group}</td>
                    </tr>
                  )}
                  <tr className={`border-t border-[#e4e4e0] ${dirty ? 'bg-amber-50' : ''}`}>
                    <td className="px-3 py-2">
                      <div className="text-[#111110]">{p.label}</div>
                      <div className="text-xs text-[#9a9a95]">{p.key}</div>
                      {dirty && (
                        <div className="text-xs text-amber-700">
                          было {p.lo == null ? 'нет значения' : `${p.lo}…${p.hi}`} ({STATUS_LABEL[p.status]})
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input value={d.lo} onChange={e => set(p, { lo: e.target.value })} inputMode="decimal"
                        className="w-24 rounded border border-[#e4e4e0] px-2 py-1 text-right" />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input value={d.hi} onChange={e => set(p, { hi: e.target.value })} inputMode="decimal"
                        className="w-24 rounded border border-[#e4e4e0] px-2 py-1 text-right" />
                    </td>
                    <td className="px-3 py-2 text-xs text-[#9a9a95]">{p.unit}</td>
                    <td className="px-3 py-2">
                      <select value={d.status} onChange={e => set(p, { status: e.target.value as Status })}
                        className="rounded border border-[#e4e4e0] px-2 py-1 text-xs">
                        {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input value={d.source} onChange={e => set(p, { source: e.target.value })}
                        className="w-64 rounded border border-[#e4e4e0] px-2 py-1 text-xs" />
                    </td>
                  </tr>
                  </Fragment>
                )
              })}
              {params.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-sm text-[#9a9a95]">Ничего не нашлось.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {ref && (
        <div className="mt-4 rounded-lg border border-[#e4e4e0] bg-white p-4">
          <p className="text-sm text-[#111110]">
            Изменено нормативов: <span className="font-semibold">{changed.length}</span>
            {changed.length > 0 && <span className="text-[#9a9a95]"> — {changed.slice(0, 5).map(p => p.label).join(', ')}{changed.length > 5 ? ' и ещё…' : ''}</span>}
          </p>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2}
            placeholder="Причина изменения — обязательно: откуда новое значение (хронометраж, паспорт станка, договор, решение владельца)"
            className="mt-2 w-full rounded-md border border-[#e4e4e0] px-3 py-2 text-sm" />
          <div className="mt-2 flex items-center gap-3">
            <button onClick={save} disabled={busy || !changed.length || !reason.trim()}
              className="rounded-md bg-[#111110] px-4 py-2 text-sm text-white disabled:bg-[#e4e4e0] disabled:text-[#9a9a95]">
              {busy ? 'Сохраняю…' : 'Сохранить новую версию'}
            </button>
            {!!Object.keys(drafts).length && (
              <button onClick={() => { setDrafts({}); setMsg(null) }} className="text-sm text-[#9a9a95] underline">
                Отменить правки
              </button>
            )}
            {!changed.length && <span className="text-xs text-[#9a9a95]">Пока нечего сохранять.</span>}
            {changed.length > 0 && !reason.trim() && <span className="text-xs text-[#9a9a95]">Без причины сохранить нельзя.</span>}
          </div>
          {msg && (
            <p className={`mt-2 text-sm ${msg.kind === 'ok' ? 'text-emerald-700' : 'text-amber-800'}`}>{msg.text}</p>
          )}
        </div>
      )}

      <div className="mt-4 rounded-lg border border-[#e4e4e0] bg-white p-4">
        <button onClick={() => setShowHistory(v => !v)} className="text-sm font-semibold text-[#111110]">
          История версий {showHistory ? '▾' : '▸'} <span className="font-normal text-[#9a9a95]">({hist.rows.length})</span>
        </button>
        {hist.error && <p className="mt-2 text-sm text-amber-800">История не прочиталась: {hist.error}</p>}
        {showHistory && hist.rows.map(h => (
          <div key={`${h.version}`} className="mt-3 border-t border-[#e4e4e0] pt-3 first:border-0">
            <p className="text-sm text-[#111110]">
              Версия {h.version}{h.current ? ' — текущая' : ''} · {h.date} · {h.author}
            </p>
            <p className="text-xs text-[#9a9a95]">{h.reason || 'причина не записана'}</p>
            {h.changes.length > 0 ? (
              <ul className="mt-1 space-y-0.5 text-xs text-[#9a9a95]">
                {h.changes.slice(0, 40).map(c => (
                  <li key={c.key}>
                    {c.key}: {c.before.lo == null ? 'нет значения' : `${c.before.lo}…${c.before.hi}`} →{' '}
                    {c.after.lo == null ? 'нет значения' : `${c.after.lo}…${c.after.hi}`} ({STATUS_LABEL[c.after.status]}, {c.after.source})
                  </li>
                ))}
                {h.changes.length > 40 && <li>…и ещё {h.changes.length - 40}</li>}
              </ul>
            ) : (
              <p className="mt-1 text-xs text-[#9a9a95]">Список изменений не записан — это первая загрузка справочника.</p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
