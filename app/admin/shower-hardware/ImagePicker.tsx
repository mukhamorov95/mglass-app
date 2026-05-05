'use client'

import { useState, useRef } from 'react'
import { createClient } from '@/lib/supabase-browser'

const BUCKET = 'furniture-shower'

export const CATEGORY_FOLDERS: Record<string, string> = {
  'профили':       'profiles',
  'петли':         'hinges',
  'ручки':         'handles',
  'штанги':        'rods',
  'уплотнители':   'seals',
  'механизмы':     'sliding',
  'крепления':     'extra',
  'комплектующие': 'extra',
  'аксессуары':    'extra',
  'прочее':        'extra',
}

type LibFile = { name: string; url: string }

export function ImagePicker({
  value, category, onChange,
}: {
  value: string
  category: string
  onChange: (url: string) => void
}) {
  const db       = useRef(createClient())
  const fileRef  = useRef<HTMLInputElement>(null)

  const [uploading,     setUploading]     = useState(false)
  const [showPicker,    setShowPicker]    = useState(false)
  const [libImages,     setLibImages]     = useState<LibFile[]>([])
  const [loadingLib,    setLoadingLib]    = useState(false)
  const [uploadError,   setUploadError]   = useState('')

  const folder = CATEGORY_FOLDERS[category] ?? 'extra'

  // ── Upload ──────────────────────────────────────────────────────
  async function handleUpload(file: File) {
    setUploading(true)
    setUploadError('')
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const path     = `${folder}/${Date.now()}_${safeName}`

    const { data, error } = await db.current.storage
      .from(BUCKET)
      .upload(path, file, { cacheControl: '31536000', upsert: false })

    if (error) {
      setUploadError(error.message)
    } else if (data) {
      const { data: urlData } = db.current.storage.from(BUCKET).getPublicUrl(data.path)
      onChange(urlData.publicUrl)
    }
    setUploading(false)
  }

  // ── Open library ────────────────────────────────────────────────
  async function openLib() {
    setShowPicker(true)
    setLoadingLib(true)
    const { data } = await db.current.storage
      .from(BUCKET)
      .list(folder, { limit: 200, sortBy: { column: 'created_at', order: 'desc' } })

    const files = (data ?? [])
      .filter(f => !f.name.startsWith('.'))
      .map(f => ({
        name: f.name,
        url: db.current.storage.from(BUCKET).getPublicUrl(`${folder}/${f.name}`).data.publicUrl,
      }))
    setLibImages(files)
    setLoadingLib(false)
  }

  // ── Render ──────────────────────────────────────────────────────
  return (
    <div>
      {/* Preview */}
      <div className="mb-2">
        {value ? (
          <div className="relative w-20 h-20 group">
            <img src={value} alt="" className="w-full h-full object-cover rounded-lg border border-[#e4e4e0]" />
            <button type="button" onClick={() => onChange('')}
              className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow">
              ✕
            </button>
          </div>
        ) : (
          <div className="w-20 h-20 bg-[#f5f5f3] border border-dashed border-[#d4d4d0] rounded-lg flex items-center justify-center">
            <svg className="w-6 h-6 text-[#c4c4c0]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
        )}
      </div>

      {/* Buttons */}
      <div className="flex gap-1.5 flex-wrap">
        <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
          className="flex items-center gap-1 px-2.5 py-1.5 bg-white border border-[#e4e4e0] rounded-lg text-[12px] text-[#111110] hover:bg-[#f8f8f7] disabled:opacity-40 transition-colors">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          {uploading ? 'Загрузка...' : 'Загрузить'}
        </button>
        <button type="button" onClick={openLib}
          className="flex items-center gap-1 px-2.5 py-1.5 bg-white border border-[#e4e4e0] rounded-lg text-[12px] text-[#6b6b66] hover:bg-[#f8f8f7] transition-colors">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
          </svg>
          Из библиотеки
        </button>
        {value && (
          <a href={value} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1 px-2.5 py-1.5 text-[12px] text-[#9a9a95] hover:text-blue-600 transition-colors">
            Открыть ↗
          </a>
        )}
      </div>

      {uploadError && (
        <p className="mt-1 text-[11px] text-red-500">{uploadError}</p>
      )}

      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={e => {
          if (e.target.files?.[0]) handleUpload(e.target.files[0])
          e.target.value = ''
        }} />

      {/* Library modal */}
      {showPicker && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
          onClick={e => { if (e.target === e.currentTarget) setShowPicker(false) }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[560px] max-h-[80vh] flex flex-col overflow-hidden">

            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#e4e4e0]">
              <div>
                <p className="text-[14px] font-semibold text-[#111110]">Библиотека изображений</p>
                <p className="text-[11px] text-[#9a9a95] mt-0.5">папка: {folder}/</p>
              </div>
              <button onClick={() => setShowPicker(false)}
                className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-[#f5f5f3] text-[#6b6b66] text-[18px] leading-none">×</button>
            </div>

            {/* Upload area inside modal */}
            <div className="px-5 py-3 border-b border-[#f0f0ec] bg-[#fafaf9]">
              <button type="button" onClick={() => { setShowPicker(false); fileRef.current?.click() }}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border border-dashed border-[#d4d4d0] rounded-xl text-[12px] text-[#6b6b66] hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Загрузить новое изображение в {folder}/
              </button>
            </div>

            {/* Grid */}
            <div className="flex-1 overflow-y-auto p-4">
              {loadingLib ? (
                <div className="flex items-center justify-center h-32 text-[#9a9a95] text-[13px]">Загрузка...</div>
              ) : libImages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 gap-2">
                  <p className="text-[13px] text-[#9a9a95]">Папка {folder}/ пустая</p>
                  <p className="text-[11px] text-[#b0b0ab]">Загрузите первое изображение через кнопку выше</p>
                </div>
              ) : (
                <div className="grid grid-cols-4 gap-2">
                  {libImages.map(img => (
                    <button key={img.url} type="button"
                      onClick={() => { onChange(img.url); setShowPicker(false) }}
                      title={img.name}
                      className={`relative aspect-square rounded-xl overflow-hidden border-2 transition-all hover:scale-105 ${
                        value === img.url ? 'border-blue-500 shadow-md' : 'border-transparent hover:border-blue-300'
                      }`}>
                      <img src={img.url} alt={img.name} className="w-full h-full object-cover" />
                      {value === img.url && (
                        <div className="absolute inset-0 bg-blue-500/20 flex items-center justify-center">
                          <svg className="w-5 h-5 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                          </svg>
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

          </div>
        </div>
      )}
    </div>
  )
}
