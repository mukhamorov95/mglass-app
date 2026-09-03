import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import { mskDateTime } from '@/lib/time'

// Пульт продвижения. Задача экрана — за один взгляд ответить на три вопроса:
// хватает ли денег на производство, что сейчас в работе и что застряло.
//
// Баланс Higgsfield берём из paid_services, а не из его API: ключа в приложении
// нет, значение обновляет оркестратор. Поэтому рядом всегда стоит дата проверки —
// цифра без даты выглядела бы живой, а она такой не является.
export const dynamic = 'force-dynamic'

type Svc = { balance_note: string | null; checked_at: string | null; status: string | null }
type Script = { status: string | null }

const STAGES: { key: string; label: string; hint: string }[] = [
  { key: 'idea',      label: 'Идея',      hint: 'заведена, сценария нет' },
  { key: 'script',    label: 'Сценарий',  hint: 'готов, ждёт кадров' },
  { key: 'filming',   label: 'Кадры',     hint: 'генерация изображений' },
  { key: 'editing',   label: 'Монтаж',    hint: 'сборка и субтитры' },
  { key: 'published', label: 'Опубликован', hint: '' },
]

export default async function PromoDashboard() {
  const sb = await createClient()
  const [{ data: svc }, { data: scripts }] = await Promise.all([
    sb.from('paid_services').select('balance_note, checked_at, status').eq('key', 'HIGGSFIELD').maybeSingle(),
    sb.from('marketing_scripts').select('status'),
  ])
  const s = (svc ?? null) as Svc | null
  const rows = (scripts ?? []) as Script[]
  const byStage = new Map<string, number>()
  for (const r of rows) byStage.set(r.status ?? 'idea', (byStage.get(r.status ?? 'idea') ?? 0) + 1)

  const noMoney = (s?.status ?? '') !== 'ok'

  return (
    <div className="min-h-screen bg-[#f5f5f3] p-6">
      <div className="max-w-4xl mx-auto space-y-5">
        <div>
          <h1 className="text-[20px] font-bold text-[#111110]">Пульт продвижения</h1>
          <p className="text-[13px] text-[#9a9a95] mt-0.5">
            Производство контента: сценарий → кадры → озвучка → монтаж → публикация.
          </p>
        </div>

        <div className={`rounded-xl border p-4 ${noMoney ? 'border-amber-300 bg-amber-50' : 'border-[#e4e4e0] bg-white'}`}>
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <span className="text-[13px] font-semibold text-[#111110]">Higgsfield · производство кадров и озвучки</span>
            {s?.checked_at && (
              <span className="text-[11px] text-[#9a9a95]">проверено {mskDateTime(s.checked_at)}</span>
            )}
          </div>
          <p className="text-[14px] text-[#111110] mt-1.5 font-mono">{s?.balance_note ?? 'баланс не заведён'}</p>
          {noMoney && (
            <p className="text-[12px] text-amber-800 mt-2">
              Пока баланса не хватает, генерация кадров и озвучки не запускается. Сценарии
              и раскадровка при этом делаются как обычно — они не стоят кредитов.
            </p>
          )}
          <Link href="/admin/services" className="text-[12px] text-[#111110] underline mt-2 inline-block">
            Все платные сервисы →
          </Link>
        </div>

        <div className="rounded-xl border border-[#e4e4e0] bg-white p-4">
          <h2 className="text-[13px] font-semibold text-[#111110] mb-3">Что в работе</h2>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {STAGES.map(st => (
              <div key={st.key} className="rounded-lg border border-[#e4e4e0] p-3">
                <p className="text-[22px] font-semibold text-[#111110] leading-none tabular-nums">{byStage.get(st.key) ?? 0}</p>
                <p className="text-[12px] text-[#111110] mt-1">{st.label}</p>
                {st.hint && <p className="text-[10px] text-[#9a9a95] mt-0.5 leading-tight">{st.hint}</p>}
              </div>
            ))}
          </div>
          {rows.length === 0 && (
            <p className="text-[12px] text-[#9a9a95] mt-3">
              Сценариев пока нет. Заводятся в AI Video Factory.
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Link href="/marketing/video-factory" className="px-4 py-2 rounded-lg bg-[#111110] text-white text-[13px] font-medium">
            AI Video Factory →
          </Link>
          <Link href="/marketing/promo/pipeline" className="px-4 py-2 rounded-lg border border-[#e4e4e0] bg-white text-[13px]">
            Конвейер роликов
          </Link>
          <Link href="/marketing/promo/guide" className="px-4 py-2 rounded-lg border border-[#e4e4e0] bg-white text-[13px]">
            Регламент
          </Link>
          <Link href="/marketing/media-library" className="px-4 py-2 rounded-lg border border-[#e4e4e0] bg-white text-[13px]">
            Медиабиблиотека
          </Link>
        </div>
      </div>
    </div>
  )
}
