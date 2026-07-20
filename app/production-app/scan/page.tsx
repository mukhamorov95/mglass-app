'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import ProductionTabs from '@/components/ProductionTabs'
import { createClient } from '@/lib/supabase-browser'
import { STAGE_LABELS, type DetailStageKey } from '@/lib/productionStages'

// Скан-отметка: камера (html5-qrcode) ИЛИ BT-сканер (HID-клавиатура). Скан
// MG-<orderId>-<itemIndex> → находим текущий готовый этап детали → «Готово».
// Режим «станция закреплена»: скан сразу отмечает этап этой станции (ноль тапов).
// Без станции — показываем деталь и её готовый этап с кнопкой.

type Task = { id: number; stage_key: string; station: string; status: string; blocked_by_task_id: number | null; sequence_order: number }
type Recent = { key: string; text: string; ok: boolean }

const STATIONS: DetailStageKey[] = ['cutting', 'curved', 'polishing', 'drilling', 'facet', 'tempering', 'triplex', 'packaging']

export default function ScanPage() {
  const sb = createClient()
  const [station, setStation] = useState<string>('')
  const [camera, setCamera] = useState(false)
  const [recent, setRecent] = useState<Recent[]>([])
  const [pending, setPending] = useState<{ orderId: number; itemIndex: number; label: string; tasks: Task[]; readyId: number | null } | null>(null)
  const busyRef = useRef(false)
  const bufRef = useRef('')
  const lastRef = useRef(0)
  const seenRef = useRef<{ code: string; t: number }>({ code: '', t: 0 })

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setStation(localStorage.getItem('scan-station') ?? '') }, [])
  const pickStation = (s: string) => { setStation(s); localStorage.setItem('scan-station', s) }

  const beep = (ok: boolean) => { try { navigator.vibrate?.(ok ? 60 : [40, 40, 40]) } catch { /* noop */ } }
  const pushRecent = (text: string, ok: boolean) => setRecent(r => [{ key: `${Date.now()}-${Math.round(text.length)}`, text, ok }, ...r].slice(0, 8))

  const markDone = useCallback(async (taskId: number, label: string) => {
    const r = await fetch(`/api/production-tasks/${taskId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'done' }) })
    if (r.ok) { beep(true); pushRecent(`✓ ${label}`, true); return true }
    const d = await r.json().catch(() => ({}))
    beep(false); pushRecent(`⚠ ${label} — ${d.message || d.error || 'ошибка'}`, false); return false
  }, [])

  const handleCode = useCallback(async (raw: string) => {
    if (busyRef.current) return
    const code = raw.trim()
    // антидубль: тот же код в пределах 2.5 с — игнор
    const nowT = Date.now()
    if (seenRef.current.code === code && nowT - seenRef.current.t < 2500) return
    seenRef.current = { code, t: nowT }

    const mPart = code.match(/^MG-(\d+)-(\d+)$/)
    const mOrder = code.match(/^MG-(\d+)$/)
    if (!mPart && !mOrder) { beep(false); pushRecent(`⚠ Не наш код: ${code}`, false); return }
    if (mOrder && !mPart) { window.location.href = `/production-app/orders/${mOrder[1]}`; return }

    busyRef.current = true
    try {
      const orderId = Number(mPart![1]), itemIndex = Number(mPart![2])
      const [{ data: ord }, { data: taskRows }] = await Promise.all([
        sb.from('b2b_orders').select('custom_number').eq('id', orderId).single(),
        sb.from('production_tasks').select('id,stage_key,station,status,blocked_by_task_id,sequence_order').eq('order_id', orderId).eq('item_index', itemIndex).order('sequence_order'),
      ])
      const tasks = (taskRows ?? []) as Task[]
      const label = `${(ord as { custom_number: string | null } | null)?.custom_number?.trim() || `00${orderId}`} · Поз.${itemIndex + 1}`
      if (!tasks.length) { beep(false); pushRecent(`⚠ ${label} — нет задач (заказ не запущен?)`, false); return }

      const open = tasks.filter(t => t.status !== 'done')
      const blockerIds = [...new Set(open.map(t => t.blocked_by_task_id).filter((x): x is number => x != null))]
      const { data: blk } = blockerIds.length ? await sb.from('production_tasks').select('id,status').in('id', blockerIds) : { data: [] as { id: number; status: string }[] }
      const blkStatus = new Map((blk ?? []).map(b => [b.id, b.status]))
      const isReady = (t: Task) => t.blocked_by_task_id == null || blkStatus.get(t.blocked_by_task_id) === 'done'

      if (station) {
        const t = open.find(x => x.station === station && isReady(x))
        if (t) { await markDone(t.id, `${label} · ${STAGE_LABELS[station as DetailStageKey]}`) }
        else {
          const doneHere = tasks.find(x => x.station === station && x.status === 'done')
          const waiting = open.find(x => x.station === station)
          beep(false)
          pushRecent(`⚠ ${label} — ${doneHere ? 'уже отмечено' : waiting ? 'ждёт предыдущий этап' : 'этой станции нет в маршруте'}`, false)
        }
      } else {
        const ready = open.find(isReady) ?? null
        setPending({ orderId, itemIndex, label, tasks: open, readyId: ready?.id ?? null })
      }
    } finally { busyRef.current = false }
  }, [sb, station, markDone])

  // BT-сканер = HID-клавиатура: копим символы, на Enter — обрабатываем.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return
      const now = Date.now()
      if (now - lastRef.current > 500) bufRef.current = ''
      lastRef.current = now
      if (e.key === 'Enter') { const b = bufRef.current; bufRef.current = ''; if (b) handleCode(b) }
      else if (e.key.length === 1) bufRef.current += e.key
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleCode])

  // Камера через html5-qrcode (динамический импорт).
  useEffect(() => {
    if (!camera) return
    let scanner: { clear: () => Promise<void> } | null = null
    let cancelled = false
    ;(async () => {
      const { Html5QrcodeScanner, Html5QrcodeSupportedFormats } = await import('html5-qrcode')
      if (cancelled) return
      const s = new Html5QrcodeScanner('scan-reader', { fps: 10, qrbox: { width: 240, height: 160 }, formatsToSupport: [Html5QrcodeSupportedFormats.CODE_128, Html5QrcodeSupportedFormats.QR_CODE] }, false)
      s.render((text: string) => handleCode(text), () => {})
      scanner = s as unknown as { clear: () => Promise<void> }
    })()
    return () => { cancelled = true; scanner?.clear().catch(() => {}) }
  }, [camera, handleCode])

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-4 pt-12 pb-4 lg:pt-6">
        <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Скан-отметка</h1>
        <p className="text-[13px] text-[#9a9a95] mt-0.5">Сканируй наклейку детали — этап отметится сам. BT-сканер работает всегда, камеру можно включить.</p>
        <ProductionTabs />
      </div>

      <div className="px-4 pt-4 max-w-[560px] mx-auto space-y-4">
        {/* Станция */}
        <div className="bg-white rounded-xl border border-[#e4e4e0] p-4">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-[#9a9a95] mb-2">Моя станция</p>
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => pickStation('')} className={`text-[12px] px-3 py-1.5 rounded-full ${station === '' ? 'bg-[#111110] text-white' : 'bg-[#f0f0ec] text-[#6b6b66]'}`}>Без станции (спрашивать)</button>
            {STATIONS.map(s => (
              <button key={s} onClick={() => pickStation(s)} className={`text-[12px] px-3 py-1.5 rounded-full ${station === s ? 'bg-[#111110] text-white' : 'bg-[#f0f0ec] text-[#6b6b66]'}`}>{STAGE_LABELS[s]}</button>
            ))}
          </div>
          <p className="text-[11px] text-[#9a9a95] mt-2">{station ? `Скан сразу отмечает «${STAGE_LABELS[station as DetailStageKey]}» готовым.` : 'Скан покажет деталь и её готовый этап с кнопкой.'}</p>
        </div>

        {/* Камера */}
        <div className="bg-white rounded-xl border border-[#e4e4e0] p-4">
          {!camera ? (
            <button onClick={() => setCamera(true)} className="w-full py-3 bg-[#111110] text-white text-[14px] font-semibold rounded-lg">📷 Включить камеру</button>
          ) : (
            <>
              <div id="scan-reader" className="w-full" />
              <button onClick={() => setCamera(false)} className="w-full mt-2 py-2 text-[13px] text-[#6b6b66]">Выключить камеру</button>
            </>
          )}
          <p className="text-[11px] text-[#9a9a95] mt-2 text-center">…или просто сканируй BT-сканером — камера не нужна.</p>
        </div>

        {/* Разбор детали без станции */}
        {pending && (
          <div className="bg-white rounded-xl border-2 border-[#111110] p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[15px] font-bold text-[#111110]">{pending.label}</p>
              <button onClick={() => setPending(null)} className="text-[#c4c4be] hover:text-[#111110] text-[15px]">✕</button>
            </div>
            <div className="space-y-1.5">
              {pending.tasks.map(t => {
                const ready = t.id === pending.readyId
                return (
                  <div key={t.id} className={`flex items-center justify-between rounded-lg px-3 py-2 ${ready ? 'bg-emerald-50 border border-emerald-200' : 'bg-[#f5f5f3]'}`}>
                    <span className="text-[13px] text-[#111110]">{STAGE_LABELS[t.station as DetailStageKey] ?? t.station}{t.status === 'in_progress' ? ' · в работе' : ''}</span>
                    {ready ? (
                      <button onClick={async () => { const ok = await markDone(t.id, `${pending.label} · ${STAGE_LABELS[t.station as DetailStageKey]}`); if (ok) setPending(null) }}
                        className="px-4 py-1.5 bg-emerald-600 text-white text-[13px] font-semibold rounded-lg">Готово</button>
                    ) : <span className="text-[11px] text-[#9a9a95]">ждёт</span>}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* История сканов */}
        <div className="bg-white rounded-xl border border-[#e4e4e0] p-4">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-[#9a9a95] mb-2">Последние сканы</p>
          {recent.length === 0 ? (
            <p className="text-[13px] text-[#9a9a95]">Пока пусто — сканируй наклейку.</p>
          ) : (
            <div className="space-y-1">
              {recent.map(r => <p key={r.key} className={`text-[13px] ${r.ok ? 'text-emerald-700' : 'text-red-600'}`}>{r.text}</p>)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
