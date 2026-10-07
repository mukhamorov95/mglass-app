'use client'

import { useEffect, useRef, useState } from 'react'
import { shipDateFrom, toDateInput, DEFAULT_WORKING_DAYS } from '@/lib/b2b/deadline'
import { launchOrder } from '@/lib/b2b/launchOrder'
import type { LaunchResult } from '@/lib/b2b/launchOrder'

// Панель «Запустить в работу»: дата запуска, срок сдачи, № заказа, чертёж. Одна на
// «Просчёты» и карточку сделки — раньше запуск жил только в окне списка просчётов.
export default function LaunchPanel({ orderId, initialNumber, productionDays, queueCount, onLaunched, onCancel }: {
  orderId: number
  initialNumber: string | null
  productionDays: number | null
  queueCount?: number | null
  onLaunched: (res: LaunchResult) => void
  onCancel: () => void
}) {
  const [workDate, setWorkDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [deadline, setDeadline] = useState(() => toDateInput(shipDateFrom(new Date(), productionDays)))
  const [number, setNumber] = useState(initialNumber ?? '')
  const [drawing, setDrawing] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const dateRef = useRef<HTMLInputElement>(null)

  useEffect(() => { const t = setTimeout(() => dateRef.current?.focus(), 50); return () => clearTimeout(t) }, [])

  async function launch() {
    if (!workDate || busy) return
    setBusy(true)
    try {
      const res = await launchOrder(orderId, { workDate, deadline: deadline || null, customNumber: number, drawing })
      if (res) onLaunched(res)
    } finally { setBusy(false) }
  }

  const onEnter = (e: React.KeyboardEvent) => { if (e.key === 'Enter') void launch() }
  const input = 'bg-white border border-[#d0e0ff] rounded-lg px-3 py-1.5 text-[13px] outline-none focus:border-blue-400 font-mono'
  const label = 'text-[11px] font-semibold text-blue-700 flex-shrink-0'

  return (
    <div className="px-4 py-3 border-t border-[#f0f0ec] bg-blue-50/50 flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-1.5">
        <span className={label}>Дата запуска:</span>
        <input ref={dateRef} type="date" className={input} value={workDate}
          onChange={e => setWorkDate(e.target.value)} onKeyDown={onEnter} />
      </div>
      <div className="flex items-center gap-1.5">
        <span className={label}>Срок сдачи:</span>
        <input type="date" title="Когда отдать клиенту — используется в Сводке производства" className={input}
          value={deadline} onChange={e => setDeadline(e.target.value)} onKeyDown={onEnter} />
        <span className="text-[10px] text-blue-700/70 whitespace-nowrap">
          {productionDays && productionDays > 0 ? `${productionDays} дн. из просчёта` : `${DEFAULT_WORKING_DAYS} раб. дней`}{queueCount != null && ` · в работе сейчас: ${queueCount}`}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className={label}>№ заказа:</span>
        <input type="text" placeholder="напр. 1453-1" className={`w-28 ${input}`}
          value={number} onChange={e => setNumber(e.target.value)} onKeyDown={onEnter} />
      </div>
      <div className="flex items-center gap-1.5">
        <span className={label}>Чертёж:</span>
        <label className="cursor-pointer bg-white border border-[#d0e0ff] rounded-lg px-3 py-1.5 text-[12px] text-[#111110] hover:border-blue-400 max-w-[180px] truncate">
          {drawing ? `📐 ${drawing.name}` : '📐 Прикрепить (PDF/фото)'}
          <input type="file" accept="application/pdf,image/*" className="hidden"
            onChange={e => setDrawing(e.target.files?.[0] ?? null)} />
        </label>
        {drawing && (
          <button onClick={() => setDrawing(null)} className="text-[#9a9a95] hover:text-red-600 text-sm px-0.5" title="Убрать файл">✕</button>
        )}
      </div>
      <p className="text-[11px] text-blue-600/70 flex-shrink-0">Заказ уйдёт в производство, задачи появятся в цеху</p>
      <div className="flex items-center gap-2 ml-auto">
        <button onClick={() => void launch()} disabled={!workDate || busy}
          className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-[#111110] text-white hover:bg-[#2a2a28] disabled:opacity-40 transition-colors whitespace-nowrap">
          {busy ? 'Запускаю…' : 'Запустить →'}
        </button>
        <button onClick={onCancel} className="text-[#9a9a95] hover:text-[#111110] transition-colors px-1 text-sm" aria-label="Закрыть">✕</button>
      </div>
    </div>
  )
}
