'use client'

import { useEffect, useState } from 'react'
import type { InventoryItem } from '@/lib/inventory/types'
import type { PurchaseDoc } from '@/app/api/inventory/purchases/route'
import { UNIT_LABELS, packToBase } from '@/lib/inventory/units'
import { suggestMatches } from '@/lib/inventory/match'
import { INPUT, BTN, BTN_P, api, post, money } from './shared'

type Props = { items: InventoryItem[]; canWrite: boolean; canSeeCost: boolean; reload: () => void }

type Line = {
  key:     string
  item_id: number | null
  label:   string        // как позиция названа в накладной
  packQty: string        // количество в таре (листы/хлысты) или в базовой единице
  inPack:  boolean
  cost:    string        // цена за базовую единицу
}

let seq = 0
const newKey = () => `l${++seq}`

// Приход накладной: несколько позиций за один заход, с ценой — она двигает
// среднюю себестоимость запаса.
export default function ReceiveTab({ items, canWrite, canSeeCost, reload }: Props) {
  const [docs, setDocs]     = useState<PurchaseDoc[]>([])
  const [doc, setDoc]       = useState<PurchaseDoc | null>(null)
  const [lines, setLines]   = useState<Line[]>([])
  const [note, setNote]     = useState('')
  const [busy, setBusy]     = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  useEffect(() => {
    api<{ docs: PurchaseDoc[] }>('/api/inventory/purchases')
      .then(r => setDocs(r.docs)).catch(() => setDocs([]))
  }, [])

  const byId = (id: number | null) => items.find(i => i.id === id) ?? null

  function pickDoc(d: PurchaseDoc | null) {
    setDoc(d); setResult(null); setError(null)
    if (!d) { setLines([]); return }
    // Предзаполняем строки накладной и подбираем складские карточки по названию.
    setLines(d.lines.map(l => {
      const guess = suggestMatches(`${l.name} ${l.thickness ?? ''}`, items, 1)[0] ?? null
      const perM2 = l.area_m2 > 0 && l.cost > 0 ? Math.round(l.cost / l.area_m2) : 0
      return {
        key: newKey(), item_id: guess?.id ?? null, label: l.name,
        packQty: String(l.sheets || l.area_m2 || ''),
        inPack: l.sheets > 0,
        cost: perM2 ? String(perM2) : '',
      }
    }))
  }

  const addLine = () => setLines(prev => [...prev, { key: newKey(), item_id: null, label: '', packQty: '', inPack: true, cost: '' }])
  const setLine = (key: string, patch: Partial<Line>) =>
    setLines(prev => prev.map(l => l.key === key ? { ...l, ...patch } : l))
  const dropLine = (key: string) => setLines(prev => prev.filter(l => l.key !== key))

  function baseQty(l: Line): number {
    const item = byId(l.item_id)
    const v = Number(String(l.packQty).replace(',', '.')) || 0
    if (!item) return v
    return l.inPack && item.pack_size > 0 ? packToBase(v, item.pack_size) : v
  }

  const ready = lines.filter(l => l.item_id && baseQty(l) > 0)
  const total = ready.reduce((sum, l) => sum + baseQty(l) * (Number(String(l.cost).replace(',', '.')) || 0), 0)

  async function receive() {
    setBusy(true); setError(null); setResult(null)
    try {
      const res = await post<{ inserted: number; skipped: number }>('/api/inventory/moves', {
        moves: ready.map(l => {
          const item = byId(l.item_id)!
          return {
            item_id:  item.id,
            qty:      baseQty(l),
            pack_qty: l.inPack && item.pack_size > 0 ? Number(String(l.packQty).replace(',', '.')) : null,
            reason:   'purchase',
            unit_cost: Number(String(l.cost).replace(',', '.')) || 0,
            doc_type: doc ? 'purchase_order' : null,
            doc_id:   doc ? String(doc.id) : null,
            note:     note || (doc ? `Закупка №${doc.id} · ${doc.supplier_name}` : ''),
          }
        }),
      })
      if (!res.inserted) throw new Error('Ничего не оприходовано — возможно, по этой закупке уже принимали')
      setResult(`Оприходовано позиций: ${res.inserted}`)
      setLines([]); setDoc(null); setNote('')
      reload()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div>
        <div className="text-[13px] font-medium text-[#111110] mb-2">Закупки</div>
        <div className="border border-[#e4e4e0] rounded-lg bg-white max-h-[70vh] overflow-y-auto">
          <button onClick={() => pickDoc(null)}
            className={`w-full text-left px-3 py-2 border-b border-[#e4e4e0] hover:bg-[#f5f5f3] ${!doc ? 'bg-[#f5f5f3]' : ''}`}>
            <div className="text-[13px] text-[#111110]">Приход без закупки</div>
            <div className="text-[11px] text-[#9a9a95]">купили сами, вернули из цеха, нашли на складе</div>
          </button>
          {docs.map(d => (
            <button key={d.id} onClick={() => pickDoc(d)}
              className={`w-full text-left px-3 py-2 border-b border-[#e4e4e0] last:border-0 hover:bg-[#f5f5f3] ${doc?.id === d.id ? 'bg-[#f5f5f3]' : ''}`}>
              <div className="text-[13px] text-[#111110]">№{d.id} · {d.supplier_name}</div>
              <div className="text-[11px] text-[#9a9a95]">
                позиций: {d.lines.length}
                {d.received && <span className="ml-2 text-emerald-700">принято</span>}
              </div>
            </button>
          ))}
          {!docs.length && <div className="px-3 py-3 text-[13px] text-[#9a9a95]">Открытых закупок нет.</div>}
        </div>
      </div>

      <div className="lg:col-span-2">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[13px] font-medium text-[#111110]">
            {doc ? `Приход по закупке №${doc.id}` : 'Приход на склад'}
          </div>
          <button className={BTN} onClick={addLine}>Добавить строку</button>
        </div>

        {doc?.received && (
          <div className="text-[12px] text-amber-700 mb-2">По этой закупке уже приходовали — повтор по тем же позициям не пройдёт.</div>
        )}

        <div className="border border-[#e4e4e0] rounded-lg bg-white">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-[#9a9a95] border-b border-[#e4e4e0]">
                <th className="text-left  font-normal px-3 py-2">Складская позиция</th>
                <th className="text-right font-normal px-3 py-2 w-40">Количество</th>
                {canSeeCost && <th className="text-right font-normal px-3 py-2 w-32">Цена за ед.</th>}
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map(l => {
                const item = byId(l.item_id)
                return (
                  <tr key={l.key} className="border-b border-[#e4e4e0] last:border-0">
                    <td className="px-3 py-2">
                      <select className={`${INPUT} w-full`} value={l.item_id ?? ''}
                        onChange={e => setLine(l.key, { item_id: e.target.value ? Number(e.target.value) : null })}>
                        <option value="">— выберите позицию —</option>
                        {items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                      </select>
                      {l.label && <div className="text-[11px] text-[#9a9a95] mt-1">в накладной: {l.label}</div>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1 justify-end">
                        <input className={`${INPUT} w-20 text-right`} inputMode="decimal" value={l.packQty}
                          onChange={e => setLine(l.key, { packQty: e.target.value })} />
                        {item && item.pack_label && item.pack_size > 0 ? (
                          <button type="button" className="text-[11px] text-[#9a9a95] border border-[#e4e4e0] rounded px-1.5"
                            onClick={() => setLine(l.key, { inPack: !l.inPack })}>
                            {l.inPack ? item.pack_label : UNIT_LABELS[item.unit]}
                          </button>
                        ) : (
                          <span className="text-[11px] text-[#9a9a95] self-center w-10">{item ? UNIT_LABELS[item.unit] : ''}</span>
                        )}
                      </div>
                      {item && l.inPack && item.pack_size > 0 && baseQty(l) > 0 && (
                        <div className="text-[11px] text-[#9a9a95] text-right mt-1">= {baseQty(l)} {UNIT_LABELS[item.unit]}</div>
                      )}
                    </td>
                    {canSeeCost && (
                      <td className="px-3 py-2">
                        <input className={`${INPUT} w-full text-right`} inputMode="decimal" value={l.cost}
                          placeholder={item ? `₽ / ${UNIT_LABELS[item.unit]}` : '₽'}
                          onChange={e => setLine(l.key, { cost: e.target.value })} />
                      </td>
                    )}
                    <td className="px-3 py-2 text-right">
                      <button className="text-[#9a9a95] hover:text-red-600" onClick={() => dropLine(l.key)}>×</button>
                    </td>
                  </tr>
                )
              })}
              {!lines.length && (
                <tr><td className="px-3 py-4 text-[13px] text-[#9a9a95]" colSpan={canSeeCost ? 4 : 3}>
                  Выберите закупку слева или добавьте строку вручную.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between mt-3">
          <input className={`${INPUT} flex-1 max-w-sm`} placeholder="Комментарий: номер накладной, кто принял"
            value={note} onChange={e => setNote(e.target.value)} />
          <div className="flex items-center gap-3">
            {canSeeCost && total > 0 && <span className="text-[13px] text-[#9a9a95]">на сумму {money(total)}</span>}
            <button className={BTN_P} onClick={receive} disabled={!canWrite || busy || !ready.length}>
              {busy ? 'Приходую…' : `Оприходовать (${ready.length})`}
            </button>
          </div>
        </div>

        {result && <div className="text-[13px] text-emerald-700 mt-2">{result}</div>}
        {error  && <div className="text-[13px] text-red-600 mt-2">{error}</div>}
      </div>
    </div>
  )
}
