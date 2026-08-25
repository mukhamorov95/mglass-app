'use client'

import { useEffect, useState } from 'react'
import type { InventoryItem, ConsumePlan } from '@/lib/inventory/types'
import type { ConsumeDoc } from '@/app/api/inventory/documents/route'
import { UNIT_LABELS } from '@/lib/inventory/units'
import { suggestMatches } from '@/lib/inventory/match'
import { INPUT, BTN, BTN_P, api, post, patch, dateTime } from './shared'

type Props = { items: InventoryItem[]; canWrite: boolean; reload: () => void }

const MATCH_LABELS: Record<string, string> = {
  ref:   'по справочнику',
  alias: 'по названию из заказа',
  name:  'по названию',
  none:  'нет на складе',
}

// Списание по заказу — только по кнопке и только после предпросмотра: система
// показывает, что именно уйдёт, и хватает ли этого на складе.
export default function ConsumeTab({ items, canWrite, reload }: Props) {
  const [docs, setDocs]       = useState<ConsumeDoc[]>([])
  const [plan, setPlan]       = useState<ConsumePlan | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [onlyOpen, setOnlyOpen] = useState(true)

  const loadDocs = () => api<{ docs: ConsumeDoc[] }>('/api/inventory/documents')
    .then(r => setDocs(r.docs)).catch(e => setError((e as Error).message)).finally(() => setLoading(false))

  useEffect(() => { loadDocs() }, [])

  async function openPlan(d: ConsumeDoc) {
    setBusy(true); setError(null); setPlan(null)
    try {
      const r = await api<{ plan: ConsumePlan }>(`/api/inventory/consume?type=${d.doc_type}&id=${encodeURIComponent(d.doc_id)}`)
      setPlan(r.plan)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function apply() {
    if (!plan) return
    setBusy(true); setError(null)
    try {
      await post('/api/inventory/consume', { type: plan.doc_type, id: plan.doc_id })
      setPlan(null)
      await loadDocs()
      reload()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // Привязка непонятой строки заказа к складской позиции — дальше она узнаётся сама.
  async function bindAlias(sourceName: string, itemId: number) {
    const target = items.find(i => i.id === itemId)
    if (!target) return
    setBusy(true)
    try {
      await patch(`/api/inventory/items/${itemId}`, {
        bom_aliases: [...new Set([...target.bom_aliases, sourceName])],
      })
      reload()
      if (plan) await openPlan({ doc_type: plan.doc_type as ConsumeDoc['doc_type'], doc_id: plan.doc_id, title: plan.title, date: null, consumed: plan.already })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const visible = docs.filter(d => !onlyOpen || !d.consumed)
  const missing = plan?.rows.filter(r => r.item_id === null) ?? []
  const short   = plan?.rows.filter(r => r.item_id !== null && r.qty > r.available) ?? []

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-[13px] font-medium text-[#111110]">Запущенные заказы</div>
          <label className="text-[12px] text-[#9a9a95] flex items-center gap-1.5">
            <input type="checkbox" checked={onlyOpen} onChange={e => setOnlyOpen(e.target.checked)} />
            только не списанные
          </label>
        </div>

        {loading && <div className="text-[13px] text-[#9a9a95] py-4">Загрузка…</div>}
        {!loading && !visible.length && <div className="text-[13px] text-[#9a9a95] py-4">Нечего списывать.</div>}

        <div className="border border-[#e4e4e0] rounded-lg bg-white max-h-[70vh] overflow-y-auto">
          {visible.map(d => (
            <button key={`${d.doc_type}:${d.doc_id}`} onClick={() => openPlan(d)}
              className={`w-full text-left px-3 py-2 border-b border-[#e4e4e0] last:border-0 hover:bg-[#f5f5f3] ${
                plan?.doc_id === d.doc_id && plan?.doc_type === d.doc_type ? 'bg-[#f5f5f3]' : ''}`}>
              <div className="text-[13px] text-[#111110]">{d.title}</div>
              <div className="text-[11px] text-[#9a9a95]">
                {dateTime(d.date)}
                {d.consumed && <span className="ml-2 text-emerald-700">списано</span>}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="text-[13px] font-medium text-[#111110] mb-2">Что уйдёт со склада</div>
        {error && <div className="text-[13px] text-red-600 mb-2">{error}</div>}

        {!plan && <div className="text-[13px] text-[#9a9a95] py-4">Выберите заказ слева.</div>}

        {plan && (
          <div className="border border-[#e4e4e0] rounded-lg bg-white">
            <div className="px-3 py-2 border-b border-[#e4e4e0]">
              <div className="text-[13px] text-[#111110]">{plan.title}</div>
              {plan.already && <div className="text-[12px] text-emerald-700">По этому заказу уже списывали — повтор заблокирован.</div>}
            </div>

            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-[#9a9a95] border-b border-[#e4e4e0]">
                  <th className="text-left  font-normal px-3 py-2">Позиция</th>
                  <th className="text-right font-normal px-3 py-2 w-28">Нужно</th>
                  <th className="text-right font-normal px-3 py-2 w-28">На складе</th>
                  <th className="text-left  font-normal px-3 py-2 w-44">Совпадение</th>
                </tr>
              </thead>
              <tbody>
                {plan.rows.map((r, idx) => (
                  <tr key={idx} className="border-b border-[#e4e4e0] last:border-0">
                    <td className="px-3 py-2 text-[#111110]">
                      {r.name}
                      {r.source !== r.name && <div className="text-[11px] text-[#9a9a95]">в заказе: {r.source}</div>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.qty} {r.unit ? UNIT_LABELS[r.unit] : ''}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${
                      r.item_id === null ? 'text-[#9a9a95]' : r.qty > r.available ? 'text-red-600' : 'text-[#111110]'}`}>
                      {r.item_id === null ? '—' : r.available}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-[#9a9a95]">
                      {MATCH_LABELS[r.matched]}
                      {r.item_id === null && canWrite && (
                        <select className={`${INPUT} w-full mt-1`} defaultValue=""
                          onChange={e => e.target.value && bindAlias(r.source, Number(e.target.value))}>
                          <option value="">привязать к позиции…</option>
                          {suggestMatches(r.source, items, 5).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                          <option disabled>──────</option>
                          {items.map(s => <option key={`a${s.id}`} value={s.id}>{s.name}</option>)}
                        </select>
                      )}
                    </td>
                  </tr>
                ))}
                {!plan.rows.length && (
                  <tr><td className="px-3 py-4 text-[13px] text-[#9a9a95]" colSpan={4}>В заказе нет складских позиций.</td></tr>
                )}
              </tbody>
            </table>

            <div className="px-3 py-3 border-t border-[#e4e4e0] flex items-center justify-between">
              <div className="text-[12px] text-[#9a9a95]">
                {missing.length > 0 && <div>Не найдено на складе: {missing.length} — эти строки не спишутся.</div>}
                {short.length   > 0 && <div className="text-red-600">Не хватает: {short.length} — остаток уйдёт в минус.</div>}
              </div>
              <div className="flex gap-2">
                <button className={BTN} onClick={() => setPlan(null)}>Закрыть</button>
                <button className={BTN_P} onClick={apply}
                  disabled={!canWrite || busy || plan.already || !plan.rows.some(r => r.item_id !== null)}>
                  {busy ? 'Списываю…' : 'Списать со склада'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
