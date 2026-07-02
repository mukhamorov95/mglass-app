'use client'

import { useEffect, useRef, useState } from 'react'
import { SHOWER_MODELS } from '@/lib/showerCalculator'
import type { ShowerModelId } from '@/lib/showerCalculator'
import { ShowerModelIcon } from '@/components/ShowerModelIcon'

type ImageMap = Record<string, string>

export default function ShowerImagesPage() {
  const [images, setImages]     = useState<ImageMap>({})
  const [loading, setLoading]   = useState(true)
  const [uploading, setUploading] = useState<string | null>(null)
  const [error, setError]       = useState<string | null>(null)
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({})

  useEffect(() => {
    fetch('/api/admin/shower-images')
      .then(r => r.json())
      .then((rows: { model_id: string; image_url: string }[]) => {
        const map: ImageMap = {}
        for (const row of rows) map[row.model_id] = row.image_url
        setImages(map)
        setLoading(false)
      })
  }, [])

  async function handleFile(modelId: string, file: File) {
    setUploading(modelId)
    setError(null)
    const fd = new FormData()
    fd.append('modelId', modelId)
    fd.append('file', file)
    const res = await fetch('/api/admin/shower-images', { method: 'POST', body: fd })
    const json = await res.json()
    if (json.url) {
      setImages(prev => ({ ...prev, [modelId]: json.url }))
    } else {
      setError(json.error ?? 'Ошибка загрузки')
    }
    setUploading(null)
  }

  async function handleDelete(modelId: string) {
    if (!confirm(`Удалить изображение ${modelId}?`)) return
    await fetch(`/api/admin/shower-images?modelId=${modelId}`, { method: 'DELETE' })
    setImages(prev => { const next = { ...prev }; delete next[modelId]; return next })
  }

  return (
    <div className="min-h-screen bg-canvas p-6">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-ink">Изображения моделей душевых</h1>
          <p className="text-sm text-muted mt-1">
            Загрузите фото для каждой модели. Рекомендуется JPG/PNG, не более 10 МБ.
            Если изображение не загружено — будет показана схема-иконка.
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-muted text-sm">Загрузка...</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {SHOWER_MODELS.map(m => {
              const imgUrl     = images[m.id]
              const isUploading = uploading === m.id

              return (
                <div key={m.id}
                  className="bg-surface rounded-xl border border-line overflow-hidden flex flex-col">

                  {/* превью */}
                  <div className="relative bg-subtle flex items-center justify-center"
                    style={{ height: 140 }}>
                    {imgUrl ? (
                      <img src={imgUrl} alt={m.label}
                        className="w-full h-full object-contain p-1"/>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center p-3 opacity-50">
                        <ShowerModelIcon modelId={m.id as ShowerModelId} active={false}/>
                      </div>
                    )}
                    {isUploading && (
                      <div className="absolute inset-0 bg-white/80 flex items-center justify-center">
                        <div className="text-xs text-blue-600 font-medium">Загрузка…</div>
                      </div>
                    )}
                    {imgUrl && !isUploading && (
                      <button
                        onClick={() => handleDelete(m.id)}
                        className="absolute top-1 right-1 w-6 h-6 bg-surface rounded-full shadow text-muted hover:text-red-500 text-xs flex items-center justify-center leading-none">
                        ×
                      </button>
                    )}
                  </div>

                  {/* инфо */}
                  <div className="p-3 flex flex-col gap-2 flex-1">
                    <div>
                      <span className="text-sm font-semibold text-ink">{m.label}</span>
                      <span className="ml-1.5 text-[11px] bg-line-soft text-muted px-1 rounded">
                        {m.glassCount} ст.
                      </span>
                      <div className="text-[11px] text-muted leading-tight mt-0.5">{m.desc}</div>
                    </div>

                    <button
                      onClick={() => fileRefs.current[m.id]?.click()}
                      disabled={isUploading}
                      className="mt-auto w-full text-xs py-1.5 rounded-lg border border-line
                        text-ink-soft hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700
                        transition-colors disabled:opacity-40 font-medium">
                      {imgUrl ? '🔄 Заменить' : '📷 Загрузить фото'}
                    </button>

                    <input
                      ref={el => { fileRefs.current[m.id] = el }}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={e => {
                        const file = e.target.files?.[0]
                        if (file) handleFile(m.id, file)
                        e.target.value = ''
                      }}
                    />
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
