'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { B2B_RATE_SPECS } from '@/lib/b2b/rates'

// Внутренние ставки B2B-калькулятора (закалка, кромка, доставка на закалку, упаковка,
// минимальные цены позиции, пороги маржи). Читает lib/b2b/rates.ts — у менеджера в /calculator/b2b,
// в кабинете партнёра, в «Расчёте» душевых и зеркал. Маршрут:
// docs/pricing/RATES_DIRECTORY_ROUTE.md.

type Row = { key: string; label: string; unit: string; value: number; sort: number; updated_at: string | null; updated_by: string | null }
type Status = { kind: 'saved' | 'error'; text: string }

const GROUPS: { title: string; note: string; match: (key: string) => boolean }[] = [
  { title: 'Закалка', note: 'Себестоимость: подрядчик, ₽ за м² детали по толщине стекла.', match: k => k.startsWith('tempering_') },
  { title: 'Обработка и логистика', note: 'Себестоимость каждой позиции.', match: k => ['edge_per_m', 'transport_per_piece', 'packaging_per_m2'].includes(k) },
  { title: 'Минимальная цена позиции', note: 'Цена клиента, а не себестоимость: позиция дешевле этой суммы за штуку поднимается до неё.', match: k => k.startsWith('min_') },
  { title: 'Пороги маржи', note: 'Маржа без НДС. Ниже нижнего порога — красный, и правка итога уходит вам на согласование; до цели — жёлтый; от цели — зелёный.', match: k => k.startsWith('margin_') },
]

const fmtWhen = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''

export default function B2BRatesPage() {
  const sb = useMemo(() => createClient(), [])
  const [rows, setRows] = useState<Row[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  // Черновик — то, что человек набрал. Живёт, пока не сохранено: ошибка записи его не стирает.
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [status, setStatus] = useState<Record<string, Status>>({})
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      const [{ data, error }, { data: auth }] = await Promise.all([
        sb.from('b2b_rates').select('key, label, unit, value, sort, updated_at, updated_by').order('sort'),
        sb.auth.getUser(),
      ])
      if (error) setLoadError(error.message)
      setRows(((data ?? []) as Row[]).map(r => ({ ...r, value: Number(r.value) })))
      setEmail(auth.user?.email ?? null)
      setLoading(false)
    })()
  }, [sb])

  // Ставки, которых нет в таблице: калькулятор считает их по заводскому значению.
  const absent = B2B_RATE_SPECS.filter(s => !rows.some(r => r.key === s.key))

  async function save(key: string) {
    const raw = (draft[key] ?? '').replace(',', '.').trim()
    const value = Number(raw)
    if (raw === '' || !Number.isFinite(value) || value < 0) {
      setStatus(s => ({ ...s, [key]: { kind: 'error', text: 'Нужно число не меньше нуля' } }))
      return
    }
    const other = (k: string) => rows.find(r => r.key === k)?.value
    const target = key === 'margin_target' ? value : other('margin_target')
    const min = key === 'margin_min' ? value : other('margin_min')
    if (key.startsWith('margin_') && target != null && min != null && min > target) {
      setStatus(s => ({ ...s, [key]: { kind: 'error', text: `Нижний порог (${min}%) выше цели (${target}%) — жёлтой зоны не останется` } }))
      return
    }
    setSavingKey(key)
    // .select() обязателен: без права на правку RLS не даёт ошибку, а молча обновляет 0 строк.
    const { data, error } = await sb.from('b2b_rates').update({ value, updated_by: email }).eq('key', key)
      .select('key, label, unit, value, sort, updated_at, updated_by')
    setSavingKey(null)
    if (error || !data?.length) {
      setStatus(s => ({ ...s, [key]: { kind: 'error', text: error ? `Не сохранено: ${error.message}` : 'Не сохранено: нет прав на правку ставок (admin, ceo, коммерческий, финансовый)' } }))
      return
    }
    const saved = { ...(data[0] as Row), value: Number((data[0] as Row).value) }
    setRows(prev => prev.map(r => r.key === key ? saved : r))
    setDraft(d => { const n = { ...d }; delete n[key]; return n })
    setStatus(s => ({ ...s, [key]: { kind: 'saved', text: 'Сохранено в справочнике — действует в новых просчётах' } }))
  }

  async function addAbsent(key: string) {
    const spec = B2B_RATE_SPECS.find(s => s.key === key)
    if (!spec) return
    const { data, error } = await sb.from('b2b_rates')
      .insert({ key: spec.key, label: spec.label, unit: spec.unit, value: spec.value, sort: spec.sort, updated_by: email })
      .select('key, label, unit, value, sort, updated_at, updated_by')
    if (error || !data?.length) {
      setLoadError(`Не добавлено «${spec.label}»: ${error?.message ?? 'нет прав'}`)
      return
    }
    setRows(prev => [...prev, { ...(data[0] as Row), value: Number((data[0] as Row).value) }].sort((a, b) => a.sort - b.sort))
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-[13px] text-[#9a9a95]">Загрузка…</div>

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-5 pt-6 pb-4">
        <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Стекло — ставки, минимальные цены, пороги маржи</h1>
        <p className="text-[12px] text-[#9a9a95] mt-0.5 max-w-[720px]">
          По ним B2B-калькулятор считает себестоимость и минимальную цену позиции и красит маржу — у менеджера, в кабинете
          партнёра и в «Расчёте» душевых и зеркал. Новое значение действует в следующем просчёте; уже
          сохранённые просчёты свои суммы не меняют.
        </p>
      </div>

      <div className="px-4 sm:px-5 pt-4 max-w-[760px] space-y-4">
        {loadError && (
          <p className="text-[12px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{loadError}</p>
        )}
        {absent.length > 0 && (
          <div className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-1">
            <p>Этих ставок нет в справочнике — калькулятор берёт заводские значения и предупреждает менеджера:</p>
            {absent.map(s => (
              <div key={s.key} className="flex items-center justify-between gap-2">
                <span>{s.label} — {s.value.toLocaleString('ru-RU')} {s.unit}</span>
                <button onClick={() => addAbsent(s.key)} className="text-[12px] font-medium underline">Добавить</button>
              </div>
            ))}
          </div>
        )}

        {GROUPS.map(g => {
          const list = rows.filter(r => g.match(r.key))
          if (!list.length) return null
          return (
            <section key={g.title}>
              <h2 className="text-[13px] font-semibold text-[#111110]">{g.title}</h2>
              <p className="text-[11px] text-[#9a9a95] mb-1.5">{g.note}</p>
              <div className="bg-white rounded-xl border border-[#e4e4e0] divide-y divide-[#f0f0ee]">
                {list.map(r => {
                  const shown = draft[r.key] ?? String(r.value)
                  const dirty = draft[r.key] !== undefined && Number(draft[r.key].replace(',', '.')) !== r.value
                  const st = status[r.key]
                  return (
                    <div key={r.key} className="px-4 py-2.5">
                      <div className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] text-[#111110]">{r.label}</p>
                          <p className="text-[11px] text-[#9a9a95]">
                            {r.unit}{r.updated_at ? ` · изменено ${fmtWhen(r.updated_at)}${r.updated_by ? ` — ${r.updated_by}` : ''}` : ''}
                          </p>
                        </div>
                        <input inputMode="decimal" value={shown}
                          onChange={e => { const v = e.target.value; setDraft(d => ({ ...d, [r.key]: v })); setStatus(s => { const n = { ...s }; delete n[r.key]; return n }) }}
                          onKeyDown={e => { if (e.key === 'Enter' && dirty) save(r.key) }}
                          className="w-28 bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[13px] font-mono text-right outline-none focus:border-[#111110]" />
                        <button onClick={() => save(r.key)} disabled={!dirty || savingKey === r.key}
                          className="w-24 text-[12px] font-medium rounded-lg px-3 py-1.5 bg-[#111110] text-white disabled:bg-[#e4e4e0] disabled:text-[#9a9a95]">
                          {savingKey === r.key ? 'Сохраняю…' : 'Сохранить'}
                        </button>
                      </div>
                      {dirty && !st && <p className="text-[11px] text-amber-700 mt-1">Не сохранено: было {r.value.toLocaleString('ru-RU')} {r.unit}</p>}
                      {st && <p className={`text-[11px] mt-1 ${st.kind === 'saved' ? 'text-emerald-700' : 'text-red-600'}`}>{st.text}</p>}
                    </div>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
