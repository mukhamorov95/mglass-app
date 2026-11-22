'use client'

// ФП Ф6: утверждённые версии финмодели по месяцам. Снимок всех юнитов
// finplan_models с нормативами; правка черновика после утверждения версию не меняет.

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { analyzeBreakeven, type BreakevenModel } from '@/lib/breakeven'

type Version = { id: number; month: string; version: number; data: Record<string, BreakevenModel>; approved_by: string | null; approved_at: string }
const LABEL: Record<string, string> = { mglass: 'M-Glass', production: 'Производство' }
const fmt = (n: number | null) => (n == null ? '—' : Math.round(n).toLocaleString('ru-RU') + ' ₽')

export function ModelVersions({ canApprove, meName }: { canApprove: boolean; meName: string }) {
  const sb = createClient()
  const [month, setMonth] = useState('')
  const [versions, setVersions] = useState<Version[]>([])
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMonth(new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' }).slice(0, 7))
  }, [])

  const load = useCallback(async () => {
    const { data } = await sb.from('finplan_model_versions').select('*').order('month', { ascending: false }).order('version', { ascending: false }).limit(24)
    setVersions((data ?? []) as Version[])
  }, [sb])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  async function approve() {
    if (!month) return
    const { data: models, error: e1 } = await sb.from('finplan_models').select('unit,data')
    if (e1 || !models?.length) { setMsg('Модель не прочитана' + (e1 ? ': ' + e1.message : '')); return }
    // Черновик ни на что не влияет — в версию не входит.
    const data = Object.fromEntries((models as { unit: string; data: BreakevenModel }[]).filter(m => m.unit !== 'production_draft').map(m => [m.unit, m.data]))
    const next = Math.max(0, ...versions.filter(v => v.month === month).map(v => v.version)) + 1
    const { data: wrote, error } = await sb.from('finplan_model_versions').insert({ month, version: next, data, approved_by: meName || null }).select('id')
    if (error || !wrote?.length) { setMsg('Не утверждено' + (error ? ': ' + error.message : ' — нет прав')); return }
    setMsg(`Версия ${next} на ${month} утверждена ✓`)
    await load()
  }

  return (
    <div className="bg-white rounded-xl border border-[#e4e4e0] p-4">
      <p className="text-[11px] font-bold uppercase tracking-widest text-[#9a9a95]">Утверждённые версии модели</p>
      {canApprove && (
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="border border-[#e4e4e0] rounded-lg px-2 py-1 text-[13px]" />
          <button onClick={approve} className="px-3 py-1.5 rounded-lg bg-[#111110] text-white text-[12px] font-semibold">Утвердить модель на месяц</button>
        </div>
      )}
      {msg && <p className="text-[12px] text-[#4b4b47] mt-2">{msg}</p>}
      {versions.length === 0 && <p className="text-[12px] text-[#9a9a95] mt-2">Пока ни одной — модель живёт черновиком.</p>}
      {versions.map(v => (
        <div key={v.id} className="mt-2 pt-2 border-t border-[#f0f0ee] text-[12px]">
          <p className="text-[#111110] font-semibold">{v.month} · версия {v.version} <span className="font-normal text-[#9a9a95]">· {v.approved_by ?? '—'} · {new Date(v.approved_at).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })}</span></p>
          {Object.entries(v.data).filter(([u]) => LABEL[u]).map(([u, m]) => {
            const a = analyzeBreakeven(m)
            return <p key={u} className="text-[#4b4b47] font-mono">{LABEL[u]}: выручка {fmt(a.revenue)} · маржа {Math.round(a.marginPct * 1000) / 10} % · ТБ {fmt(a.tb0)} · с фондами {fmt(a.tb1)}</p>
          })}
        </div>
      ))}
      <p className="text-[10px] text-[#c4c4be] mt-2">Правка модели после утверждения меняет только черновик; версия и отчёты по ней остаются прежними.</p>
    </div>
  )
}
