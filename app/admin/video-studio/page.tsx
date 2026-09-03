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

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { drawSlide, drawShotSlide, W, H, type Slide } from '@/lib/video/slides'

type Manifest = { id: string; seconds: number }[]

export default function VideoStudioPage() {
  return <Suspense fallback={null}><Studio /></Suspense>
}

function Studio() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const params = useSearchParams()
  const [name, setName]       = useState(params.get('name') ?? 'calc-whats-new')
  const auto = params.get('auto') === '1'
  const [slides, setSlides]   = useState<Slide[]>([])
  const [manifest, setManifest] = useState<Manifest>([])
  const [state, setState]     = useState<'idle' | 'loading' | 'ready' | 'recording' | 'done'>('idle')
  const [note, setNote]       = useState('')
  const [url, setUrl]         = useState<string | null>(null)
  const [cur, setCur]         = useState(0)
  // Снимки грузим ДО записи: подгрузка в кадре дала бы чёрный экран на секунду.
  const shots = useRef<Map<string, HTMLImageElement>>(new Map())
  // Снимки можно не класть в репозиторий, а выбрать прямо здесь: живут в памяти
  // вкладки до записи. Экраны за логином снять автоматически нельзя — заходить
  // под чужой учётной записью мы не будем, — а владелец делает снимок за секунду.
  const [picked, setPicked] = useState<Record<string, string>>({})
  // Автоматический режим: /admin/video-studio?name=X&auto=1 — грузит, пишет и
  // сохраняет файл без единого нажатия. Нужен, чтобы ролик собирался целиком
  // без человека: раньше конвейер обрывался на кнопке «Скачать».
  const started = useRef(false)

  const load = useCallback(async () => {
    setState('loading'); setNote(''); setUrl(null)
    try {
      const [sc, mf] = await Promise.all([
        fetch(`/api/video-studio/script?name=${encodeURIComponent(name)}`).then(r => r.json()),
        fetch(`/narration/${name}/manifest.json`).then(r => r.json()),
      ])
      if (!Array.isArray(sc) || !Array.isArray(mf)) throw new Error('сценарий или озвучка не найдены')
      // Предзагрузка снимков — без неё первый кадр слайда уходит в чёрное.
      await Promise.all((sc as Slide[]).filter(x => x.shot).map(x => new Promise<void>(res => {
        const im = new Image()
        im.onload = () => { shots.current.set(x.shot!, im); res() }
        im.onerror = () => res()
        im.src = x.shot!
      })))
      setSlides(sc); setManifest(mf); setState('ready')
      setNote(`${sc.length} слайдов · ${mf.reduce((a: number, b: { seconds: number }) => a + b.seconds, 0).toFixed(1)} с озвучки`)
    } catch (e) {
      setState('idle'); setNote(e instanceof Error ? e.message : 'не загрузилось')
    }
  }, [name])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load().catch(() => {}) }, [load])

  // Автозапуск ровно один раз: слайды загрузились — пишем.
  useEffect(() => {
    if (!auto || state !== 'ready' || started.current) return
    started.current = true
    record().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, state])

  // Какой снимок показывать: выбранный руками важнее лежащего в репозитории.
  const shotFor = useCallback((sl: Slide) =>
    shots.current.get(`local:${sl.id}`) ?? (sl.shot ? shots.current.get(sl.shot) : undefined), [])

  // Предпросмотр первого слайда, чтобы было видно, что получится.
  useEffect(() => {
    const c = canvasRef.current
    if (!c || slides.length === 0 || state === 'recording') return
    const ctx = c.getContext('2d')
    if (!ctx) return
    const sl = slides[Math.min(cur, slides.length - 1)]
    const img = shotFor(sl)
    if (img) drawShotSlide(ctx, sl, img, cur, slides.length, 0.3)
    else drawSlide(ctx, sl, cur, slides.length, 0)
  }, [slides, cur, state, picked, shotFor])

  function attachShot(slideId: string, file: File) {
    const url = URL.createObjectURL(file)
    const im = new Image()
    im.onload = () => {
      shots.current.set(`local:${slideId}`, im)
      setPicked(p => ({ ...p, [slideId]: url }))
    }
    im.src = url
  }

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
          const img = shotFor(slides[i])
          if (img) drawShotSlide(ctx, slides[i], img, i, slides.length, p)
          else drawSlide(ctx, slides[i], i, slides.length, p)
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

    // В автоматическом режиме сразу кладём файл на диск — иначе запись останется
    // в памяти вкладки и пропадёт вместе с ней.
    if (auto) {
      const r = await fetch(`/api/video-studio/save?name=${encodeURIComponent(name)}`, {
        method: 'POST', headers: { 'Content-Type': 'video/webm' }, body: blob,
      }).then(x => x.json()).catch(() => null)
      setNote(r?.ok ? `сохранено: ${r.path} · ${(r.bytes / 1024 / 1024).toFixed(1)} МБ` : 'запись есть, сохранить не удалось')
      ;(globalThis as unknown as Record<string, unknown>).__videoDone = r ?? { ok: false }
    }
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

        {state === 'ready' && slides.some(s2 => s2.shot) && (
          <div className="rounded-xl border border-[#e4e4e0] bg-white p-3">
            <p className="text-[13px] font-semibold text-[#111110] mb-1">Снимки экранов</p>
            <p className="text-[12px] text-[#9a9a95] mb-2.5">
              Сделай скриншот нужного экрана и выбери его здесь. Файлы никуда не загружаются — живут
              в этой вкладке до записи.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {slides.filter(s2 => s2.shot).map(s2 => (
                <label key={s2.id}
                  className={`cursor-pointer rounded-lg border px-3 py-2.5 text-[12px] transition-colors ${
                    picked[s2.id] ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-[#e4e4e0] hover:border-[#111110] text-[#6b6b66]'}`}>
                  <span className="block font-medium">{picked[s2.id] ? '✓ ' : ''}{s2.title}</span>
                  <span className="block text-[11px] text-[#9a9a95] mt-0.5">
                    {picked[s2.id] ? 'снимок выбран' : 'выбрать снимок'}
                  </span>
                  <input type="file" accept="image/png,image/jpeg" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) attachShot(s2.id, f); e.target.value = '' }} />
                </label>
              ))}
            </div>
          </div>
        )}

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
