'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'

// ─── Data ─────────────────────────────────────────────────────────────────────

const SERIES = [
  {
    id: 'mono',
    name: 'MONO',
    tagline: 'Зеркала без подсветки — минимализм, который говорит сам за себя',
    description: 'Базовые зеркала без подсветки, воплощение простоты и универсальности. Круглые и прямоугольные модели подойдут для любого интерьера, оставаясь актуальными вне времени.',
    lighting: null,
    color: 'slate',
    models: [
      { article: '#0001', name: 'MONO Круг', form: 'circle', materials: ['Silver', 'UltraClear'], thickness: '4 мм', sizes: ['600 мм', '800 мм'], mounting: 'Навесное', orientation: null, lighting_color: null, switch_type: null, frame: false },
      { article: '#0002', name: 'MONO Прямоугольник', form: 'rect', materials: ['Silver', 'UltraClear'], thickness: '4 мм', sizes: ['600 мм', '800 мм'], mounting: 'Навесное', orientation: ['Горизонтально', 'Вертикально'], lighting_color: null, switch_type: null, frame: false },
    ],
  },
  {
    id: 'aura',
    name: 'AURA',
    tagline: 'Подсветка на стену — мягкий свет по периметру, создающий атмосферу уюта',
    description: 'Зеркала с мягкой контурной подсветкой, направленной на стену. Создаёт эффект «ауры» вокруг зеркала, придавая пространству глубину и уют. Идеально для спален, ванных, гардеробных.',
    lighting: 'back',
    color: 'amber',
    models: [
      { article: '#0003', name: 'AURA Круг', form: 'circle', materials: ['Silver', 'UltraClear'], thickness: '4 мм', sizes: ['600 мм', '800 мм'], mounting: 'Навесное', orientation: null, lighting_color: ['Тёплое', 'Нейтральное', 'Холодное'], switch_type: ['Взмах руки', 'Сенсорная кнопка', 'Выключатель'], frame: false },
      { article: '#0004', name: 'AURA Прямоугольник', form: 'rect', materials: ['Silver', 'UltraClear'], thickness: '4 мм', sizes: ['600 мм', '800 мм'], mounting: 'Навесное', orientation: ['Горизонтально', 'Вертикально'], lighting_color: ['Тёплое', 'Нейтральное', 'Холодное'], switch_type: ['Взмах руки', 'Сенсорная кнопка', 'Выключатель'], frame: false },
    ],
  },
  {
    id: 'light',
    name: 'LIGHT',
    tagline: 'Фронтальная подсветка — направлена прямо на лицо',
    description: 'Зеркала с фронтальной подсветкой, идеальной для макияжа, бритья и ухода за собой. Равномерное освещение без теней, точная цветопередача, выбор оттенка света.',
    lighting: 'front',
    color: 'blue',
    models: [
      { article: '#0005', name: 'LIGHT Круг', form: 'circle', materials: ['Silver', 'UltraClear'], thickness: '4 мм', sizes: ['600 мм', '800 мм'], strip_width: '30 мм', strip_offset: '10 мм', mounting: 'Навесное', orientation: null, lighting_color: ['Тёплое', 'Нейтральное', 'Холодное'], switch_type: ['Взмах руки', 'Сенсорная кнопка', 'Выключатель'], frame: false },
      { article: '#0006', name: 'LIGHT Прямоугольник', form: 'rect', materials: ['Silver', 'UltraClear'], thickness: '4 мм', sizes: ['600 мм', '800 мм'], strip_width: '30 мм', strip_offset: '10 мм', mounting: 'Навесное', orientation: ['Горизонтально', 'Вертикально'], lighting_color: ['Тёплое', 'Нейтральное', 'Холодное'], switch_type: ['Взмах руки', 'Сенсорная кнопка', 'Выключатель'], frame: false },
    ],
  },
  {
    id: 'duo',
    name: 'DUO',
    tagline: 'Двойная подсветка — и на стену, и на лицо',
    description: 'Зеркала с двойной подсветкой: атмосферный контурный свет на стену + практичная фронтальная подсветка на лицо. Максимальная функциональность. Эффект салонного ухода дома.',
    lighting: 'dual',
    color: 'emerald',
    models: [
      { article: '#0023', name: 'DUO Круг', form: 'circle', materials: ['Silver', 'UltraClear'], thickness: '4 мм', sizes: ['600 мм', '800 мм'], strip_width: '30 мм', strip_offset: '10 мм', mounting: 'Навесное', orientation: null, lighting_color: ['Тёплое', 'Нейтральное', 'Холодное'], switch_type: ['Взмах руки', 'Сенсорная кнопка', 'Выключатель'], frame: false },
      { article: '#0023', name: 'DUO Прямоугольник', form: 'rect', materials: ['Silver', 'UltraClear'], thickness: '4 мм', sizes: ['600 мм', '800 мм'], strip_width: '30 мм', strip_offset: '10 мм', mounting: 'Навесное', orientation: ['Горизонтально', 'Вертикально'], lighting_color: ['Тёплое', 'Нейтральное', 'Холодное'], switch_type: ['Взмах руки', 'Сенсорная кнопка', 'Выключатель'], frame: false },
    ],
  },
  {
    id: 'frame',
    name: 'FRAME',
    tagline: 'В металлической раме — чёрный или белый',
    description: 'Все серии доступны с металлической рамой. Тонкий прочный металл с порошковым термостойким покрытием — устойчив к влаге и перепадам температур. Окраска по каталогу RAL под запрос.',
    lighting: null,
    color: 'zinc',
    models: [
      { article: 'FRAME', name: 'Металлическая рама', form: 'any', materials: ['Металл 2 мм'], frame_width: '40 мм', frame_colors: ['Чёрный', 'Белый', 'RAL по запросу'], mounting: 'Навесное', orientation: null, lighting_color: null, switch_type: null, frame: true },
    ],
  },
]

const TECH_INFO = {
  materials: [
    { name: 'Silver', desc: 'Стандартное зеркало с лёгким зеленоватым оттенком — обусловлен содержанием железа в стекле. Подходит для большинства интерьеров.', badge: 'Стандарт', badgeColor: 'bg-slate-100 text-slate-700' },
    { name: 'UltraClear', desc: 'Осветлённое стекло с пониженным содержанием железа. Не искажает цвет. Кристально чистое отражение — идеально для подсветки и светлых интерьеров.', badge: 'Premium', badgeColor: 'bg-amber-100 text-amber-700' },
  ],
  mounting: ['Вертикальное и/или горизонтальное расположение', 'Скрытые навесы', 'Устойчивое фиксирование на стене', 'Индивидуальные решения по запросу'],
  guarantee: ['Зеркальное полотно', 'Подсветка и комплектующие', 'Целостность рамы и креплений'],
  care: ['Протирать мягкой тканью без абразивов', 'Использовать специальное средство для стекла', 'Не использовать кислоты и агрессивную химию', 'Шлифованные безопасные края', 'При защитной плёнке — стекло не рассыпается на осколки', 'Порошковое покрытие рам устойчиво к влаге и температуре'],
}

const COLOR_MAP: Record<string, string> = {
  slate: 'border-slate-200 bg-slate-50', amber: 'border-amber-200 bg-amber-50',
  blue: 'border-blue-200 bg-blue-50', emerald: 'border-emerald-200 bg-emerald-50',
  violet: 'border-violet-200 bg-violet-50', zinc: 'border-zinc-200 bg-zinc-50',
}
const BADGE_MAP: Record<string, string> = {
  slate: 'bg-slate-200 text-slate-800', amber: 'bg-amber-200 text-amber-800',
  blue: 'bg-blue-200 text-blue-800', emerald: 'bg-emerald-200 text-emerald-800',
  violet: 'bg-violet-200 text-violet-800', zinc: 'bg-zinc-200 text-zinc-800',
}
const LIGHTING_ICON: Record<string, string> = {
  back: '✦ Подсветка на стену', front: '◉ Фронтальная подсветка', dual: '✦◉ Двойная подсветка',
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function MirrorShape({ form }: { form: string }) {
  if (form === 'circle') return <div className="w-14 h-14 rounded-full border-2 border-current opacity-30" />
  if (form === 'rect') return <div className="w-10 h-14 rounded border-2 border-current opacity-30" />
  return <div className="w-10 h-10 rounded border-2 border-current opacity-30 flex items-center justify-center text-[10px]">Any</div>
}

type Model = {
  article: string; name: string; form: string; materials: string[]; thickness?: string
  sizes?: string[]; strip_width?: string; strip_offset?: string; frame_width?: string
  frame_colors?: string[]; mounting: string; orientation: string[] | null
  lighting_color: string[] | null; switch_type: string[] | null; frame: boolean
}

function ModelCard({ model, color }: { model: Model; color: string }) {
  const rows: [string, string][] = []
  if (model.materials?.length)     rows.push(['Материал', model.materials.join(', ')])
  if (model.thickness)              rows.push(['Толщина', model.thickness])
  if (model.sizes?.length)         rows.push(['Размеры', model.sizes.join(' / ')])
  if (model.strip_width)           rows.push(['Ширина полоски', model.strip_width])
  if (model.strip_offset)          rows.push(['Отступ от края', model.strip_offset])
  if (model.frame_width)           rows.push(['Ширина рамки', model.frame_width])
  if (model.frame_colors?.length)  rows.push(['Цвета рамы', model.frame_colors.join(', ')])
  if (model.orientation?.length)   rows.push(['Расположение', model.orientation.join(' / ')])
  rows.push(['Крепление', model.mounting])
  if (model.lighting_color?.length) rows.push(['Свечение', model.lighting_color.join(' · ')])
  if (model.switch_type?.length)   rows.push(['Включение', model.switch_type.join(' / ')])

  return (
    <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
      <div className="flex items-start gap-4 mb-4">
        <div className={`text-${color}-400`}><MirrorShape form={model.form} /></div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-[14px] font-bold text-[#111110]">{model.name}</p>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${BADGE_MAP[color]}`}>{model.article}</span>
          </div>
        </div>
      </div>
      <div className="space-y-1.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 text-[12px]">
            <span className="text-[#8a8a85]">{k}</span>
            <span className="text-[#111110] font-medium text-right">{v}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Image upload per series ───────────────────────────────────────────────────

const BUCKET = 'catalog'

function SeriesImage({
  seriesId,
  imageUrl,
  onUploaded,
}: {
  seriesId: string
  imageUrl: string | null
  onUploaded: (url: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [imgError, setImgError] = useState(false)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    const supabase = createClient()
    const ext = file.name.split('.').pop() ?? 'jpg'
    const path = `series-${seriesId}.${ext}`
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true })
    if (!error) {
      const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
      onUploaded(data.publicUrl + '?t=' + Date.now())
      setImgError(false)
    }
    setUploading(false)
    e.target.value = ''
  }

  const hasImage = imageUrl && !imgError

  return (
    <div className="flex-shrink-0 relative">
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />

      {hasImage ? (
        <div className="relative w-40 h-40 rounded-xl overflow-hidden border border-[#e4e4e0] group">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt=""
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
          />
          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[12px] font-medium"
          >
            {uploading ? '...' : '✎ Заменить'}
          </button>
        </div>
      ) : (
        <button
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="w-40 h-40 rounded-xl border-2 border-dashed border-[#d0d0cc] hover:border-[#9a9a95] hover:bg-white/60 transition-all flex flex-col items-center justify-center gap-2 text-[#9a9a95] hover:text-[#6b6b66]"
        >
          {uploading ? (
            <span className="text-[12px]">Загрузка...</span>
          ) : (
            <>
              <span className="text-2xl">📷</span>
              <span className="text-[11px] font-medium text-center leading-tight px-2">Добавить<br/>фото серии</span>
            </>
          )}
        </button>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CatalogPage() {
  const [activeTab, setActiveTab] = useState<'series' | 'tech'>('series')
  const [activeSeries, setActiveSeries] = useState<string | null>(null)
  const [images, setImages] = useState<Record<string, string>>({})

  const loadImages = useCallback(async () => {
    const supabase = createClient()
    const { data: files } = await supabase.storage.from(BUCKET).list('', { limit: 100 })
    if (!files) return
    const urls: Record<string, string> = {}
    for (const file of files) {
      const match = file.name.match(/^series-(\w+)\.\w+$/)
      if (!match) continue
      const seriesId = match[1]
      const { data } = supabase.storage.from(BUCKET).getPublicUrl(file.name)
      urls[seriesId] = data.publicUrl
    }
    setImages(urls)
  }, [])

  useEffect(() => { loadImages() }, [loadImages])

  const displayedSeries = activeSeries ? SERIES.filter(s => s.id === activeSeries) : SERIES

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <div className="mb-6">
        <p className="text-[11px] font-bold text-[#9a9a95] uppercase tracking-wider mb-1">Product Line</p>
        <h1 className="text-[22px] font-bold text-[#111110] tracking-tight">Каталог зеркал 2025</h1>
        <p className="text-[13px] text-[#6b6b66] mt-1">5 серий · 8 моделей · Silver & UltraClear · Гарантия 12 месяцев</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-[#f5f5f0] rounded-xl p-1 w-fit">
        {([['series', '🪞 Серии и модели'], ['tech', '📋 Тех. информация']] as const).map(([t, l]) => (
          <button key={t} onClick={() => setActiveTab(t)}
            className={`px-4 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${activeTab === t ? 'bg-white text-[#111110] shadow-sm' : 'text-[#6b6b66] hover:text-[#111110]'}`}>
            {l}
          </button>
        ))}
      </div>

      {activeTab === 'series' && (
        <>
          {/* Series filter */}
          <div className="flex gap-2 flex-wrap mb-6">
            <button onClick={() => setActiveSeries(null)}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors ${!activeSeries ? 'bg-[#111110] text-white' : 'bg-[#f5f5f0] text-[#6b6b66] hover:bg-[#eeeeea]'}`}>
              Все серии
            </button>
            {SERIES.map(s => (
              <button key={s.id} onClick={() => setActiveSeries(activeSeries === s.id ? null : s.id)}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors ${activeSeries === s.id ? 'bg-[#111110] text-white' : 'bg-[#f5f5f0] text-[#6b6b66] hover:bg-[#eeeeea]'}`}>
                {s.name}
              </button>
            ))}
          </div>

          <div className="space-y-8">
            {displayedSeries.map(series => (
              <div key={series.id} className={`border rounded-2xl p-6 ${COLOR_MAP[series.color]}`}>
                {/* Series header with photo */}
                <div className="flex items-start gap-6 mb-5">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <h2 className="text-[24px] font-black text-[#111110] tracking-tight">{series.name}</h2>
                      <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${BADGE_MAP[series.color]}`}>
                        {series.models.length} {series.models.length === 1 ? 'модель' : 'модели'}
                      </span>
                      {series.lighting && (
                        <span className="text-[11px] text-[#6b6b66] font-medium">{LIGHTING_ICON[series.lighting]}</span>
                      )}
                    </div>
                    <p className="text-[13px] text-[#6b6b66] italic mb-2">{series.tagline}</p>
                    <p className="text-[12px] text-[#8a8a85] leading-relaxed">{series.description}</p>
                  </div>

                  <SeriesImage
                    seriesId={series.id}
                    imageUrl={images[series.id] ?? null}
                    onUploaded={url => setImages(prev => ({ ...prev, [series.id]: url }))}
                  />
                </div>

                {/* Models */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {series.models.map((model, i) => (
                    <ModelCard key={i} model={model as Model} color={series.color} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {activeTab === 'tech' && (
        <div className="space-y-6">
          <div className="bg-white border border-[#e4e4e0] rounded-2xl p-6">
            <h3 className="text-[16px] font-bold text-[#111110] mb-4">Типы зеркального полотна</h3>
            <div className="grid grid-cols-2 gap-4">
              {TECH_INFO.materials.map(m => (
                <div key={m.name} className="border border-[#e4e4e0] rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <p className="text-[15px] font-bold text-[#111110]">{m.name}</p>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${m.badgeColor}`}>{m.badge}</span>
                  </div>
                  <p className="text-[12px] text-[#6b6b66] leading-relaxed">{m.desc}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white border border-[#e4e4e0] rounded-2xl p-6">
            <h3 className="text-[16px] font-bold text-[#111110] mb-4">Система крепления</h3>
            <div className="space-y-2">
              {TECH_INFO.mounting.map(item => (
                <div key={item} className="flex gap-3 items-start">
                  <div className="w-4 h-px bg-[#111110] mt-[10px] flex-shrink-0" />
                  <p className="text-[13px] text-[#6b6b66]">{item}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white border border-[#e4e4e0] rounded-2xl p-6">
              <h3 className="text-[16px] font-bold text-[#111110] mb-1">Гарантия 12 месяцев</h3>
              <p className="text-[11px] text-[#8a8a85] mb-4">Гарантия распространяется на:</p>
              <div className="space-y-2">
                {TECH_INFO.guarantee.map(item => (
                  <div key={item} className="flex gap-3 items-start">
                    <div className="w-4 h-px bg-[#111110] mt-[10px] flex-shrink-0" />
                    <p className="text-[13px] font-medium text-[#111110]">{item}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 p-3 bg-[#fafaf8] rounded-xl text-[11px] text-[#6b6b66] leading-relaxed">
                Предлагаем постгарантийное обслуживание и замену комплектующих.
              </div>
            </div>

            <div className="bg-white border border-[#e4e4e0] rounded-2xl p-6">
              <h3 className="text-[16px] font-bold text-[#111110] mb-1">Уход и безопасность</h3>
              <p className="text-[11px] text-[#8a8a85] mb-4">Зеркала защищены от влаги, пригодны для ванных</p>
              <div className="space-y-2">
                {TECH_INFO.care.map(item => (
                  <div key={item} className="flex gap-3 items-start">
                    <div className="w-4 h-px bg-[#111110] mt-[10px] flex-shrink-0" />
                    <p className="text-[13px] text-[#6b6b66]">{item}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
