import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/apiAuth'
import { createServiceClient } from '@/lib/supabase-service'

// Сценарий из AI Video Factory → задание на производство.
//
// Шов, ради которого раздел и делался: раскадровка уже генерируется вместе
// со сценарием, но никуда не уходит. Здесь она превращается в конкретную
// работу — кадр с готовым промптом на генерацию, текст диктора, моменты
// субтитров, идея обложки.
//
// Промпт кадра собирается из описания и подсказки оператора: то и другое
// пишет генератор сценария, и вместе они дают достаточно для картинки.
// Хвост про стиль дописываем один и тот же — иначе кадры одного ролика
// окажутся из разных миров.
const STYLE = 'Фотореалистично, интерьерная съёмка, мягкий естественный свет, ' +
  'без людей в кадре, без текста и водяных знаков, чистая композиция'

type Shot = { order?: number; description?: string; tip?: string
             shot_size?: string; motion?: string; duration_sec?: number; prompt?: string }

export async function POST(req: NextRequest) {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard

  const body = await req.json().catch(() => ({}))
  const scriptId = Number(body.script_id)
  if (!scriptId) return NextResponse.json({ error: 'Не указан сценарий' }, { status: 400 })

  const sb = createServiceClient()
  const { data: script, error } = await sb
    .from('marketing_scripts')
    .select('id, title, content, status')
    .eq('id', scriptId)
    .single()
  if (error || !script) return NextResponse.json({ error: 'Сценарий не найден' }, { status: 404 })

  // Уже отправляли — не плодим второе задание молча.
  const { data: exists } = await sb.from('promo_jobs').select('id').eq('script_id', scriptId).maybeSingle()
  if (exists) return NextResponse.json({ id: exists.id, already: true })

  const c = (script.content ?? {}) as Record<string, unknown>
  const rawShots = Array.isArray(c.shots) ? (c.shots as Shot[]) : []
  const shots = rawShots.map((s, i) => ({
    order: s.order ?? i + 1,
    description: s.description ?? '',
    tip: s.tip ?? '',
    shot_size: s.shot_size ?? null,
    motion: s.motion ?? null,
    duration_sec: s.duration_sec ?? null,
    // Промпт от генератора сценария лучше склейки: он написан для генерации,
    // на английском и с ракурсом. Склейка описания с подсказкой — запасной путь
    // для старых сценариев, где поля prompt ещё не было.
    prompt: s.prompt || ([s.description, s.tip].filter(Boolean).join('. ') + '. ' + STYLE),
    url: null as string | null,
  }))

  const { data: job, error: insErr } = await sb.from('promo_jobs').insert({
    script_id: scriptId,
    title: (c.title as string) || script.title || `Сценарий #${scriptId}`,
    shots,
    narrator_text: (c.narrator_text as string) ?? null,
    subtitle_moments: Array.isArray(c.subtitle_moments) ? c.subtitle_moments : [],
    cover_idea: (c.cover_idea as string) ?? null,
  }).select('id').single()
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })

  // Сценарий уходит из «готов» в «съёмка»: карточка не должна выглядеть
  // ждущей работы, когда работа уже началась.
  await sb.from('marketing_scripts').update({ status: 'filming' }).eq('id', scriptId)

  return NextResponse.json({ id: job.id, shots: shots.length })
}
