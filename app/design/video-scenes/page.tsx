'use client'

// Сцены для обучающих роликов: настоящие компоненты приложения на ВЫМЫШЛЕННЫХ
// данных. Путь /design/ открыт без входа (whitelist middleware) — поэтому кадры
// для видео снимаются автоматически, не заходя под чужой учётной записью
// и не показывая в ролике реальных клиентов и цены.
//
// Открывается как /design/video-scenes?scene=treatments

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { TreatToggle } from '@/app/calculator/b2b/TreatToggle'
import { normalizeHoles, holesLabel, totalHoles } from '@/lib/production/holes'

type SceneKey = 'material' | 'treatments' | 'holes' | 'item' | 'queue'

export default function VideoScenes() {
  return <Suspense fallback={null}><Scenes /></Suspense>
}

function Scenes() {
  // Сцену берём из адреса штатным хуком: setState в эффекте даёт лишний рендер
  // и первый кадр не той сцены — при съёмке это попадёт в ролик.
  const scene = (useSearchParams().get('scene') as SceneKey | null) ?? 'treatments'

  return (
    <div className="min-h-screen bg-[#f8f8f7] flex items-center justify-center p-8">
      <div className="w-full max-w-[560px]">{RENDER[scene] ?? RENDER.treatments}</div>
    </div>
  )
}

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div><label className="block text-[13px] font-medium text-[#6e6e73] mb-1">{label}</label>{children}</div>
)
const Box = ({ children }: { children: React.ReactNode }) => (
  <div className="bg-white rounded-xl border border-[#e4e4e0] p-4 space-y-3 shadow-sm">{children}</div>
)
const Input = ({ v, suf }: { v: string; suf?: string }) => (
  <div className="flex items-center gap-1 border border-[#e4e4e0] rounded-lg px-3 min-h-[44px] bg-white">
    <span className="text-[14px] text-[#111110]">{v}</span>
    {suf && <span className="text-[12px] text-[#9a9a95] ml-auto">{suf}</span>}
  </div>
)

const HOLES = [{ d: 12, n: 4 }, { d: 20, n: 2 }]

const Treatments = ({ holesOn }: { holesOn: boolean }) => (
  <div className="rounded-xl border border-[#e4e4e0] bg-[#fbfbfa] p-3 space-y-2.5">
    <div className="flex items-baseline justify-between gap-2 flex-wrap">
      <p className="text-[13px] font-semibold text-[#111110]">Обработка</p>
      <p className="text-[11px] text-[#9a9a95]">определяет маршрут в цеху</p>
    </div>
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      <TreatToggle on={true}  onChange={() => {}} label="Закалка"      tone="orange" />
      <TreatToggle on={false} onChange={() => {}} label="Фацет"        tone="purple" />
      <TreatToggle on={false} onChange={() => {}} label="Криволинейка" tone="teal" />
      <TreatToggle on={false} onChange={() => {}} label="Песочка"      tone="violet" />
      <TreatToggle on={false} onChange={() => {}} label="Триплекс"     tone="indigo" />
    </div>
    <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-2.5 space-y-2">
      <p className="text-[11px] font-medium text-blue-900">Сверловка · одна станция</p>
      <div className="grid grid-cols-2 gap-2">
        <TreatToggle on={holesOn} onChange={() => {}} label="Отверстия" tone="blue" />
        <label className="flex items-center gap-2 min-h-[44px] px-2.5 py-1.5 border rounded-lg border-blue-300 bg-blue-50">
          <span className="text-[13px] text-[#111110]">2</span>
          <span className="text-[13px] leading-tight min-w-0 text-blue-700 font-semibold">Вырезы</span>
        </label>
      </div>
      {holesOn && (
        <div className="rounded-lg border border-blue-200 bg-white p-2.5">
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="text-[12px] font-medium text-blue-900">Отверстия · всего {totalHoles(normalizeHoles(HOLES))}</p>
            <span className="text-[12px] px-2.5 py-1.5 rounded-lg border border-blue-300 text-blue-800">+ группа</span>
          </div>
          <div className="space-y-1.5">
            {HOLES.map((g, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="w-16 border border-[#e4e4e0] rounded-lg px-2 min-h-[40px] flex items-center text-[13px]">{g.n}</div>
                <span className="text-[12px] text-[#6b6b66] whitespace-nowrap">шт · ⌀</span>
                <div className="w-20 border border-[#e4e4e0] rounded-lg px-2 min-h-[40px] flex items-center text-[13px]">{g.d}</div>
                <span className="text-[12px] text-[#6b6b66] whitespace-nowrap">мм</span>
                <span className="ml-auto text-[12px] text-[#9a9a95] px-2 py-1.5">удалить</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  </div>
)

const RENDER: Record<SceneKey, React.ReactNode> = {
  material: (
    <Box>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Толщина"><Input v="8" suf="мм" /></Field>
        <Field label="Тип"><Input v="Прозрачное М1" /></Field>
      </div>
      <Field label="Размеры и количество">
        <div className="grid grid-cols-3 gap-2">
          <Input v="900" suf="мм" /><Input v="2000" suf="мм" /><Input v="2" suf="шт" />
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Отход"><div className="border border-[#e4e4e0] rounded-lg px-3 min-h-[44px] flex items-center text-[12px] text-[#6e6e73] bg-[#f8f8f7]">авто по раскрою</div></Field>
        <Field label="Минимальная цена"><TreatToggle on={true} onChange={() => {}} label="Учитывать" tone="indigo" /></Field>
      </div>
    </Box>
  ),
  treatments: <Box><Treatments holesOn={false} /></Box>,
  holes:      <Box><Treatments holesOn={true} /></Box>,
  item: (
    <Box>
      <p className="text-[13px] font-semibold text-[#111110]">Позиции просчёта</p>
      <div className="border border-[#e4e4e0] rounded-lg divide-y divide-[#f0f0ec]">
        {[
          { n: 1, s: '900×2000 · Прозрачное М1 8мм · 2 шт', f: `закалка · отверстия ${holesLabel(HOLES)} · вырезы 2`, p: '18 400 ₽' },
          { n: 2, s: '600×1800 · Осветлённое 6мм', f: 'закалка', p: '7 250 ₽' },
        ].map(r => (
          <div key={r.n} className="px-3 py-2.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[12px] font-mono text-[#111110]">Поз. {r.n} · {r.s}</p>
                <p className="text-[11px] text-violet-700 mt-0.5">{r.f}</p>
              </div>
              <p className="text-[13px] font-semibold text-[#111110] tabular-nums">{r.p}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="flex justify-between items-center pt-1">
        <span className="text-[12px] text-[#9a9a95]">Итого</span>
        <span className="text-[17px] font-bold text-[#111110] tabular-nums">25 650 ₽</span>
      </div>
    </Box>
  ),
  queue: (
    <Box>
      <div className="flex items-center justify-between">
        <p className="text-[15px] font-bold font-mono text-[#111110]">05412</p>
        <span className="text-[11px] text-[#9a9a95]">2 дет. · срок 12.09</span>
      </div>
      <p className="text-[13px] text-[#6b6b66]">ИП Пример</p>
      <div className="rounded-lg border border-[#eceff1] px-3 py-2">
        <p className="text-[12px] font-mono text-[#111110]">900×2000 · Прозрачное М1 8мм · 2 шт</p>
        <p className="text-[11px] text-[#6b6b66] mt-0.5"><span className="text-violet-700">отверстия {holesLabel(HOLES)} · вырезы 2 · закалка</span></p>
        <div className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-1">
          {['Резка', 'Полировка', 'Сверление', 'Закалка', 'Упаковка'].map((st, i) => (
            <span key={st} className="flex items-center gap-1">
              <span className={`px-1.5 py-0.5 rounded text-[10px] whitespace-nowrap ${i < 2 ? 'bg-emerald-50 text-emerald-700' : i === 2 ? 'bg-white text-[#111110] border border-[#111110] font-semibold' : 'bg-white text-[#9a9a95] border border-[#e4e4e0]'}`}>
                {i < 2 ? '✓ ' : ''}{st}
              </span>
              {i < 4 && <span className="text-[9px] text-[#d4d4d0]">→</span>}
            </span>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-[11px] text-[#111110]">Сверление</span>
          <div className="flex gap-1.5">
            <span className="px-2.5 py-2.5 rounded-lg border border-[#e4e4e0] text-[#6b6b66] text-[12px] font-medium">Взял</span>
            <span className="px-3.5 py-2.5 rounded-lg bg-emerald-600 text-white text-[12px] font-medium">Готово</span>
          </div>
        </div>
      </div>
    </Box>
  ),
}
