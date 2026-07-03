import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase-server'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

// Разбор чертежа (PDF или фото от руки) в позиции для B2B-калькулятора.
const SCHEMA = {
  type: 'object' as const,
  properties: {
    is_drawing: { type: 'boolean', description: 'true, если это чертёж/эскиз стеклянных деталей с размерами; false — если файл не про детали (счёт, переписка, фото без размеров)' },
    items: {
      type: 'array',
      description: 'Стеклянные изделия/детали с чертежа. Каждая деталь — отдельный элемент.',
      items: {
        type: 'object',
        properties: {
          label:        { type: 'string', description: 'Наименование/описание детали (напр. «Полка», «Дверь душевой», «Стекло на стол»)' },
          width_mm:     { type: 'number', description: 'Ширина, мм' },
          height_mm:    { type: 'number', description: 'Высота/длина, мм' },
          thickness_mm: { type: 'number', description: 'Толщина стекла, мм (4/5/6/8/10/12). Если не указана — 0' },
          material:     { type: 'string', description: 'Тип стекла как на чертеже: прозрачное, осветлённое, бронза/тонированное, сатин/матовое, зеркало и т.п. Пусто, если не указано' },
          quantity:     { type: 'number', description: 'Количество одинаковых деталей (по умолчанию 1)' },
          holes:        { type: 'number', description: 'Кол-во ПРОСТЫХ круглых отверстий (сверловка на станке)' },
          cutouts:      { type: 'number', description: 'Кол-во СЛОЖНЫХ вырезов (пазы, «чебурашка», фигурные — разметка + выпил, дорого)' },
          tempering:    { type: 'boolean', description: 'Нужна закалка (закалённое/tempered/каленое)' },
          notes:        { type: 'string', description: 'Особенности: фаска, обработка кромки (полировка/еврокромка), фацет, скругления, пескоструй, плёнка — коротко' },
        },
      },
    },
    warnings: { type: 'array', items: { type: 'string' }, description: 'Что не удалось однозначно распознать / требует уточнения менеджером (нечёткий размер, неясная толщина/материал и т.п.)' },
  },
} as const

const SYS =
  'Ты — опытный технолог-оценщик стекольного производства M-Glass. Тебе дают чертёж или эскиз клиента ' +
  '(может быть аккуратный PDF, а может — фото от руки на бумаге). Задача: извлечь ТОЛЬКО реальные стеклянные ' +
  'детали с их параметрами для просчёта.\n' +
  'Правила:\n' +
  '— Отличай РАЗМЕРЫ ДЕТАЛИ (габариты стекла) от штампа, выносок, адресов, телефонов, пометок — их не бери.\n' +
  '— Размеры приводи в миллиметрах. Если указаны в см/метрах — переведи в мм.\n' +
  '— Каждая отдельная деталь = отдельный элемент items. Если написано «x2», «2 шт» — ставь quantity.\n' +
  '— Различай ПРОСТЫЕ отверстия (круглые, сверлятся на станке — быстро) и СЛОЖНЫЕ вырезы (пазы, «чебурашка», ' +
  'фигурные — сначала разметка, потом выпил — долго и дорого). Считай их РАЗДЕЛЬНО (holes vs cutouts).\n' +
  '— Толщину и материал бери только если явно есть; иначе thickness_mm=0 и material="".\n' +
  '— На чертеже от руки распознавай по-максимуму, а сомнительное вынеси в warnings.\n' +
  '— Если файл вообще не чертёж деталей — is_drawing=false и items пустой.'

export async function POST(req: Request) {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const form = await req.formData()
  const file = form.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'file required' }, { status: 400 })

  const buf = Buffer.from(await file.arrayBuffer())
  const b64 = buf.toString('base64')
  const name = (file.name || '').toLowerCase()
  const type = file.type || ''
  const isPdf = type.includes('pdf') || name.endsWith('.pdf')
  const isImg = type.startsWith('image/') || /\.(jpe?g|png|webp|gif|heic|heif)$/.test(name)

  if (!isPdf && !isImg) {
    return NextResponse.json({ error: 'unsupported', detail: 'Поддерживаются PDF и изображения (фото чертежа).' }, { status: 415 })
  }

  const media = isPdf
    ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: b64 } }
    : { type: 'image' as const, source: { type: 'base64' as const, media_type: (type && type.startsWith('image/') ? type : 'image/jpeg') as 'image/jpeg', data: b64 } }

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 2000,
      system: SYS,
      tools: [{ name: 'drawing', description: 'Извлечённые с чертежа детали', input_schema: SCHEMA }],
      tool_choice: { type: 'tool', name: 'drawing' },
      messages: [{ role: 'user', content: [media, { type: 'text', text: 'Разбери этот чертёж/эскиз в детали для просчёта.' }] }],
    })
    const tool = msg.content.find(c => c.type === 'tool_use')
    if (!tool || tool.type !== 'tool_use') return NextResponse.json({ error: 'no_structure' }, { status: 502 })
    return NextResponse.json({ parsed: tool.input })
  } catch (e) {
    const d = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: 'parse_failed', detail: d.slice(0, 300) }, { status: 502 })
  }
}
