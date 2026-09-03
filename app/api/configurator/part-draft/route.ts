import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { requireAdmin } from '@/lib/apiAuth'
import { PART_SYSTEM, PART_SCHEMA, PART_USER_TEXT } from '@/lib/configurator/parts/extractPrompt'
import { validatePart } from '@/lib/configurator/parts/validate'
import type { PartSpec, Prim } from '@/lib/configurator/parts/types'

// Чертёж + фото + страница поставщика — разбор идёт дольше обычного ответа.
export const maxDuration = 120

const MODEL = 'claude-opus-5'
const MAX_IMAGES = 4
const MAX_BYTES = 4_000_000   // на изображение, после base64

type Draft = {
  recognized: boolean; article?: string; label?: string; role?: string
  glass_mm?: number[]; through?: boolean; clamps?: number[]; mount?: string
  dims?: Record<string, number>; geometry?: Prim[]; sources?: string[]; notes?: string[]
}

// Черновик модели → паспорт. Отдельным шагом, потому что модель отвечает плоской
// схемой (её проще заполнять без ошибок), а паспорт вложенный.
function toSpec(d: Draft, url?: string): PartSpec {
  const id = (d.role || 'part') + (d.article ? '-' + d.article.toLowerCase().replace(/[^a-z0-9]+/g, '-') : '')
  return {
    id: id.replace(/^-|-$/g, ''),
    article: d.article ?? '',
    label: d.label ?? '',
    role: d.role ?? '',
    supplier: url ? { name: new URL(url).hostname.replace(/^www\./, ''), url } : undefined,
    source: { note: (d.sources ?? []).join('; ') || undefined },
    dims: d.dims ?? {},
    geometry: d.geometry ?? [],
    mount: {
      on: (d.mount as PartSpec['mount']['on']) ?? 'glass-face',
      through: d.through || undefined,
      clamps: d.clamps?.length === 2 ? [d.clamps[0], d.clamps[1]] : undefined,
      glassMm: d.glass_mm?.length === 2 ? [d.glass_mm[0], d.glass_mm[1]] : undefined,
    },
  }
}

export async function POST(req: Request) {
  const guard = await requireAdmin()
  if (guard instanceof NextResponse) return guard
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'no_key', detail: 'Не настроен ANTHROPIC_API_KEY.' }, { status: 501 })
  }

  const body = await req.json().catch(() => null) as { url?: string; images?: string[]; notes?: string } | null
  const images = (body?.images ?? []).slice(0, MAX_IMAGES)
  if (!images.length) {
    return NextResponse.json({ error: 'no_images', detail: 'Нужны чертёж и хотя бы одно фото детали.' }, { status: 400 })
  }

  const content: Anthropic.MessageParam['content'] = []
  for (const src of images) {
    const m = /^data:(image\/(png|jpeg|webp|gif));base64,(.+)$/.exec(src)
    if (!m) return NextResponse.json({ error: 'bad_image', detail: 'Изображения передаются как data:image/...;base64.' }, { status: 400 })
    if (m[3].length > MAX_BYTES) return NextResponse.json({ error: 'too_big', detail: 'Изображение больше 4 МБ — уменьшите.' }, { status: 400 })
    content.push({ type: 'image', source: { type: 'base64', media_type: m[1] as 'image/png', data: m[3] } })
  }
  const extra = [
    body?.url ? `Страница поставщика: ${body.url}` : '',
    body?.notes ? `Что известно от владельца: ${body.notes}` : '',
  ].filter(Boolean).join('\n')
  content.push({ type: 'text', text: PART_USER_TEXT + (extra ? '\n\n' + extra : '') })

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: PART_SYSTEM,
      tools: [{ name: 'part', description: 'Паспорт детали, снятый с чертежа', input_schema: PART_SCHEMA }],
      tool_choice: { type: 'tool', name: 'part' },
      messages: [{ role: 'user', content }],
    })
    const tool = msg.content.find(c => c.type === 'tool_use')
    if (!tool || tool.type !== 'tool_use') {
      return NextResponse.json({ error: 'no_result', detail: 'Модель не вернула паспорт.' }, { status: 502 })
    }
    const draft = tool.input as Draft
    if (!draft.recognized) {
      return NextResponse.json({ error: 'not_a_part', detail: 'На изображениях не фурнитура с размерами.', notes: draft.notes ?? [] }, { status: 422 })
    }
    const spec = toSpec(draft, body?.url)
    // Черновик НЕ уходит в сцену: возвращаем его вместе с приёмкой, решение за человеком.
    return NextResponse.json({
      spec,
      issues: validatePart(spec),
      sources: draft.sources ?? [],
      questions: draft.notes ?? [],
    })
  } catch (e) {
    const detail = e instanceof Error ? e.message.slice(0, 300) : 'Ошибка разбора'
    return NextResponse.json({ error: 'failed', detail }, { status: 502 })
  }
}
