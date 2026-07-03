'use client'

import { useEffect, useRef, useState } from 'react'
import { SHOWER_MODELS } from '@/lib/showerCalculator'
import type { ShowerModelId } from '@/lib/showerCalculator'
import { ShowerModelIcon } from '@/components/ShowerModelIcon'

type ImageMap = Record<string, string>
type ModelEdit = { title: string; description: string; hardware_base: number; active: boolean }

export default function ShowerImagesPage() {
  const [images, setImages]       = useState<ImageMap>({})
  const [models, setModels]       = useState<Record<string, ModelEdit>>({})
  const [loading, setLoading]     = useState(true)
  const [uploading, setUploading] = useState<string | null>(null)
  const [savingModel, setSavingModel] = useState<string | null>(null)
  const [savedModel, setSavedModel]   = useState<string | null>(null)
  const [error, setError]         = useState<string | null>(null)
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({})

  useEffect(() => {
    Promise.all([
      fetch('/api/admin/shower-images').then(r => r.ok ? r.json() : []),
      fetch('/api/admin/shower-models').then(r => r.ok ? r.json() : []),
    ]).then(([imgRows, modelRows]: [{ model_id: string; image_url: string }[], Array<{ code: string; title: string; description: string; hardware_base: number; active: boolean }>]) => {
      const imap: ImageMap = {}
      for (const row of (imgRows ?? [])) imap[row.model_id] = row.image_url
      setImages(imap)
      // Модели: значения из БД поверх дефолтов из кода.
      const mmap: Record<string, ModelEdit> = {}
      for (const m of SHOWER_MODELS) mmap[m.id] = { title: m.label, description: m.desc, hardware_base: m.hardwareBase, active: true }
      for (const r of (modelRows ?? [])) mmap[r.code] = { title: r.title, description: r.description, hardware_base: r.hardware_base, active: r.active }
      setModels(mmap)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  async function handleFile(modelId: string, file: File) {
    setUploading(modelId)
    setError(null)
    const fd = new FormData()
    fd.append('modelId', modelId)
    fd.append('file', file)
    const res = await fetch('/api/admin/shower-images', { method: 'POST', body: fd })
    const json = await res.json()
    if (json.url) setImages(prev => ({ ...prev, [modelId]: json.url }))
    else setError(json.error ?? 'Ошибка загрузки')
    setUploading(null)
  }

  async function handleDelete(modelId: string) {
    if (!confirm(`Удалить изображение ${modelId}?`)) return
    await fetch(`/api/admin/shower-images?modelId=${modelId}`, { method: 'DELETE' })
    setImages(prev => { const next = { ...prev }; delete next[modelId]; return next })
  }

  function editModel(code: string, patch: Partial<ModelEdit>) {
    setModels(prev => ({ ...prev, [code]: { ...prev[code], ...patch } }))
    setSavedModel(null)
  }

  async function saveModel(code: string) {
    setSavingModel(code)
    setError(null)
    const m = models[code]
    const res = await fetch('/api/admin/shower-models', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, title: m.title, description: m.description, hardware_base: m.hardware_base, active: m.active }),
    })
    const json = await res.json().catch(() => ({}))
    if (res.ok) { setSavedModel(code); setTimeout(() => setSavedModel(null), 1500) }
    else setError(json.error ?? 'Ошибка сохранения')
    setSavingModel(null)
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Модели душевых</h1>
          <p className="text-sm text-gray-500 mt-1">
            Фото, название, описание, база фурнитуры и вкл/выкл модели. Без фото показывается
            схема-иконка. Выключенные модели скрыты в калькуляторе (Бюджет).
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
        )}

        {loading ? (
          <div className="text-gray-400 text-sm">Загрузка...</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {SHOWER_MODELS.map(m => {
              const imgUrl      = images[m.id]
              const isUploading = uploading === m.id
              const md          = models[m.id] ?? { title: m.label, description: m.desc, hardware_base: m.hardwareBase, active: true }

              return (
                <div key={m.id}
                  className={`bg-white rounded-xl border overflow-hidden flex flex-col ${md.active ? 'border-gray-200' : 'border-gray-200 opacity-60'}`}>

                  <div className="relative bg-gray-50 flex items-center justify-center" style={{ height: 130 }}>
                    {imgUrl ? (
                      <img src={imgUrl} alt={md.title} className="w-full h-full object-contain p-1"/>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center p-3 opacity-60">
                        <ShowerModelIcon modelId={m.id as ShowerModelId} active={false}/>
                      </div>
                    )}
                    {isUploading && (
                      <div className="absolute inset-0 bg-white/80 flex items-center justify-center">
                        <div className="text-xs text-blue-600 font-medium">Загрузка…</div>
                      </div>
                    )}
                    {imgUrl && !isUploading && (
                      <button onClick={() => handleDelete(m.id)}
                        className="absolute top-1 right-1 w-6 h-6 bg-white rounded-full shadow text-gray-400 hover:text-red-500 text-xs flex items-center justify-center leading-none">×</button>
                    )}
                    <span className="absolute top-1 left-1 text-[10px] bg-white/90 text-gray-500 px-1.5 rounded font-semibold">{m.id} · {m.glassCount} ст.</span>
                  </div>

                  <div className="p-3 flex flex-col gap-2 flex-1">
                    <input value={md.title} onChange={e => editModel(m.id, { title: e.target.value })}
                      placeholder="Название"
                      className="w-full text-sm font-semibold text-gray-900 border border-gray-200 rounded-lg px-2 py-1 outline-none focus:border-blue-400"/>
                    <input value={md.description} onChange={e => editModel(m.id, { description: e.target.value })}
                      placeholder="Описание"
                      className="w-full text-[12px] text-gray-600 border border-gray-200 rounded-lg px-2 py-1 outline-none focus:border-blue-400"/>
                    <div className="flex items-center gap-2">
                      <label className="text-[11px] text-gray-400 flex-shrink-0">База фурн., ₽</label>
                      <input type="number" value={md.hardware_base} onChange={e => editModel(m.id, { hardware_base: Number(e.target.value) || 0 })}
                        className="w-full text-[12px] text-gray-800 border border-gray-200 rounded-lg px-2 py-1 outline-none focus:border-blue-400 font-mono"/>
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <label className="flex items-center gap-1.5 text-[12px] text-gray-600 cursor-pointer">
                        <input type="checkbox" checked={md.active} onChange={e => editModel(m.id, { active: e.target.checked })} className="accent-blue-600"/>
                        Активна
                      </label>
                      <button onClick={() => saveModel(m.id)} disabled={savingModel === m.id}
                        className="text-[12px] px-3 py-1 rounded-lg bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-40 font-medium transition-colors">
                        {savingModel === m.id ? '…' : savedModel === m.id ? '✓' : 'Сохранить'}
                      </button>
                    </div>

                    <button onClick={() => fileRefs.current[m.id]?.click()} disabled={isUploading}
                      className="mt-1 w-full text-xs py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 transition-colors disabled:opacity-40 font-medium">
                      {imgUrl ? '🔄 Заменить фото' : '📷 Загрузить фото'}
                    </button>
                    <input ref={el => { fileRefs.current[m.id] = el }} type="file" accept="image/*" className="hidden"
                      onChange={e => { const file = e.target.files?.[0]; if (file) handleFile(m.id, file); e.target.value = '' }}/>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
