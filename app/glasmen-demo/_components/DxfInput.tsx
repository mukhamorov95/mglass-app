'use client'

import { useRef, useState } from 'react'

const MAX_BYTES = 5 * 1024 * 1024

export const SAMPLES = [
  { file: 'shelf-600x250-holes.dxf', title: 'Полка 600×250, 2 отверстия' },
  { file: 'shower-door-800x2000-hinges.dxf', title: 'Дверь душевой 800×2000, петли' },
  { file: 'splashback-2000x600-sockets.dxf', title: 'Фартук 2000×600, розетки' },
  { file: 'round-mirror-d600.dxf', title: 'Зеркало Ø600' },
]

export default function DxfInput({ fileName, onLoaded }: { fileName: string | null; onLoaded: (text: string, name: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const readFile = async (f: File) => {
    setError(null)
    if (!/\.dxf$/i.test(f.name)) return setError(`«${f.name}» — не DXF. Нужен файл .dxf`)
    if (f.size > MAX_BYTES) return setError(`«${f.name}» весит ${(f.size / 1024 / 1024).toFixed(1).replace('.', ',')} МБ — больше 5 МБ`)
    setBusy(true)
    try {
      onLoaded(await f.text(), f.name)
    } catch {
      setError(`Не удалось прочитать «${f.name}»`)
    } finally {
      setBusy(false)
    }
  }

  const loadSample = async (file: string) => {
    setError(null)
    setBusy(true)
    try {
      const r = await fetch(`/glasmen-demo/samples/${file}`)
      if (!r.ok) throw new Error(`сервер ответил ${r.status}`)
      onLoaded(await r.text(), file)
    } catch (e) {
      setError(`Пример «${file}» не загрузился: ${e instanceof Error ? e.message : 'нет связи'}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div
        onDragOver={e => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={e => {
          e.preventDefault()
          setOver(false)
          const f = e.dataTransfer.files?.[0]
          if (f) void readFile(f)
        }}
        className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-6 text-center transition ${over ? 'border-[#111110] bg-[#f5f5f3]' : 'border-[#e4e4e0] bg-white'}`}
      >
        <div className="text-[14px] font-medium">Перетащите DXF сюда</div>
        <div className="mt-1 text-[12px] text-[#9a9a95]">ASCII DXF, мм, см, м или дюймы, до 5 МБ</div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="mt-3 rounded-lg bg-[#111110] px-4 py-2 text-[13px] font-medium text-white hover:bg-black disabled:opacity-50"
        >
          {busy ? 'Читаю…' : 'Выбрать файл'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".dxf"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void readFile(f)
          }}
        />
        {fileName && <div className="mt-2 max-w-full truncate text-[12px] text-[#55554f]">Загружен: {fileName}</div>}
      </div>
      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800">{error}</p>}
      <div>
        <div className="text-[12px] text-[#9a9a95]">Или пример:</div>
        <div className="mt-1 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {SAMPLES.map(s => (
            <button
              key={s.file}
              type="button"
              disabled={busy}
              onClick={() => void loadSample(s.file)}
              className="rounded-lg border border-[#e4e4e0] bg-white px-3 py-2 text-left text-[12px] hover:border-[#9a9a95] disabled:opacity-50"
            >
              {s.title}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
