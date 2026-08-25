'use client'

import { useState } from 'react'
import type { InventoryItem, MoveReason } from '@/lib/inventory/types'
import { REASON_LABELS, UNIT_LABELS, packToBase, describeQty } from '@/lib/inventory/units'
import { INPUT, BTN, BTN_P, post } from './shared'

type Props = {
  item:    InventoryItem
  mode:    'in' | 'out'
  canSeeCost: boolean
  onClose: () => void
  onDone:  () => void
}

const IN_REASONS:  MoveReason[] = ['purchase', 'return', 'init']
const OUT_REASONS: MoveReason[] = ['order', 'production', 'writeoff', 'defect', 'transfer']

export default function MoveDialog({ item, mode, canSeeCost, onClose, onDone }: Props) {
  const hasPack = !!item.pack_label && item.pack_size > 0
  const [inPack, setInPack] = useState(hasPack)
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState<MoveReason>(mode === 'in' ? 'purchase' : 'order')
  const [cost,   setCost]   = useState('')
  const [note,   setNote]   = useState('')
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState<string | null>(null)

  const packQty = Number(amount.replace(',', '.')) || 0
  const base    = inPack && hasPack ? packToBase(packQty, item.pack_size) : packQty
  const signed  = mode === 'in' ? base : -base
  const after   = Math.round((item.qty + signed) * 10000) / 10000

  async function save() {
    if (!(base > 0)) { setError('Укажите количество'); return }
    setSaving(true); setError(null)
    try {
      await post('/api/inventory/moves', {
        moves: [{
          item_id:   item.id,
          qty:       signed,
          pack_qty:  inPack && hasPack ? packQty : null,
          reason,
          unit_cost: mode === 'in' ? Number(cost.replace(',', '.')) || 0 : 0,
          note,
        }],
      })
      onDone()
    } catch (e) {
      setError((e as Error).message)
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className={`bg-white rounded-lg w-full max-w-md p-5 ${''}`} onClick={e => e.stopPropagation()}>
        <div className="text-[15px] font-medium text-[#111110]">
          {mode === 'in' ? 'Приход' : 'Расход'} · {item.name}
        </div>
        <div className="text-[12px] text-[#9a9a95] mt-1">
          Сейчас: {describeQty(item.qty, item.unit, item.pack_label, item.pack_size)}
        </div>

        <div className="mt-4 space-y-3">
          <div>
            <label className="block text-[12px] text-[#9a9a95] mb-1">Количество</label>
            <div className="flex gap-2">
              <input
                className={`${INPUT} flex-1`} inputMode="decimal" autoFocus
                value={amount} onChange={e => setAmount(e.target.value)}
                placeholder={inPack && hasPack ? `сколько ${item.pack_label}` : UNIT_LABELS[item.unit]}
              />
              {hasPack && (
                <div className="flex text-[12px] border border-[#e4e4e0] rounded overflow-hidden">
                  <button type="button" onClick={() => setInPack(true)}
                    className={`px-2 ${inPack ? 'bg-[#111110] text-white' : 'bg-white text-[#9a9a95]'}`}>
                    {item.pack_label}
                  </button>
                  <button type="button" onClick={() => setInPack(false)}
                    className={`px-2 ${!inPack ? 'bg-[#111110] text-white' : 'bg-white text-[#9a9a95]'}`}>
                    {UNIT_LABELS[item.unit]}
                  </button>
                </div>
              )}
            </div>
            {inPack && hasPack && base > 0 && (
              <div className="text-[12px] text-[#9a9a95] mt-1">
                = {base} {UNIT_LABELS[item.unit]} (1 {item.pack_label} = {item.pack_size} {UNIT_LABELS[item.unit]})
              </div>
            )}
          </div>

          <div>
            <label className="block text-[12px] text-[#9a9a95] mb-1">Основание</label>
            <select className={`${INPUT} w-full`} value={reason} onChange={e => setReason(e.target.value as MoveReason)}>
              {(mode === 'in' ? IN_REASONS : OUT_REASONS).map(r => (
                <option key={r} value={r}>{REASON_LABELS[r]}</option>
              ))}
            </select>
          </div>

          {mode === 'in' && canSeeCost && (
            <div>
              <label className="block text-[12px] text-[#9a9a95] mb-1">
                Цена за {UNIT_LABELS[item.unit]} (для средней себестоимости)
              </label>
              <input className={`${INPUT} w-full`} inputMode="decimal" value={cost}
                onChange={e => setCost(e.target.value)} placeholder="₽" />
            </div>
          )}

          <div>
            <label className="block text-[12px] text-[#9a9a95] mb-1">Комментарий</label>
            <input className={`${INPUT} w-full`} value={note} onChange={e => setNote(e.target.value)}
              placeholder="накладная, кто привёз, куда ушло" />
          </div>

          {base > 0 && (
            <div className="text-[13px] text-[#111110] bg-[#f5f5f3] rounded px-3 py-2">
              Станет: {describeQty(after, item.unit, item.pack_label, item.pack_size)}
              {after < 0 && <span className="text-red-600"> — уйдёт в минус</span>}
            </div>
          )}

          {error && <div className="text-[13px] text-red-600">{error}</div>}
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button className={BTN} onClick={onClose}>Отмена</button>
          <button className={BTN_P} onClick={save} disabled={saving || !(base > 0)}>
            {saving ? 'Сохраняю…' : mode === 'in' ? 'Оприходовать' : 'Списать'}
          </button>
        </div>
      </div>
    </div>
  )
}
