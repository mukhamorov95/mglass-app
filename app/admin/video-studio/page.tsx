'use client'

// Видеостудия: сценарий + озвучка → готовый видеофайл.
//
// Собирает ролик прямо в браузере: рисует слайды на canvas, играет заранее
// синтезированную озвучку и пишет всё это MediaRecorder'ом в webm. Внешних
// сервисов не требует.
//
// Почему не ffmpeg: его на машине нет, brew тоже, а ставить сторонние сборки
// ради обучающих роликов — лишний риск. Браузер умеет то же самое.
// Почему озвучка заранее, а не голосом браузера: SpeechSynthesis играет мимо
// звукового графа, и MediaRecorder его не слышит — вышло бы немое видео.
// Файлы делает scripts/narrate.mjs голосом macOS.

import { useCallback, useEffect, useRef, useState } from 'react'
import { drawSlide, W, H, type Slide } from '@/lib/video/slides'

type Manifest = { id: string; seconds: number }[]

export default function VideoStudioPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [name, setName]       = useState('calc-whats-new')
  const [slides, setSlides]   = useState<Slide[]>([])
  const [manifest, setManifest] = useState<Manifest>([])
  const [state, setState]     = useState<'idle' | 'loading' | 'ready' | 'recording' | 'done'>('idle')
  const [note, setNote]       = useState('')
  const [url, setUrl]         = useState<string | null>(null)
  const [cur, setCur]         = useState(0)

  const load = useCallback(async () => {
    setState('loading'); setNote(''); setUrl(null)
    try {
      const [sc, mf] = await Promise.all([
        fetch(`/api/video-studio/script?name=${encodeURIComponent(name)}`).then(r => r.json()),
        fetch(`/narration/${name}/manifest.json`).then(r => r.json()),
      ])
      if (!Array.isArray(sc) || !Array.isArray(mf)) throw new Error('сценарий или озвучка не найдены')
      setSlides(sc); setManifest(mf); setState('ready')
      setNote(`${sc.length} слайдов · ${mf.reduce((a: number, b: { seconds: number }) => a + b.seconds, 0).toFixed(1)} с озвучки`)
    } catch (e) {
      setState('idle'); setNote(e instanceof Error ? e.message : 'не загрузилось')
    }
  }, [name])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load().catch(() => {}) }, [load])

  // Предпросмотр первого слайда, чтобы было видно, что получится.
  useEffect(() => {
    const c = canvasRef.current
    if (!c || slides.length === 0 || state === 'recording') return
    const ctx = c.getContext('2d')
    if (ctx) drawSlide(ctx, slides[Math.min(cur, slides.length - 1)], cur, slides.length, 0)
  }, [slides, cur, state])

  async function record() {
    const c = canvasRef.current
    if (!c || slides.length === 0) return
    const ctx = c.getContext('2d')!
    setState('recording'); setUrl(null); setNote('идёт запись — не переключайте вкладку')

    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ac = new AudioCtx()
    const dest = ac.createMediaStreamDestination()

    const stream = new MediaStream([
      ...c.captureStream(30).getVideoTracks(),
      ...dest.stream.getAudioTracks(),
    ])
    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
      ? 'video/webm;codecs=vp9,opus' : 'video/webm'
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 })
    const chunks: BlobPart[] = []
    rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
    rec.start()

    for (let i = 0; i < slides.length; i++) {
      setCur(i)
      const audio = new Audio(`/narration/${name}/${slides[i].id}.m4a`)
      audio.crossOrigin = 'anonymous'
      const src = ac.createMediaElementSource(audio)
      src.connect(dest)          // в запись
      src.connect(ac.destination) // и в колонки, чтобы слышать ход
      const secs = manifest.find(m => m.id === slides[i].id)?.seconds ?? 5
      const started = performance.now()
      await audio.play().catch(() => {})
      await new Promise<void>(resolve => {
        const tick = () => {
          const p = Math.min(1, (performance.now() - started) / (secs * 1000))
          drawSlide(ctx, slides[i], i, slides.length, p)
          if (p >= 1) { resolve(); return }
          requestAnimationFrame(tick)
        }
        tick()
      })
      // Пауза между слайдами: без неё фразы наезжают друг на друга.
      await new Promise(r => setTimeout(r, 400))
    }

    rec.stop()
    await new Promise(r => { rec.onstop = r })
    await ac.close()
    const blob = new Blob(chunks, { type: 'video/webm' })
    setUrl(URL.createObjectURL(blob))
    setState('done')
    setNote(`готово · ${(blob.size / 1024 / 1024).toFixed(1)} МБ`)
  }

  return (
    <div className="min-h-screen bg-[#f8f8f7] p-6">
      <div className="max-w-4xl mx-auto space-y-4">
        <div>
          <h1 className="text-[22px] font-bold text-[#111110] tracking-tight">Видеостудия</h1>
          <p className="text-[13px] text-[#9a9a95] mt-0.5">
            Сценарий и озвучка собираются в готовый файл прямо здесь. Озвучку делает <code className="text-[12px]">scripts/narrate.mjs</code>.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <input value={name} onChange={e => setName(e.target.value)}
            className="border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] bg-white w-64 outline-none focus:border-[#111110]"
            placeholder="имя ролика" />
          <button onClick={() => load()} disabled={state === 'recording'}
            className="px-3 py-2 rounded-lg border border-[#e4e4e0] text-[13px] hover:border-[#111110] disabled:opacity-40">Загрузить</button>
          <button onClick={record} disabled={state !== 'ready' && state !== 'done'}
            className="px-4 py-2 rounded-lg bg-[#111110] text-white text-[13px] font-semibold hover:bg-black disabled:opacity-40">
            {state === 'recording' ? 'Пишу…' : '⏺ Записать'}
          </button>
          {url && (
            <a href={url} download={`${name}.webm`}
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-[13px] font-semibold hover:opacity-90">↓ Скачать</a>
          )}
          {note && <span className="text-[12px] text-[#6b6b66]">{note}</span>}
        </div>

        <canvas ref={canvasRef} width={W} height={H}
          className="w-full rounded-xl border border-[#e4e4e0] bg-white shadow-sm" />

        {state === 'ready' && slides.length > 0 && (
          <div className="flex gap-1.5 flex-wrap">
            {slides.map((s, i) => (
              <button key={s.id} onClick={() => setCur(i)}
                className={`px-2.5 py-1.5 rounded-lg text-[12px] border ${i === cur ? 'bg-[#111110] text-white border-[#111110]' : 'border-[#e4e4e0] text-[#6b6b66] hover:border-[#111110]'}`}>
                {i + 1}
              </button>
            ))}
          </div>
        )}

        {url && <video src={url} controls className="w-full rounded-xl border border-[#e4e4e0]" />}
      </div>
    </div>
  )
}
