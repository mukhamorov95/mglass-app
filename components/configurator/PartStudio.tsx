'use client'

import { useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { allParts, partProblems } from '@/lib/configurator/parts/registry'
import type { PartSpec } from '@/lib/configurator/parts/types'

const PartStand = dynamic(() => import('./PartStand').then(m => m.PartStand), {
  ssr: false,
  loading: () => <div className="h-[460px] rounded-xl bg-[#eeece8] grid place-items-center text-[13px] text-[#9a9a95]">Загрузка стенда…</div>,
})

const MOUNT_LABEL: Record<string, string> = {
  'glass-face': 'на плоскость полотна',
  'glass-edge': 'на торец полотна',
  'tube': 'обхватывает штангу',
  'tube-end': 'на торец штанги',
  'wall': 'фланцем в стену',
  'free': 'свободная',
}

// Приёмка детали в пять взглядов — тот же список, что в docs/configurator/PART_PIPELINE.md.
// Держим его на экране: деталь принимают глазами, и глаз должен знать, что искать.
const CHECKLIST = [
  ['Монтажник', 'С той ли стороны стоит, сквозная или зажимная, попадает ли в отверстие'],
  ['Конструктор', 'Каждое число сходится с чертежом; зазоры не отрицательные'],
  ['Художник', 'Силуэт узнаётся на фото поставщика; есть фаски, нет «кубика»'],
  ['Сцена', 'Не проваливается в стекло и не висит в воздухе; тень падает куда надо'],
  ['Прайс', 'Артикул совпадает с позицией справочника; половины не считаются дважды'],
]

export function PartStudio() {
  const parts = useMemo(() => allParts(), [])
  const problems = useMemo(() => partProblems(), [])
  const [id, setId] = useState<string>(parts[0]?.id ?? '')
  const [surface, setSurface] = useState(true)
  const part: PartSpec | undefined = parts.find(p => p.id === id)

  return (
    <div className="min-h-screen bg-[#f5f5f3] text-[#111110] p-6">
      <div className="max-w-[1400px] mx-auto space-y-4">
        <div>
          <h1 className="text-[22px] font-semibold">Стенд фурнитуры</h1>
          <p className="text-[13px] text-[#9a9a95] mt-0.5">
            Деталь по паспорту рядом с её чертежом. Здесь она принимается до того, как попадёт в конфигуратор.
          </p>
        </div>

        {problems.rejected.length > 0 && (
          <div className="rounded-xl border border-[#f0d9c4] bg-[#fdf3ec] px-4 py-3 text-[12px] text-[#9a5a2a]">
            <b>Не прошли приёмку и в сцену не попали:</b>
            <ul className="mt-1 space-y-0.5">
              {problems.rejected.map(r => (
                <li key={r.spec.id}>{r.spec.article || r.spec.id} — {r.issues.map(i => `${i.field}: ${i.problem}`).join('; ')}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr_360px] gap-4">
          {/* список деталей */}
          <div className="bg-white border border-[#e4e4e0] rounded-xl p-3 h-fit">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-[#8a8a85] mb-2">Детали</p>
            <div className="space-y-1">
              {parts.map(p => (
                <button key={p.id} onClick={() => setId(p.id)}
                  className={`w-full text-left px-2.5 py-2 rounded-lg text-[13px] ${p.id === id ? 'bg-[#111110] text-white' : 'hover:bg-[#f5f5f3]'}`}>
                  <span className="block font-medium">{p.article}</span>
                  <span className={`block text-[11px] ${p.id === id ? 'text-white/70' : 'text-[#9a9a95]'}`}>{p.label}</span>
                </button>
              ))}
              {parts.length === 0 && <p className="text-[12px] text-[#9a9a95]">Пока ни одного паспорта.</p>}
            </div>
          </div>

          {/* стенд */}
          <div className="space-y-3">
            <div className="bg-white border border-[#e4e4e0] rounded-xl p-3">
              {part
                ? <PartStand spec={part} withSurface={surface} />
                : <div className="h-[460px] grid place-items-center text-[13px] text-[#9a9a95]">Выберите деталь</div>}
              <div className="flex items-center justify-between mt-2">
                <p className="text-[11px] text-[#9a9a95]">
                  Сетка 10 мм · красная линия — поверхность посадки · деталь растёт от неё в +Z
                </p>
                <button onClick={() => setSurface(v => !v)}
                  className="text-[12px] px-2.5 py-1 rounded-lg border border-[#e4e4e0] hover:bg-[#f5f5f3]">
                  {surface ? 'Скрыть поверхность' : 'Показать поверхность'}
                </button>
              </div>
            </div>

            {part?.source?.drawing && (
              <div className="bg-white border border-[#e4e4e0] rounded-xl p-3">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-[#8a8a85] mb-2">Чертёж — источник чисел</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={part.source.drawing} alt={`Чертёж ${part.article}`} className="w-full rounded-lg border border-[#e4e4e0]" />
              </div>
            )}
          </div>

          {/* паспорт */}
          <div className="space-y-3">
            {part && (
              <>
                <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-[#8a8a85] mb-2">Паспорт</p>
                  <Row k="Артикул" v={part.article} />
                  <Row k="Роль в комплекте" v={part.role} />
                  <Row k="Ключ формы" v={part.id} />
                  <Row k="Посадка" v={MOUNT_LABEL[part.mount.on] ?? part.mount.on} />
                  {part.mount.through && <Row k="Сквозная" v="да — две половины, одна позиция" />}
                  {part.mount.glassMm && <Row k="Стекло" v={`${part.mount.glassMm[0]}–${part.mount.glassMm[1]} мм`} />}
                  {part.mount.clamps && <Row k="Обхват штанги" v={`${part.mount.clamps[0]}×${part.mount.clamps[1]} мм`} />}
                  {part.supplier?.url && (
                    <a href={part.supplier.url} target="_blank" rel="noreferrer"
                      className="text-[12px] text-[#4b4b47] underline mt-2 inline-block">{part.supplier.name} ↗</a>
                  )}
                </div>

                <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-[#8a8a85] mb-2">Размеры с чертежа, мм</p>
                  {Object.entries(part.dims).map(([k, v]) => <Row key={k} k={k} v={String(v)} mono />)}
                  {part.source?.note && <p className="text-[11px] text-[#9a9a95] mt-2">{part.source.note}</p>}
                </div>

                <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-[#8a8a85] mb-2">Что проверить глазами</p>
                  <div className="space-y-2">
                    {CHECKLIST.map(([who, what]) => (
                      <div key={who} className="text-[12px]">
                        <span className="font-semibold text-[#111110]">{who}. </span>
                        <span className="text-[#4b4b47]">{what}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="text-[13px] flex justify-between py-1 gap-3">
      <span className="text-[#9a9a95] shrink-0">{k}</span>
      <span className={`text-right ${mono ? 'font-mono' : ''} text-[#111110]`}>{v}</span>
    </div>
  )
}
