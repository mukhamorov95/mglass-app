'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

type Extracted = { name?: string | null; product?: string | null; sizes?: string | null; city?: string | null; budget?: string | null; phone?: string | null }
type Candidate = {
  chat_id: string; title: string; clientName: string; lastText: string
  already_imported: boolean; status: 'interested' | 'refused' | 'unclear'; reason: string
  extracted: Extracted; score: number; flags?: Record<string, boolean>
}
type Resp = { selfId?: number; scanned?: number; candidates?: Candidate[]; error?: string; hint?: string }

const STATUS_META: Record<string, { label: string; cls: string }> = {
  interested: { label: 'Интересно',  cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  unclear:    { label: 'Непонятно',  cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  refused:    { label: 'Отказ',      cls: 'bg-red-50 text-red-600 border-red-200' },
}

export default function AvitoImportPage() {
  const [data, setData]       = useState<Resp | null>(null)
  const [loading, setLoading] = useState(true)
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [showRefused, setShowRefused] = useState(false)
  const [importing, setImporting] = useState(false)
  const [result, setResult]   = useState('')

  async function scan() {
    setLoading(true); setData(null); setResult('')
    try {
      const r = await fetch('/api/avito/import')
      const d: Resp = await r.json()
      setData(d)
      // По умолчанию отмечаем ВСЕХ, кроме явных отказников и уже импортированных
      // (правило владельца: «всех остальных добавить»).
      const chk: Record<string, boolean> = {}
      for (const c of (d.candidates ?? [])) chk[c.chat_id] = !c.already_imported && c.status !== 'refused'
      setChecked(chk)
    } catch { setData({ error: 'Ошибка сети' }) }
    finally { setLoading(false) }
  }
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void scan() }, [])

  const candidates = data?.candidates ?? []
  const visible = candidates.filter(c => showRefused || c.status !== 'refused' || c.already_imported)
  const selectedCount = candidates.filter(c => checked[c.chat_id] && !c.already_imported).length

  async function runImport() {
    setImporting(true); setResult('')
    const items = candidates.filter(c => checked[c.chat_id] && !c.already_imported).map(c => ({
      chat_id: c.chat_id, name: c.clientName || c.extracted.name || undefined,
      phone: c.extracted.phone || undefined, product: c.extracted.product || undefined,
      sizes: c.extracted.sizes || undefined, city: c.extracted.city || undefined,
      budget: c.extracted.budget || undefined, score: c.score, flags: c.flags,
    }))
    try {
      const r = await fetch('/api/avito/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Ошибка')
      setResult(`Импортировано: ${d.inserted}${d.skipped ? ` · пропущено (уже были): ${d.skipped}` : ''}`)
      await scan()
    } catch (e) { setResult('Ошибка: ' + (e as Error).message) }
    finally { setImporting(false) }
  }

  return (
    <div className="min-h-screen bg-[#f8f8f7]">
      <div className="max-w-[900px] mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div>
            <Link href="/crm" className="text-[12px] text-[#0071e3] hover:underline">← Воронка</Link>
            <h1 className="text-[18px] font-semibold text-[#111110] mt-1">Импорт заявок с Авито</h1>
            <p className="text-[12px] text-[#9a9a95]">Отказники и «неинтересно» не отмечаются. Уже добавленные — пропускаются.</p>
          </div>
          <button onClick={scan} disabled={loading} className="px-3 py-1.5 rounded-lg border border-[#e4e4e0] bg-white text-[12px] font-medium disabled:opacity-50">
            {loading ? 'Сканирую…' : '↻ Обновить'}
          </button>
        </div>

        {loading && <div className="bg-white border border-[#e4e4e0] rounded-xl px-5 py-8 text-center text-[13px] text-[#9a9a95]">Читаю чаты Авито и классифицирую…</div>}

        {!loading && data?.error && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4">
            <p className="text-[13px] font-semibold text-amber-800 mb-1">Импорт недоступен</p>
            <p className="text-[12px] text-amber-700">{data.error}</p>
            {data.hint && <p className="text-[11px] text-amber-600 mt-2">{data.hint}</p>}
          </div>
        )}

        {!loading && data && !data.error && (
          <>
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <p className="text-[12px] text-[#6b6b66]">Просканировано чатов: <b>{data.scanned ?? 0}</b> · к импорту отмечено: <b>{selectedCount}</b></p>
              <div className="flex items-center gap-3">
                <button onClick={() => setChecked(Object.fromEntries(candidates.filter(c => !c.already_imported && c.status !== 'refused').map(c => [c.chat_id, true])))}
                  className="text-[12px] text-[#0071e3] hover:underline">отметить все</button>
                <button onClick={() => setChecked({})} className="text-[12px] text-[#9a9a95] hover:underline">снять</button>
                <label className="text-[12px] text-[#6b6b66] flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={showRefused} onChange={e => setShowRefused(e.target.checked)} />
                  показать отказников
                </label>
              </div>
            </div>

            <div className="space-y-2">
              {visible.map(c => {
                const meta = STATUS_META[c.status] ?? STATUS_META.unclear
                return (
                  <div key={c.chat_id} className={`bg-white border rounded-xl px-4 py-3 flex items-start gap-3 ${c.already_imported ? 'opacity-55 border-[#e4e4e0]' : 'border-[#e4e4e0]'}`}>
                    <input type="checkbox" className="mt-1" disabled={c.already_imported}
                      checked={!!checked[c.chat_id]} onChange={e => setChecked(s => ({ ...s, [c.chat_id]: e.target.checked }))} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-[#111110] text-[14px]">{c.clientName || 'Без имени'}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${meta.cls}`}>{meta.label}</span>
                        {c.already_imported && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#f0f0ec] text-[#9a9a95]">уже в CRM</span>}
                        {c.score > 0 && <span className="text-[10px] text-[#9a9a95]">score {c.score}</span>}
                      </div>
                      {c.title && <p className="text-[11px] text-[#9a9a95] mt-0.5 truncate">📦 {c.title}</p>}
                      {c.lastText && <p className="text-[12px] text-[#6b6b66] mt-1 line-clamp-2">{c.lastText}</p>}
                      <div className="flex gap-2 flex-wrap mt-1 text-[11px] text-[#9a9a95]">
                        {c.extracted.product && <span>🪟 {c.extracted.product}</span>}
                        {c.extracted.sizes && <span>📐 {c.extracted.sizes}</span>}
                        {c.extracted.city && <span>📍 {c.extracted.city}</span>}
                        {c.reason && <span className="italic">· {c.reason}</span>}
                      </div>
                    </div>
                  </div>
                )
              })}
              {visible.length === 0 && <div className="bg-white border border-[#e4e4e0] rounded-xl px-5 py-8 text-center text-[13px] text-[#9a9a95]">Нет чатов для показа.</div>}
            </div>

            <div className="sticky bottom-0 mt-4 py-3 bg-[#f8f8f7] flex items-center gap-4">
              <button onClick={runImport} disabled={importing || selectedCount === 0}
                className="px-5 py-2 rounded-lg bg-[#111110] text-white text-[13px] font-medium disabled:opacity-40">
                {importing ? 'Импорт…' : `Импортировать ${selectedCount} → в воронку`}
              </button>
              {result && <span className="text-[12px] text-emerald-700">{result}</span>}
              {result && result.startsWith('Импортировано') && (
                <Link href="/crm" className="text-[12px] text-[#0071e3] font-semibold hover:underline">Открыть воронку →</Link>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
