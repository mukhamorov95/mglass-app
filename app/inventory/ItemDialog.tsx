'use client'

import { useState } from 'react'
import type { InventoryItem, Kind, Unit, Contour } from '@/lib/inventory/types'
import { KIND_LABELS, KIND_DEFAULT, CONTOUR_LABELS, UNITS, UNIT_LABELS, sheetArea } from '@/lib/inventory/units'
import { INPUT, BTN, BTN_P, post, patch, KIND_ORDER } from './shared'

type Props = { item: InventoryItem | null; onClose: () => void; onDone: () => void }

type Form = {
  name: string; article: string; contour: Contour; kind: Kind; unit: Unit
  pack_label: string; pack_size: string; location: string
  min_qty: string; target_qty: string; color: string; thickness: string
  bom_aliases: string; notes: string; active: boolean
}

const toForm = (i: InventoryItem | null): Form => ({
  name:      i?.name ?? '',
  article:   i?.article ?? '',
  contour:   i?.contour ?? 'b2c',
  kind:      i?.kind ?? 'hardware',
  unit:      i?.unit ?? 'шт',
  pack_label: i?.pack_label ?? '',
  pack_size:  i ? String(i.pack_size || '') : '',
  location:   i?.location ?? '',
  min_qty:    i ? String(i.min_qty || '') : '',
  target_qty: i ? String(i.target_qty || '') : '',
  color:      i?.color ?? '',
  thickness:  i?.thickness != null ? String(i.thickness) : '',
  bom_aliases: (i?.bom_aliases ?? []).join(', '),
  notes:      i?.notes ?? '',
  active:     i?.active ?? true,
})

const num = (s: string) => Number(String(s).replace(',', '.')) || 0

export default function ItemDialog({ item, onClose, onDone }: Props) {
  const [f, setF]           = useState<Form>(toForm(item))
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const [sheetW, setSheetW] = useState('3210')
  const [sheetH, setSheetH] = useState('2250')

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF(prev => ({ ...prev, [k]: v }))

  // Смена вида подставляет привычные единицы: стекло — м²/лист, профиль — м.п./хлыст.
  function pickKind(kind: Kind) {
    const d = KIND_DEFAULT[kind]
    setF(prev => ({ ...prev, kind, unit: d.unit, pack_label: d.pack_label ?? '', contour: item ? prev.contour : d.contour }))
  }

  async function save() {
    if (!f.name.trim()) { setError('Нужно название'); return }
    setSaving(true); setError(null)
    const payload = {
      name: f.name.trim(), article: f.article.trim(), contour: f.contour, kind: f.kind, unit: f.unit,
      pack_label: f.pack_label.trim() || null, pack_size: num(f.pack_size),
      location: f.location.trim(), min_qty: num(f.min_qty), target_qty: num(f.target_qty),
      color: f.color.trim() || null, thickness: f.thickness ? num(f.thickness) : null,
      bom_aliases: f.bom_aliases.split(',').map(s => s.trim()).filter(Boolean),
      notes: f.notes.trim(), active: f.active,
    }
    try {
      if (item) await patch(`/api/inventory/items/${item.id}`, payload)
      else      await post('/api/inventory/items', payload)
      onDone()
    } catch (e) {
      setError((e as Error).message); setSaving(false)
    }
  }

  const isSheet = f.kind === 'glass' || f.kind === 'mirror'

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg w-full max-w-2xl p-5 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="text-[15px] font-medium text-[#111110]">
          {item ? 'Складская карточка' : 'Новая позиция на складе'}
        </div>

        <div className="grid grid-cols-2 gap-3 mt-4">
          <div className="col-span-2">
            <label className="block text-[12px] text-[#9a9a95] mb-1">Название</label>
            <input className={`${INPUT} w-full`} value={f.name} onChange={e => set('name', e.target.value)} autoFocus />
          </div>

          <div>
            <label className="block text-[12px] text-[#9a9a95] mb-1">Артикул</label>
            <input className={`${INPUT} w-full`} value={f.article} onChange={e => set('article', e.target.value)} />
          </div>
          <div>
            <label className="block text-[12px] text-[#9a9a95] mb-1">Место хранения</label>
            <input className={`${INPUT} w-full`} value={f.location} onChange={e => set('location', e.target.value)}
              placeholder="стеллаж А, пирамида 2" />
          </div>

          <div>
            <label className="block text-[12px] text-[#9a9a95] mb-1">Вид</label>
            <select className={`${INPUT} w-full`} value={f.kind} onChange={e => pickKind(e.target.value as Kind)}>
              {KIND_ORDER.map(k => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[12px] text-[#9a9a95] mb-1">Контур</label>
            <select className={`${INPUT} w-full`} value={f.contour} onChange={e => set('contour', e.target.value as Contour)}>
              {(['b2b', 'b2c', 'both'] as Contour[]).map(c => <option key={c} value={c}>{CONTOUR_LABELS[c]}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-[12px] text-[#9a9a95] mb-1">Считаем в</label>
            <select className={`${INPUT} w-full`} value={f.unit} onChange={e => set('unit', e.target.value as Unit)}>
              {UNITS.map(u => <option key={u} value={u}>{UNIT_LABELS[u]}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[12px] text-[#9a9a95] mb-1">Тара</label>
              <input className={`${INPUT} w-full`} value={f.pack_label} onChange={e => set('pack_label', e.target.value)}
                placeholder="лист / хлыст" />
            </div>
            <div>
              <label className="block text-[12px] text-[#9a9a95] mb-1">В ней {UNIT_LABELS[f.unit]}</label>
              <input className={`${INPUT} w-full`} inputMode="decimal" value={f.pack_size}
                onChange={e => set('pack_size', e.target.value)} placeholder="7.2225" />
            </div>
          </div>

          {isSheet && (
            <div className="col-span-2 bg-[#f5f5f3] rounded p-3 flex items-end gap-2">
              <div>
                <label className="block text-[12px] text-[#9a9a95] mb-1">Лист, мм</label>
                <div className="flex items-center gap-1">
                  <input className={`${INPUT} w-20`} value={sheetW} onChange={e => setSheetW(e.target.value)} />
                  <span className="text-[#9a9a95]">×</span>
                  <input className={`${INPUT} w-20`} value={sheetH} onChange={e => setSheetH(e.target.value)} />
                </div>
              </div>
              <button type="button" className={BTN}
                onClick={() => { set('pack_label', 'лист'); set('pack_size', String(sheetArea(num(sheetW), num(sheetH)))) }}>
                Посчитать площадь листа
              </button>
              <span className="text-[12px] text-[#9a9a95] pb-2">
                = {sheetArea(num(sheetW), num(sheetH))} м²
              </span>
            </div>
          )}

          <div>
            <label className="block text-[12px] text-[#9a9a95] mb-1">Минимум (ниже — дефицит)</label>
            <input className={`${INPUT} w-full`} inputMode="decimal" value={f.min_qty} onChange={e => set('min_qty', e.target.value)} />
          </div>
          <div>
            <label className="block text-[12px] text-[#9a9a95] mb-1">Норма (до сколько дозакупать)</label>
            <input className={`${INPUT} w-full`} inputMode="decimal" value={f.target_qty} onChange={e => set('target_qty', e.target.value)} />
          </div>

          <div>
            <label className="block text-[12px] text-[#9a9a95] mb-1">Цвет</label>
            <input className={`${INPUT} w-full`} value={f.color} onChange={e => set('color', e.target.value)} />
          </div>
          <div>
            <label className="block text-[12px] text-[#9a9a95] mb-1">Толщина, мм</label>
            <input className={`${INPUT} w-full`} inputMode="decimal" value={f.thickness} onChange={e => set('thickness', e.target.value)} />
          </div>

          <div className="col-span-2">
            <label className="block text-[12px] text-[#9a9a95] mb-1">
              Как эта позиция называется в заказах (через запятую) — по этим названиям идёт авто-списание
            </label>
            <input className={`${INPUT} w-full`} value={f.bom_aliases} onChange={e => set('bom_aliases', e.target.value)}
              placeholder="петля настенная, петля стена-стекло хром" />
          </div>

          <div className="col-span-2">
            <label className="block text-[12px] text-[#9a9a95] mb-1">Заметка</label>
            <input className={`${INPUT} w-full`} value={f.notes} onChange={e => set('notes', e.target.value)} />
          </div>

          {item && (
            <label className="col-span-2 flex items-center gap-2 text-[13px] text-[#111110]">
              <input type="checkbox" checked={f.active} onChange={e => set('active', e.target.checked)} />
              Позиция в обороте
            </label>
          )}
        </div>

        {error && <div className="text-[13px] text-red-600 mt-3">{error}</div>}

        <div className="flex justify-end gap-2 mt-5">
          <button className={BTN} onClick={onClose}>Отмена</button>
          <button className={BTN_P} onClick={save} disabled={saving}>{saving ? 'Сохраняю…' : 'Сохранить'}</button>
        </div>
      </div>
    </div>
  )
}
