import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import { mskDate } from '@/lib/time'

// Конвейер роликов. Задание живёт по стадиям, и на каждой видно, чего оно ждёт.
//
// Стадии — это не абстрактный канбан, а реальный порядок производства из
// регламента: кадры → анимация → озвучка → монтаж → субтитры → обложка.
// Кто делает: генерацию выполняет оркестратор через Higgsfield (ключа в
// приложении нет), приложение хранит задание и результат.
export const dynamic = 'force-dynamic'

type Job = {
  id: number; title: string; stage: string; shots: { order: number; description: string; prompt: string; url: string | null }[]
  narrator_text: string | null; result_url: string | null; note: string | null; created_at: string
}

const STAGES: { key: string; label: string; waits: string }[] = [
  { key: 'shots',      label: 'Кадры',     waits: 'сгенерировать изображения по промптам' },
  { key: 'animation',  label: 'Анимация',  waits: 'оживить отобранные кадры' },
  { key: 'voice',      label: 'Озвучка',   waits: 'начитать текст диктора' },
  { key: 'edit',       label: 'Монтаж',    waits: 'собрать кадры, звук и титры' },
  { key: 'subtitles',  label: 'Субтитры',  waits: 'вшить в кадр' },
  { key: 'cover',      label: 'Обложка',   waits: 'сделать по идее из сценария' },
  { key: 'published',  label: 'Опубликован', waits: '' },
]

export default async function Pipeline() {
  const sb = await createClient()
  const { data } = await sb.from('promo_jobs').select('*').order('created_at', { ascending: false })
  const jobs = (data ?? []) as Job[]
  const byStage = new Map<string, Job[]>()
  for (const j of jobs) {
    const list = byStage.get(j.stage) ?? []
    list.push(j)
    byStage.set(j.stage, list)
  }

  return (
    <div className="min-h-screen bg-[#f5f5f3] p-6">
      <div className="max-w-4xl mx-auto space-y-5">
        <div>
          <Link href="/marketing/promo" className="text-[12px] text-[#9a9a95]">← Пульт продвижения</Link>
          <h1 className="text-[20px] font-bold text-[#111110] mt-1">Конвейер роликов</h1>
          <p className="text-[13px] text-[#9a9a95] mt-0.5">
            Сценарий из Video Factory → раскадровка с промптами → кадры → готовый ролик.
          </p>
        </div>

        {jobs.length === 0 && (
          <div className="rounded-xl border border-[#e4e4e0] bg-white p-6">
            <p className="text-[14px] text-[#111110]">Заданий пока нет.</p>
            <p className="text-[12px] text-[#9a9a95] mt-1 leading-relaxed">
              Задание появляется, когда в AI Video Factory нажать «→ В производство» на готовом
              сценарии. Раскадровка развернётся в промпты для кадров, текст диктора и моменты субтитров.
            </p>
            <Link href="/marketing/video-factory" className="inline-block mt-3 px-4 py-2 rounded-lg bg-[#111110] text-white text-[13px] font-medium">
              В AI Video Factory →
            </Link>
          </div>
        )}

        {STAGES.map(st => {
          const list = byStage.get(st.key) ?? []
          if (list.length === 0) return null
          return (
            <div key={st.key} className="rounded-xl border border-[#e4e4e0] bg-white overflow-hidden">
              <div className="px-4 pt-3 pb-2 flex items-baseline justify-between gap-3">
                <h2 className="text-[13px] font-semibold text-[#111110]">{st.label} — {list.length}</h2>
                {st.waits && <span className="text-[11px] text-[#9a9a95]">ждёт: {st.waits}</span>}
              </div>
              <div className="divide-y divide-[#f0f0ee]">
                {list.map(j => {
                  const done = j.shots.filter(s => s.url).length
                  return (
                    <div key={j.id} className="px-4 py-3 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[13.5px] text-[#111110]">{j.title}</p>
                        <p className="text-[11.5px] text-[#9a9a95] mt-0.5">
                          {j.shots.length > 0 && <>кадров {done}/{j.shots.length} · </>}
                          {j.narrator_text ? 'текст диктора есть' : 'текста диктора нет'} · {mskDate(j.created_at)}
                        </p>
                        {j.note && <p className="text-[11.5px] text-amber-700 mt-0.5">{j.note}</p>}
                      </div>
                      {j.result_url && (
                        <a href={j.result_url} target="_blank" rel="noreferrer"
                           className="text-[12px] text-[#111110] underline whitespace-nowrap">результат →</a>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
