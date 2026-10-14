'use client'

import { useState } from 'react'
import { DXF_UNIT_TO_MM, type DxfUnit, type PartGeometry } from '@/lib/glasmen'
import { num } from './api'

const INCH = DXF_UNIT_TO_MM.inch

export const UNIT_NAME: Record<DxfUnit, string> = { mm: 'Миллиметры', cm: 'Сантиметры', m: 'Метры', inch: 'Дюймы', ft: 'Футы' }
export const UNIT_SHORT: Record<DxfUnit, string> = { mm: 'мм', cm: 'см', m: 'м', inch: 'дюймы', ft: 'футы' }
const DECLARED: Record<DxfUnit, string> = { mm: 'миллиметры', cm: 'сантиметры', m: 'метры', inch: 'дюймы', ft: 'футы' }
const CHOICES: DxfUnit[] = ['mm', 'cm', 'm', 'inch']

// «Confirm drawing units» как у SendCutSend: один и тот же чертёж в нескольких прочтениях — человек видит габарит и выбирает.
export default function UnitsDialog({
  auto, current, fileName, onConfirm, onCancel,
}: {
  auto: PartGeometry                  // разбор без подсказки единиц — в нём detected и подозрения
  current: DxfUnit
  fileName: string
  onConfirm: (u: DxfUnit) => void
  onCancel: () => void
}) {
  const [choice, setChoice] = useState<DxfUnit>(current)
  const rawW = auto.width / auto.units.factorToMm
  const rawH = auto.height / auto.units.factorToMm
  const detected = auto.units.detected
  const hints = auto.issues.filter(i => i.code === 'units_suspect' || i.code === 'units_unsupported')
  const unsupported = hints.some(i => i.code === 'units_unsupported')
  // Футы в выборе — только если их объявил файл: иначе выбор из четырёх привычных.
  const units = detected === 'ft' || current === 'ft' ? [...CHOICES, 'ft' as const] : CHOICES
  const declared = detected !== 'unknown'
    ? `в файле указаны ${DECLARED[detected]}`
    : unsupported ? 'в файле указан код единиц, который мы не читаем' : 'в файле единицы не указаны'

  const opt = (u: DxfUnit) => {
    const f = DXF_UNIT_TO_MM[u]
    const wMm = rawW * f, hMm = rawH * f
    return (
      <label
        key={u}
        className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${choice === u ? 'border-[#111110] bg-[#f5f5f3]' : 'border-[#e4e4e0]'}`}
      >
        <input type="radio" name="units" className="mt-1" checked={choice === u} onChange={() => setChoice(u)} />
        <span className="text-[13px]">
          <span className="font-medium">{UNIT_NAME[u]}</span>
          {u === detected && <span className="ml-1.5 rounded bg-[#f5f5f3] px-1.5 py-0.5 text-[11px] text-[#55554f]">как в файле</span>}
          <span className="block text-[#55554f]">
            Деталь {num(wMm, 1)} × {num(hMm, 1)} мм
            <span className="text-[#9a9a95]"> · {num(wMm / INCH, 2)} × {num(hMm / INCH, 2)}″</span>
          </span>
        </span>
      </label>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Подтвердите единицы чертежа">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl">
        <h2 className="text-[16px] font-semibold">Подтвердите единицы</h2>
        <p className="mt-1 break-words text-[12px] text-[#9a9a95]">{fileName} · {declared}</p>
        {hints.map((h, i) => (
          <p key={i} className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-900">{h.message}</p>
        ))}
        <div className="mt-3 space-y-2">{units.map(opt)}</div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg px-3 py-2 text-[13px] text-[#55554f] hover:bg-[#f5f5f3]">Отмена</button>
          <button type="button" onClick={() => onConfirm(choice)} className="rounded-lg bg-[#111110] px-4 py-2 text-[13px] font-medium text-white hover:bg-black">
            Подтвердить
          </button>
        </div>
      </div>
    </div>
  )
}
