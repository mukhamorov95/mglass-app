import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import type { DocumentBlockParam, ImageBlockParam, TextBlockParam } from '@anthropic-ai/sdk/resources/messages/messages'
import { createClient } from '@/lib/supabase-server'
import { countHoleSignals, logDrawingParse } from '@/lib/ai/parseLog'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

const ALLOWED_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'image',
  'image/jpg': 'image',
  'image/png': 'image',
}

const IMAGE_MEDIA: Record<string, 'image/jpeg' | 'image/png'> = {
  'image/jpeg': 'image/jpeg',
  'image/jpg':  'image/jpeg',
  'image/png':  'image/png',
}

export type ParsedGlassItem = {
  id: string
  width: number | null
  height: number | null
  quantity: number
  label: string
  comment: string
  confidence: 'high' | 'medium' | 'low'
  needsReview: boolean
}

const PROMPT = `Ты — система распознавания чертежей стекла и зеркал.
Проанализируй этот документ/изображение и найди все изделия из стекла/зеркал с размерами.

Для каждого изделия верни:
- width: ширина в мм (число или null если не распознано)
- height: высота в мм (число или null если не распознано)
- quantity: количество штук (по умолчанию 1)
- label: маркировка или наименование изделия (если есть)
- comment: дополнительные обозначения или особенности
- confidence: "high" | "medium" | "low" (насколько уверен в размерах)
- needsReview: true если размер неточный, нечитаемый или вызывает сомнения

Правила конвертации единиц:
- Если размеры в см → умножить на 10
- Если размеры в м → умножить на 1000
- Если формат "AxB" или "A×B" — A это ширина, B это высота
- Типичные размеры стекол: от 100мм до 6000мм

Верни ТОЛЬКО валидный JSON без лишнего текста:
{
  "items": [
    {
      "width": 1000,
      "height": 2000,
      "quantity": 2,
      "label": "Стекло А1",
      "comment": "закалённое",
      "confidence": "high",
      "needsReview": false
    }
  ],
  "rawText": "краткое описание того что нашёл в документе",
  "error": null
}`

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // См. lib/ai/parseLog.ts: до 02.09.2026 запуски разбора нигде не оставляли следа.
  const startedAt = Date.now()
  const { data: prof } = await supabase.from('users').select('name').eq('id', user.id).maybeSingle()
  const who = (prof as { name: string | null } | null)?.name ?? user.email ?? null
  let fileMeta: { name: string; type: string; size: number } | null = null
  const note = (ok: boolean, extra: Partial<Parameters<typeof logDrawingParse>[0]> = {}) =>
    logDrawingParse({ route: 'b2b/parse-pdf', userId: user.id, userName: who, file: fileMeta,
                      durationMs: Date.now() - startedAt, ok, ...extra })

  try {
    const form = await req.formData()
    const file = form.get('file') as File | null
    if (!file) {
      await note(false, { error: 'Файл не получен' })
      return NextResponse.json({ error: 'Файл не получен' }, { status: 400 })
    }
    fileMeta = { name: file.name, type: file.type, size: file.size }

    const maxSize = 20 * 1024 * 1024
    if (file.size > maxSize) {
      await note(false, { error: 'файл больше 20 МБ' })
      return NextResponse.json({ error: 'Файл слишком большой (макс. 20 МБ)' }, { status: 400 })
    }

    const mimeType = file.type || ''
    const kind = ALLOWED_TYPES[mimeType]
    if (!kind) {
      await note(false, { error: `тип не поддержан: ${mimeType || 'не указан'}` })
      return NextResponse.json({ error: 'Поддерживаются PDF, JPEG и PNG файлы' }, { status: 400 })
    }

    const buf = await file.arrayBuffer()
    const base64 = Buffer.from(buf).toString('base64')

    const fileBlock: DocumentBlockParam | ImageBlockParam = kind === 'pdf'
      ? {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: base64 },
        } as DocumentBlockParam
      : {
          type: 'image',
          source: { type: 'base64', media_type: IMAGE_MEDIA[mimeType], data: base64 },
        } as ImageBlockParam

    const response = await client.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [
          fileBlock,
          { type: 'text', text: PROMPT } as TextBlockParam,
        ],
      }],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''

    // Вытаскиваем JSON из ответа
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      await note(false, { error: 'модель вернула не JSON' })
      return NextResponse.json({ error: 'Не удалось разобрать ответ модели', raw: text }, { status: 500 })
    }

    const parsed = JSON.parse(jsonMatch[0])

    // Добавляем локальные id
    const items: ParsedGlassItem[] = (parsed.items ?? []).map((item: Omit<ParsedGlassItem, 'id'>, i: number) => ({
      ...item,
      id: `parsed-${i}-${Date.now()}`,
      width: item.width ? Math.round(Number(item.width)) : null,
      height: item.height ? Math.round(Number(item.height)) : null,
      quantity: Math.max(1, Number(item.quantity) || 1),
    }))

    const sig = countHoleSignals(items)
    await note(true, { itemsFound: items.length, itemsWithHoles: sig.withHoles, itemsWithDiameter: sig.withDiameter })

    return NextResponse.json({
      items,
      rawText: parsed.rawText ?? '',
      error: parsed.error ?? null,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Ошибка сервера'
    await note(false, { error: msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
