'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { buildMeasureMessage } from '@/lib/measure/message'
import MeasureBoard from '@/components/measure/MeasureBoard'
import NewMeasureRequest from '@/components/measure/NewMeasureRequest'
import RequestsKanban from '@/components/measure/RequestsKanban'
import type { MeasureMe, MeasureReq, MeasurerLite } from '@/components/measure/types'

// Заявки на замер (менеджер): «＋ Новая заявка» → канбан «где каждая моя заявка»
// (ждут замерщика → назначены → сложность → выполнены) с поиском по адресу,
// телефону, № заказа и клиенту → занятость замерщиков. Владелец и офис видят все.

export default function MeasureRequestsPage() {
  const [me, setMe] = useState<MeasureMe | null>(null)
  const [reqs, setReqs] = useState<MeasureReq[]>([])
  const [measurers, setMeasurers] = useState<MeasurerLite[]>([])
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
  const [notice, setNotice] = useState<{ text: string; req: MeasureReq } | null>(null)
  const [copied, setCopied] = useState(false)
  const [boardKey, setBoardKey] = useState(0)
  const qRef = useRef('')

  // Список отфильтрован сервером по кругу видимости и строке поиска.
  const load = useCallback(async () => {
    const query = qRef.current.trim()
    const res = await fetch(`/api/measure-requests${query ? `?q=${encodeURIComponent(query)}` : ''}`, { cache: 'no-store' })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) setError(j.error || `Заявки не загрузились (${res.status})`)
    else { setError(''); setMe(j.me); setReqs(j.requests as MeasureReq[]); setMeasurers(j.measurers ?? []); setTruncated(!!j.truncated) }
    setLoading(false)
    setBoardKey(k => k + 1)
  }, [])

  // Загрузка сразу, поиск — с паузой после ввода, чтобы не дёргать сервер на каждую букву.
  useEffect(() => {
    qRef.current = q
    const t = setTimeout(() => { load().catch(() => setLoading(false)) }, q ? 350 : 0)
    return () => clearTimeout(t)
  }, [q, load])
  // Начатая и не созданная заявка — форма открыта сразу.
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (localStorage.getItem('mglass_measure_request_draft_v2') || localStorage.getItem('mglass_measure_request_draft')) setCreating(true)
    } catch { /* нет хранилища */ }
  }, [])

  async function copyNotice() {
    if (!notice) return
    try {
      await navigator.clipboard.writeText(buildMeasureMessage(notice.req))
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    } catch { setError('Не удалось скопировать — браузер не дал доступ к буферу обмена.') }
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-[13px] text-[#8a8a85]">Загрузка…</div>

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-5 pt-6 pb-4 space-y-3">
        <div>
          <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Заявки на замер</h1>
          <p className="text-[12px] text-[#9a9a95] mt-0.5">
            {me?.scope === 'all' ? 'Все заявки' : 'Твои заявки'} — где каждая сейчас. Ниже — когда свободны замерщики.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {me?.canCreate && !creating && (
            <button onClick={() => { setCreating(true); setNotice(null) }}
              className="text-[13px] font-semibold bg-[#111110] text-white rounded-lg px-4 py-2 hover:bg-[#2a2a28]">＋ Новая заявка</button>
          )}
          <input value={q} onChange={e => setQ(e.target.value)} type="search"
            placeholder="🔎 Поиск: адрес, телефон, № заказа, клиент"
            className="flex-1 min-w-[220px] bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#111110]" />
        </div>
      </div>

      <div className="px-5 pt-4 space-y-4 max-w-[1400px]">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-[12px] rounded-lg px-3 py-2 flex items-start gap-2">
            <span className="flex-1">{error}</span>
            <button onClick={() => setError('')} className="text-red-400 hover:text-red-700">✕</button>
          </div>
        )}
        {notice && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-[12px] rounded-lg px-3 py-2 flex items-center gap-2 flex-wrap">
            <span className="flex-1 min-w-[200px]">✅ {notice.text}</span>
            <button onClick={copyNotice} className="text-[11px] font-semibold border border-emerald-300 bg-white rounded-lg px-2 py-1 hover:bg-emerald-100">
              {copied ? '✓ Скопировано' : '📋 Текст замерщику'}
            </button>
            <button onClick={() => setNotice(null)} className="text-emerald-500 hover:text-emerald-800">✕</button>
          </div>
        )}

        {creating && me && (
          <NewMeasureRequest me={me} measurers={measurers}
            onClose={() => setCreating(false)}
            onCreated={(req, text) => { setCreating(false); setNotice({ req, text }); void load() }} />
        )}

        {me && <RequestsKanban me={me} requests={reqs} measurers={measurers} searching={!!q.trim()} onChanged={load} />}
        {truncated && <p className="text-[12px] text-amber-700">Показаны не все заявки — уточни поиск.</p>}

        <MeasureBoard title="Когда свободны замерщики" refreshKey={boardKey} />
      </div>
    </div>
  )
}
