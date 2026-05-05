'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import Link from 'next/link'

type CostLine = { name: string; qty: number; unit: string; price: number; total: number; note?: string }

type Calc = {
  id: number
  created_at: string
  product_type: string
  input_data: Record<string, unknown>
  cost_breakdown: { lines: CostLine[]; totalCost: number }
  financial_breakdown: {
    expensesPercent: number
    expensesAmount: number
    basePrice: number
    partnerAmount: number
    discountAmount: number
    serviceLines: CostLine[]
    servicesTotal: number
  }
  base_price: number
  discount: number
  partner_percent: number
  final_price: number
  margin: number
  profit: number
  status: string
  client_text: string | null
  notes: string | null
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Черновик', sent: 'Отправлен', approved: 'Принят', rejected: 'Отклонён',
}

export default function CalculationDetailPage() {
  const { id } = useParams()
  const [calc, setCalc] = useState<Calc | null>(null)
  const [loading, setLoading] = useState(true)

  // Edit mode state
  const [editMode, setEditMode] = useState(false)
  const [editDiscount, setEditDiscount] = useState(0)
  const [editNotes, setEditNotes] = useState('')
  const [editClientText, setEditClientText] = useState('')
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data } = await supabase.from('calculations').select('*').eq('id', id).single()
      if (data) {
        setCalc(data)
        setEditDiscount(data.discount ?? 0)
        setEditNotes(data.notes ?? '')
        setEditClientText(data.client_text ?? '')
      }
      setLoading(false)
    }
    load()
  }, [id])

  async function updateStatus(status: string) {
    const supabase = createClient()
    await supabase.from('calculations').update({ status }).eq('id', id)
    setCalc(c => c ? { ...c, status } : c)
  }

  async function saveEdit() {
    if (!calc) return
    setSaving(true)
    const fb = calc.financial_breakdown
    const cb = calc.cost_breakdown
    const priceWithPartner = calc.base_price + (fb.partnerAmount ?? 0)
    const newFinalPrice = Math.round(priceWithPartner * (1 - editDiscount / 100))
    const newProfit = Math.round(newFinalPrice - cb.totalCost - fb.expensesAmount)
    const newMargin = newFinalPrice > 0 ? Number(((newProfit / newFinalPrice) * 100).toFixed(1)) : 0

    const supabase = createClient()
    await supabase.from('calculations').update({
      discount: editDiscount,
      final_price: newFinalPrice,
      profit: newProfit,
      margin: newMargin,
      notes: editNotes,
      client_text: editClientText,
    }).eq('id', id)

    setCalc(c => c ? { ...c, discount: editDiscount, final_price: newFinalPrice, profit: newProfit, margin: newMargin, notes: editNotes, client_text: editClientText } : c)
    setEditMode(false)
    setSaving(false)
  }

  async function handleCopy() {
    const text = editMode ? editClientText : calc?.client_text
    if (!text) return
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-400">Загрузка...</div>
  if (!calc)   return <div className="min-h-screen flex items-center justify-center text-gray-400">Расчёт не найден</div>

  const fb = calc.financial_breakdown
  const cb = calc.cost_breakdown
  const productLabel = calc.product_type === 'mirror' ? 'Зеркало с подсветкой' : 'Лофт-перегородка'
  const params = calc.product_type === 'mirror'
    ? `${calc.input_data.width}×${calc.input_data.height} мм`
    : `${calc.input_data.width}×${calc.input_data.height} мм, ${calc.input_data.sections} секц.`

  // Preview recalculation while editing
  const priceWithPartner = calc.base_price + (fb.partnerAmount ?? 0)
  const previewFinalPrice = editMode ? Math.round(priceWithPartner * (1 - editDiscount / 100)) : calc.final_price
  const previewProfit = editMode ? Math.round(previewFinalPrice - cb.totalCost - fb.expensesAmount) : calc.profit
  const previewMargin = editMode && previewFinalPrice > 0 ? Number(((previewProfit / previewFinalPrice) * 100).toFixed(1)) : calc.margin
  const displayMargin = editMode ? previewMargin : calc.margin

  const marginBg = displayMargin >= 35 ? 'bg-green-50 border-green-200' : displayMargin >= 25 ? 'bg-yellow-50 border-yellow-200' : 'bg-red-50 border-red-200'
  const marginColor = displayMargin >= 35 ? 'text-green-600' : displayMargin >= 25 ? 'text-yellow-600' : 'text-red-600'

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto">

        {/* Шапка */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Link href="/calculations" className="text-gray-400 hover:text-gray-600 text-sm">← История</Link>
            <span className="text-gray-300">/</span>
            <h1 className="text-xl font-bold text-gray-900">Расчёт #{calc.id}</h1>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${calc.product_type === 'mirror' ? 'bg-blue-50 text-blue-700' : 'bg-orange-50 text-orange-700'}`}>
              {productLabel}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {!editMode ? (
              <>
                <button onClick={() => setEditMode(true)}
                  className="px-4 py-2 bg-white border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50">
                  Редактировать
                </button>
                <button onClick={() => window.open(`/calculations/${calc.id}/print`, '_blank')}
                  className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700">
                  Скачать PDF
                </button>
                <select value={calc.status} onChange={e => updateStatus(e.target.value)}
                  className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </>
            ) : (
              <>
                <button onClick={() => { setEditMode(false); setEditDiscount(calc.discount); setEditNotes(calc.notes ?? ''); setEditClientText(calc.client_text ?? '') }}
                  className="px-4 py-2 bg-white border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50">
                  Отмена
                </button>
                <button onClick={saveEdit} disabled={saving}
                  className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
                  {saving ? 'Сохранение...' : 'Сохранить изменения'}
                </button>
              </>
            )}
          </div>
        </div>

        {editMode && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4 text-sm text-amber-800">
            Режим редактирования — изменения применятся к сохранённому расчёту
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* Параметры */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Параметры</h2>
            <p className="text-sm text-gray-700 font-medium">{params}</p>
            <p className="text-xs text-gray-400 mt-1">
              {new Date(calc.created_at).toLocaleString('ru-RU', { dateStyle: 'long', timeStyle: 'short' })}
            </p>
          </div>

          {/* Итог */}
          <div className={`rounded-xl border p-5 ${marginBg}`}>
            <div className="flex justify-between items-center mb-3">
              <span className="text-sm font-semibold text-gray-700">Итого клиенту</span>
              <span className="text-2xl font-bold font-mono text-gray-900">{previewFinalPrice.toLocaleString('ru-RU')} ₽</span>
            </div>

            {editMode && (
              <div className="mb-3 flex items-center gap-3 bg-white rounded-lg px-3 py-2">
                <label className="text-xs text-gray-500 flex-shrink-0">Скидка:</label>
                <input
                  type="number" min="0" max="50" step="1"
                  className="w-16 text-sm font-mono border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={editDiscount}
                  onChange={e => setEditDiscount(Number(e.target.value))}
                />
                <span className="text-xs text-gray-400">%</span>
                {editDiscount !== calc.discount && (
                  <span className="text-xs text-amber-600 ml-auto">
                    было: {calc.final_price.toLocaleString('ru-RU')} ₽
                  </span>
                )}
              </div>
            )}

            <div className="grid grid-cols-3 gap-3">
              <div className="text-center">
                <p className="text-xs text-gray-500">Маржа</p>
                <p className={`text-lg font-bold ${marginColor}`}>{displayMargin}%</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-500">Прибыль</p>
                <p className="text-lg font-bold text-gray-900">{previewProfit.toLocaleString('ru-RU')} ₽</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-500">Скидка</p>
                <p className="text-lg font-bold text-gray-900">{(editMode ? editDiscount : calc.discount) > 0 ? `${editMode ? editDiscount : calc.discount}%` : '—'}</p>
              </div>
            </div>
          </div>

          {/* Себестоимость */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Себестоимость</h2>
            <div className="space-y-1">
              {cb.lines.map((l, i) => (
                <div key={i} className="flex justify-between text-xs py-1 border-b border-gray-50 last:border-0">
                  <span className="text-gray-600">{l.name} <span className="text-gray-400">{l.qty} {l.unit}</span></span>
                  <span className="font-mono text-gray-900">{l.total.toLocaleString('ru-RU')} ₽</span>
                </div>
              ))}
            </div>
            <div className="flex justify-between pt-2 mt-2 border-t border-gray-200 text-sm font-semibold">
              <span>Итого</span>
              <span className="font-mono">{cb.totalCost.toLocaleString('ru-RU')} ₽</span>
            </div>
          </div>

          {/* Финмодель */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Финансовая модель</h2>
            <div className="space-y-2 text-sm">
              {[
                { label: 'Себестоимость', value: cb.totalCost },
                { label: `Расходы (${fb.expensesPercent}%)`, value: fb.expensesAmount },
                { label: 'Базовая цена', value: fb.basePrice, bold: true },
                ...(fb.partnerAmount > 0 ? [{ label: 'Партнёрка', value: fb.partnerAmount }] : []),
                ...((editMode ? editDiscount : calc.discount) > 0 ? [{ label: `Скидка (${editMode ? editDiscount : calc.discount}%)`, value: -(priceWithPartner - previewFinalPrice) }] : []),
                ...((fb.serviceLines ?? []).map(l => ({ label: `${l.name} ${l.qty > 1 ? `${l.qty} ${l.unit}` : ''}`.trim(), value: l.total }))),
                { label: 'Итого клиенту', value: previewFinalPrice, bold: true },
              ].map((row, i) => (
                <div key={i} className={`flex justify-between ${row.bold ? 'font-semibold border-t border-gray-200 pt-2 mt-1' : ''}`}>
                  <span className="text-gray-600">{row.label}</span>
                  <span className="font-mono text-gray-900">
                    {row.value < 0 ? '−' : ''}{Math.abs(row.value).toLocaleString('ru-RU')} ₽
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Клиентский текст */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Текст для клиента</h2>
              <button onClick={handleCopy} className="text-xs px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700">
                {copied ? 'Скопировано ✓' : 'Копировать'}
              </button>
            </div>
            {editMode ? (
              <textarea
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 font-sans leading-relaxed"
                rows={8}
                value={editClientText}
                onChange={e => setEditClientText(e.target.value)}
              />
            ) : (
              <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed bg-gray-50 rounded-lg p-3">
                {calc.client_text}
              </pre>
            )}
          </div>

          {/* Заметки */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Заметки</h2>
            <textarea
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={4}
              placeholder="Имя клиента, адрес, пожелания..."
              value={editNotes}
              onChange={e => setEditNotes(e.target.value)}
            />
            {!editMode && (
              <button
                onClick={async () => {
                  const supabase = createClient()
                  await supabase.from('calculations').update({ notes: editNotes }).eq('id', id)
                }}
                className="mt-2 px-3 py-1.5 text-xs bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700"
              >
                Сохранить заметку
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
