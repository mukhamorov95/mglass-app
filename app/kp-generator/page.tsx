'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'

type Calculation = {
  id: number
  product_type: string
  final_price: number
  created_at: string
}

const PRODUCT_LABELS: Record<string, string> = {
  mirror: 'Зеркало',
  loft: 'Лофт',
  shower: 'Душевая',
  order: 'Заказ',
}

export default function KPGeneratorPage() {
  const [calculations, setCalculations] = useState<Calculation[]>([])
  const [selectedCalcId, setSelectedCalcId] = useState<number | ''>('')
  const [kpContext, setKpContext] = useState('')
  const [kpResult, setKpResult] = useState('')
  const [kpLoading, setKpLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    createClient()
      .from('calculations')
      .select('id,product_type,final_price,created_at')
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data }) => setCalculations(data ?? []))
  }, [])

  async function generateKP() {
    setKpLoading(true)
    setKpResult('')
    setCopied(false)
    try {
      const res = await fetch('/api/ai/generate-kp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ calculation_id: selectedCalcId || null, context: kpContext }),
      })
      const data = await res.json()
      setKpResult(data.text ?? data.error ?? 'Нет результата')
    } catch (err) {
      setKpResult(`Ошибка: ${err instanceof Error ? err.message : 'Что-то пошло не так'}`)
    } finally {
      setKpLoading(false)
    }
  }

  function copyKP() {
    navigator.clipboard.writeText(kpResult)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="max-w-[720px] mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="text-[18px] font-bold text-[#111110] tracking-tight">КП Генератор</h1>
        <p className="text-[13px] text-[#8a8a85] mt-0.5">Выбери расчёт из истории — AI напишет готовое коммерческое предложение</p>
      </div>

      <div className="bg-white border border-[#e4e4e0] rounded-xl p-6 space-y-5">
        <div>
          <label className="block text-[11px] font-bold text-[#9a9a95] uppercase tracking-widest mb-2">
            Расчёт из истории
          </label>
          <select
            value={selectedCalcId}
            onChange={e => setSelectedCalcId(e.target.value ? Number(e.target.value) : '')}
            className="w-full rounded-lg border border-[#e4e4e0] px-3 py-2.5 text-[13px] text-[#111110] bg-white focus:outline-none focus:border-[#8a8a85] transition-colors">
            <option value="">— Без расчёта (универсальный шаблон)</option>
            {calculations.map(c => (
              <option key={c.id} value={c.id}>
                #{c.id} · {PRODUCT_LABELS[c.product_type] ?? c.product_type} · {c.final_price.toLocaleString('ru-RU')} ₽ · {new Date(c.created_at).toLocaleDateString('ru-RU')}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[11px] font-bold text-[#9a9a95] uppercase tracking-widest mb-2">
            Контекст (необязательно)
          </label>
          <textarea
            value={kpContext}
            onChange={e => setKpContext(e.target.value)}
            placeholder="Имя клиента, пожелания по тону, особые условия, что важно подчеркнуть…"
            rows={3}
            className="w-full rounded-lg border border-[#e4e4e0] px-3 py-2.5 text-[13px] text-[#111110] placeholder:text-[#c4c4be] focus:outline-none focus:border-[#8a8a85] transition-colors resize-none"
          />
        </div>

        <button onClick={generateKP} disabled={kpLoading}
          className="w-full py-3 rounded-xl bg-[#111110] text-white text-[13px] font-semibold disabled:opacity-40 hover:bg-[#2a2a28] transition-colors flex items-center justify-center gap-2">
          {kpLoading && (
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
          {kpLoading ? 'Генерирую…' : 'Сгенерировать КП'}
        </button>
      </div>

      {kpResult && (
        <div className="bg-white border border-[#e4e4e0] rounded-xl p-6 mt-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[14px] font-semibold text-[#111110]">Готовое КП</h3>
            <button onClick={copyKP}
              className="text-[12px] px-3 py-1.5 rounded-lg bg-[#f0f0ec] text-[#6b6b66] hover:bg-[#e8e8e4] transition-colors flex items-center gap-1.5">
              {copied ? (
                <>
                  <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Скопировано
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Копировать
                </>
              )}
            </button>
          </div>
          <div className="text-[13px] text-[#111110] leading-relaxed whitespace-pre-wrap bg-[#f8f8f6] rounded-lg p-4 border border-[#ececea]">
            {kpResult}
          </div>
        </div>
      )}
    </div>
  )
}
