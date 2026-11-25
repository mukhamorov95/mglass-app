'use client'

import { useState } from 'react'
import Link from 'next/link'
import { loadJson } from '@/lib/toast'
import { confirmDialog } from '@/lib/dialog'
import { SKIP_LABELS } from '@/lib/production/cutterPlan'
import type { CutResult } from '@/lib/production/cutDoneApply'

// После «Отрезано»: что отметилось (с отменой) и остатки с этих листов на стеллаж.

export type RemnantRow = { on: boolean; w: string; h: string }
export type CutSheetDraft = { index: number; orderIds: number[]; remnants: RemnantRow[]; saved?: string[] }
export type CutRecord = {
  materialId: number
  label: string
  sheet: { w: number; h: number }
  names: Record<number, string>
  result: (CutResult & { pieces: number }) | null
  undone: boolean
  location: string
  sheets: CutSheetDraft[]
}

export default function CutDonePanel({ rec, onChange, onClose, onMarksChanged }: {
  rec: CutRecord
  onChange: (r: CutRecord) => void
  onClose: () => void
  onMarksChanged: () => void
}) {
  const [busy, setBusy] = useState<'undo' | 'save' | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const res = rec.result
  const name = (id: number) => rec.names[id] ?? `заказ ${id}`
  const allSaved = rec.sheets.every(s => s.saved)

  async function undo() {
    if (!res) return
    if (!(await confirmDialog({ title: `Отменить отметку резки у ${res.done.length} поз.?`, text: 'Вернутся только те позиции, что отмечены этим нажатием.', confirmLabel: 'Отменить отметку', cancelLabel: 'Оставить' }))) return
    setBusy('undo'); setErr(null)
    const r = await loadJson<{ undone: number; errors: string[] }>('/api/production/cut-done', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ undo: { at: res.at, tasks: res.done.map(d => ({ task_id: d.task_id, was_assigned: d.was_assigned })), flagged: res.flagged } }),
    })
    setBusy(null)
    if (r.error !== null) { setErr(`Не отменено: ${r.error}`); return }
    if (r.data.errors.length || r.data.undone < res.done.length) {
      setErr(`Отменено ${r.data.undone} из ${res.done.length}. ${r.data.errors.join('; ') || 'Остальные уже изменены на другом экране.'}`)
    }
    if (r.data.undone > 0) { onChange({ ...rec, undone: true }); onMarksChanged() }
  }

  // Один лист — одна запись: записанный помечаем сразу, чтобы повтор после сбоя не задвоил.
  async function save() {
    setBusy('save'); setErr(null)
    let cur = rec
    for (const s of rec.sheets) {
      if (s.saved) continue
      const r = await loadJson<{ cutId: number; codes: string[] }>('/api/production/remnants', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          materialId: rec.materialId, source: 'sheet', orderIds: s.orderIds, note: 'режим резчика',
          remnants: s.remnants.filter(x => x.on).map(x => ({ w: Number(x.w), h: Number(x.h), location: cur.location })),
        }),
      })
      if (r.error !== null) { setErr(`Лист ${s.index + 1} не записан: ${r.error}`); break }
      cur = { ...cur, sheets: cur.sheets.map(x => (x.index === s.index ? { ...x, saved: r.data.codes } : x)) }
      onChange(cur)
    }
    setBusy(null)
  }

  const setRow = (sheet: number, i: number, patch: Partial<RemnantRow>) => onChange({
    ...rec, sheets: rec.sheets.map(s => (s.index === sheet ? { ...s, remnants: s.remnants.map((x, j) => (j === i ? { ...x, ...patch } : x)) } : s)),
  })

  async function close() {
    if (!allSaved && !(await confirmDialog({ title: 'Закрыть без записи листов?', text: 'Остатки с этой раскладки на стеллаж не запишутся. Записать их потом можно в «Остатках» вручную.', confirmLabel: 'Закрыть', cancelLabel: 'Вернуться', danger: true }))) return
    onClose()
  }

  return (
    <div className="border border-[#bfe0cc] bg-[#f4faf6] rounded-lg p-3 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-[#111110]">Отрезано: {rec.label}</h3>
        <button onClick={close} className="text-[12px] text-[#6b6b66] underline shrink-0">Закрыть</button>
      </div>

      {res && res.done.length > 0 && (
        <div className="text-[13px] text-[#111110]">
          {rec.undone ? 'Отметка резки отменена: позиции снова ждут резки.' : (
            <>✓ Резка отмечена: <b>{res.done.length}</b> поз., <b>{res.pieces}</b> дет. — видно на табло и в карточке заказа.{' '}
              <button onClick={undo} disabled={busy !== null} className="underline text-[#6b6b66] disabled:opacity-40">{busy === 'undo' ? 'Отменяю…' : 'Отменить отметку'}</button></>
          )}
          <ul className="mt-1 text-[11px] text-[#6b6b66] tabular-nums">
            {[...new Set(res.done.map(d => d.order_id))].map(id => (
              <li key={id}>{name(id)} — поз. {res.done.filter(d => d.order_id === id).map(d => d.item_index + 1).join(', ')}</li>
            ))}
          </ul>
        </div>
      )}
      {res && res.skipped.length > 0 && (
        <p className="text-[12px] text-[#b9770e]">Не отмечено: {res.skipped.map(s => `${name(s.order_id)}, поз. ${s.item_index + 1} — ${SKIP_LABELS[s.reason]}`).join('; ')}.</p>
      )}
      {res && res.errors.length > 0 && <p className="text-[12px] text-[#c0392b]">Не записалось: {res.errors.join('; ')}</p>}

      <div className="space-y-2">
        <div className="text-[12px] font-semibold text-[#111110]">Листы и остатки на стеллаж</div>
        <p className="text-[11px] text-[#6b6b66]">Размеры взяты из раскладки. Если кусок вышел другим — поправьте, если не остался — снимите галочку. Лист {rec.sheet.w}×{rec.sheet.h} мм.</p>
        {rec.sheets.map(s => (
          <div key={s.index} className="bg-white border border-[#e4e4e0] rounded-lg p-2">
            <div className="text-[12px] font-semibold text-[#111110]">Лист {s.index + 1}</div>
            {s.saved ? (
              <div className="text-[12px] text-[#1e7d4f]">✓ Записан{s.saved.length ? `. На стеллаже: ${s.saved.join(', ')} — напишите номер на куске.` : ', без остатков.'}</div>
            ) : s.remnants.length === 0 ? (
              <div className="text-[11px] text-[#9a9a95]">Годных остатков нет — запишется только сам лист.</div>
            ) : s.remnants.map((x, i) => (
              <div key={i} className="mt-1 flex items-center gap-2">
                <input type="checkbox" checked={x.on} onChange={e => setRow(s.index, i, { on: e.target.checked })} className="w-5 h-5" aria-label={`Записать остаток ${i + 1}`} />
                <input value={x.w} onChange={e => setRow(s.index, i, { w: e.target.value.replace(/\D/g, '') })} disabled={!x.on} inputMode="numeric" aria-label="Ширина, мм"
                  className="w-24 border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[14px] disabled:opacity-40" />
                <span className="text-[#9a9a95]">×</span>
                <input value={x.h} onChange={e => setRow(s.index, i, { h: e.target.value.replace(/\D/g, '') })} disabled={!x.on} inputMode="numeric" aria-label="Высота, мм"
                  className="w-24 border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[14px] disabled:opacity-40" />
                <span className="text-[11px] text-[#9a9a95]">мм</span>
              </div>
            ))}
          </div>
        ))}
        {!allSaved && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[12px] text-[#6b6b66]">Где лежат (необязательно)
              <input value={rec.location} onChange={e => onChange({ ...rec, location: e.target.value })} placeholder="например, стеллаж 2"
                className="block mt-1 w-48 border border-[#e4e4e0] rounded-lg px-3 py-2 text-[14px]" />
            </label>
            <button onClick={save} disabled={busy !== null} className="px-4 py-2 rounded-lg bg-[#111110] text-white text-[13px] font-semibold disabled:opacity-40">
              {busy === 'save' ? 'Записываю…' : 'Записать листы и остатки'}
            </button>
          </div>
        )}
        <p className="text-[11px] text-[#6b6b66]">Стеллаж — <Link href="/production-app/remnants" className="underline">✂️ Остатки</Link>. Отмена отметки записанные остатки не убирает.</p>
      </div>
      {err && <p className="text-[12px] text-[#c0392b]">{err}</p>}
    </div>
  )
}
