'use client'

import { useRef, useState } from 'react'
import type { ParsedGlassItem } from '@/app/api/b2b/parse-pdf/route'

type Props = {
  onConfirm: (items: ParsedGlassItem[]) => void
  onClose: () => void
}

const CONFIDENCE_BADGE: Record<string, string> = {
  high:   'bg-emerald-50 text-emerald-700',
  medium: 'bg-yellow-50 text-yellow-700',
  low:    'bg-red-50 text-red-600',
}
const CONFIDENCE_LABEL: Record<string, string> = {
  high: 'Высокая', medium: 'Средняя', low: 'Низкая',
}

type State = 'idle' | 'loading' | 'review' | 'error'

export default function PdfImportModal({ onConfirm, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<State>('idle')
  const [items, setItems] = useState<ParsedGlassItem[]>([])
  const [rawText, setRawText] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [dragging, setDragging] = useState(false)

  const ACCEPT = '.pdf,.jpg,.jpeg,.png'
  const ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png']

  async function processFile(file: File) {
    if (!ALLOWED_MIME.includes(file.type)) {
      setErrorMsg('Поддерживаются PDF, JPEG и PNG файлы')
      setState('error')
      return
    }
    setState('loading')
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/b2b/parse-pdf', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) { setErrorMsg(data.error ?? 'Ошибка сервера'); setState('error'); return }
      if (data.error && (!data.items || data.items.length === 0)) {
        setErrorMsg(data.error)
        setState('error')
        return
      }
      setItems(data.items ?? [])
      setRawText(data.rawText ?? '')
      setState('review')
    } catch {
      setErrorMsg('Не удалось отправить файл')
      setState('error')
    }
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) processFile(file)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }

  function updateItem(id: string, field: keyof ParsedGlassItem, value: string | number | boolean) {
    setItems(prev => prev.map(i => i.id === id ? { ...i, [field]: value } : i))
  }

  function removeItem(id: string) {
    setItems(prev => prev.filter(i => i.id !== id))
  }

  function addItem() {
    setItems(prev => [...prev, {
      id: `manual-${Date.now()}`,
      width: null, height: null, quantity: 1,
      label: '', comment: '', confidence: 'high', needsReview: false,
    }])
  }

  const validItems = items.filter(i => i.width && i.height)
  const reviewCount = items.filter(i => i.needsReview).length

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">

        {/* Шапка */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#f0f0ec]">
          <div>
            <h2 className="text-[16px] font-semibold text-[#111110]">Импорт размеров из PDF</h2>
            {state === 'review' && (
              <p className="text-[12px] text-[#8a8a85] mt-0.5">
                Найдено {items.length} позиций{reviewCount > 0 ? ` · ${reviewCount} требуют проверки` : ''}
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-[#c4c4be] hover:text-[#8a8a85] transition-colors text-2xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto">

          {/* Зона загрузки */}
          {(state === 'idle' || state === 'error') && (
            <div className="p-6 space-y-4">
              <div
                className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all ${dragging ? 'border-blue-400 bg-blue-50' : 'border-[#e4e4e0] hover:border-[#c4c4be] hover:bg-[#fafaf9]'}`}
                onDragOver={e => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => inputRef.current?.click()}>
                <div className="text-4xl mb-3">📄</div>
                <p className="text-[14px] font-medium text-[#111110]">Перетащите файл или нажмите для выбора</p>
                <p className="text-[12px] text-[#8a8a85] mt-1">PDF, JPEG, PNG · Макс. 20 МБ · Чертежи с размерами стекол</p>
                <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" onChange={handleFileInput} />
              </div>

              {state === 'error' && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-[13px] text-red-600">
                  {errorMsg}
                </div>
              )}

              <div className="bg-[#f8f8f7] rounded-xl p-4 text-[12px] text-[#6b6b66] space-y-1">
                <p className="font-semibold text-[#111110] mb-2">Что умеет распознавать:</p>
                <p>• Размеры в формате 1000×2000, 1000x2000, ширина/высота</p>
                <p>• Количество изделий</p>
                <p>• Маркировки и обозначения</p>
                <p>• PDF с текстом и с отсканированными чертежами</p>
                <p>• Фото чертежей (JPEG, PNG)</p>
              </div>
            </div>
          )}

          {/* Загрузка */}
          {state === 'loading' && (
            <div className="p-12 flex flex-col items-center justify-center gap-4">
              <div className="w-12 h-12 border-4 border-[#e4e4e0] border-t-[#111110] rounded-full animate-spin" />
              <div className="text-center">
                <p className="text-[14px] font-medium text-[#111110]">Claude анализирует чертёж...</p>
                <p className="text-[12px] text-[#8a8a85] mt-1">Это может занять 10–30 секунд</p>
              </div>
            </div>
          )}

          {/* Таблица проверки */}
          {state === 'review' && (
            <div className="p-6 space-y-4">
              {rawText && (
                <div className="bg-[#f8f8f7] rounded-xl px-4 py-3 text-[12px] text-[#6b6b66]">
                  <span className="font-semibold text-[#111110]">Что нашёл Claude: </span>{rawText}
                </div>
              )}

              <div className="space-y-2">
                {items.map((item, idx) => (
                  <div key={item.id}
                    className={`border rounded-xl p-4 transition-all ${item.needsReview ? 'border-yellow-300 bg-yellow-50' : 'border-[#e4e4e0] bg-white'}`}>
                    <div className="flex items-start gap-3">
                      <span className="text-[11px] font-bold text-[#c4c4be] mt-1 w-5 flex-shrink-0">#{idx + 1}</span>

                      <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <div>
                          <label className="block text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">Ширина (мм)</label>
                          <input type="number" min="1"
                            className={`w-full border rounded-lg px-2.5 py-1.5 text-[13px] font-mono outline-none transition-all ${!item.width ? 'border-red-300 bg-red-50' : 'border-[#e4e4e0] focus:border-[#111110]'}`}
                            value={item.width ?? ''}
                            onChange={e => updateItem(item.id, 'width', Number(e.target.value) || null as unknown as number)}
                            placeholder="?"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">Высота (мм)</label>
                          <input type="number" min="1"
                            className={`w-full border rounded-lg px-2.5 py-1.5 text-[13px] font-mono outline-none transition-all ${!item.height ? 'border-red-300 bg-red-50' : 'border-[#e4e4e0] focus:border-[#111110]'}`}
                            value={item.height ?? ''}
                            onChange={e => updateItem(item.id, 'height', Number(e.target.value) || null as unknown as number)}
                            placeholder="?"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">Кол-во</label>
                          <input type="number" min="1"
                            className="w-full border border-[#e4e4e0] rounded-lg px-2.5 py-1.5 text-[13px] font-mono outline-none focus:border-[#111110] transition-all"
                            value={item.quantity}
                            onChange={e => updateItem(item.id, 'quantity', Math.max(1, Number(e.target.value) || 1))}
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">Маркировка</label>
                          <input
                            className="w-full border border-[#e4e4e0] rounded-lg px-2.5 py-1.5 text-[13px] outline-none focus:border-[#111110] transition-all"
                            value={item.label}
                            onChange={e => updateItem(item.id, 'label', e.target.value)}
                            placeholder="А1, Стекло..."
                          />
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0">
                        {item.needsReview && <span title="Требует проверки" className="text-yellow-500 text-lg">⚠️</span>}
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${CONFIDENCE_BADGE[item.confidence]}`}>
                          {CONFIDENCE_LABEL[item.confidence]}
                        </span>
                        <button onClick={() => removeItem(item.id)}
                          className="text-[#c4c4be] hover:text-red-400 transition-colors text-xl leading-none">×</button>
                      </div>
                    </div>

                    {item.comment && (
                      <p className="mt-2 ml-8 text-[11px] text-[#9a9a95]">💬 {item.comment}</p>
                    )}
                  </div>
                ))}
              </div>

              <button onClick={addItem}
                className="w-full border border-dashed border-[#c4c4be] rounded-xl py-2.5 text-[13px] text-[#8a8a85] hover:border-[#8a8a85] hover:text-[#6b6b66] transition-all">
                + Добавить позицию вручную
              </button>

              {reviewCount > 0 && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3 text-[12px] text-yellow-800">
                  ⚠️ {reviewCount} позиций помечены как «требуют проверки» — проверьте размеры перед добавлением в расчёт
                </div>
              )}
              {validItems.length < items.length && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-[12px] text-red-700">
                  {items.length - validItems.length} позиций без размеров — заполните ширину и высоту или удалите их
                </div>
              )}
            </div>
          )}
        </div>

        {/* Подвал */}
        {state === 'review' && (
          <div className="border-t border-[#f0f0ec] px-6 py-4 flex items-center justify-between gap-3">
            <button onClick={() => { setState('idle'); setItems([]); setRawText('') }}
              className="text-[13px] text-[#8a8a85] hover:text-[#111110] transition-colors">
              ← Загрузить другой файл
            </button>
            <div className="flex items-center gap-3">
              <span className="text-[12px] text-[#9a9a95]">{validItems.length} из {items.length} готовы</span>
              <button
                onClick={() => { onConfirm(validItems); onClose() }}
                disabled={validItems.length === 0}
                className="bg-[#111110] text-white text-[13px] font-medium px-5 py-2.5 rounded-lg hover:bg-[#2a2a28] disabled:opacity-40 transition-colors">
                Добавить в расчёт ({validItems.length})
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
