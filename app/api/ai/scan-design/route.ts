import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase-server'

// Скан дизайн-проекта: браузер рендерит страницы PDF в JPEG и шлёт пачками,
// модель ищет изделия из стекла/зеркал и возвращает их с привязкой к странице
// и рамкой (bbox в % от изображения) — из неё клиент вырезает скриншот изделия.
export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

const SCAN_SCHEMA: Anthropic.Tool.InputSchema = {
  type: 'object' as const,
  properties: {
    // Отчёт по каждой странице ПЕРВЫМ — заставляет модель рассмотреть каждую страницу отдельно.
    page_report: {
      type: 'array',
      description: 'ОБЯЗАТЕЛЬНО: по одному элементу на КАЖДУЮ переданную страницу, в порядке страниц',
      items: {
        type: 'object',
        properties: {
          page:        { type: 'number', description: 'Номер страницы' },
          sheet_type:  { type: 'string', description: 'Что это за лист: титул / план / развертка / ведомость / 3D-визуализация / прочее' },
          items_found: { type: 'number', description: 'Сколько изделий из стекла/зеркал найдено на этой странице' },
        },
        required: ['page', 'items_found'],
      },
    },
    items: {
      type: 'array',
      description: 'Все найденные на этих страницах изделия из стекла и зеркал',
      items: {
        type: 'object',
        properties: {
          page:       { type: 'number', description: 'Номер страницы PDF, на которой изделие (из подписи к изображению)' },
          kind:       { type: 'string', enum: ['mirror', 'shower', 'partition', 'loft', 'glass_other'], description: 'mirror — зеркало; shower — душевая перегородка/ограждение/шторка; partition — стеклянная перегородка; loft — лофт-перегородка (стекло в профиле, чёрные импосты); glass_other — прочее стекло (полки, фартук, стол, ограждение)' },
          title:      { type: 'string', description: 'Короткое название изделия, напр. «Зеркало круглое с подсветкой», «Душевая перегородка с распашной дверью»' },
          dimensions: { type: 'string', description: 'Размеры из размерных цепочек чертежа, мм: «900×2200», «Ø1000», «1400, h=1850». Только то, что реально читается' },
          description:{ type: 'string', description: 'Что видно: форма, подсветка, крепёж, тип стекла/обработки, примыкания — кратко, по-русски' },
          room:       { type: 'string', description: 'Помещение, если понятно из листа (санузел, спальня, гостиная…)' },
          confidence: { type: 'string', enum: ['sure', 'maybe'], description: 'sure — точно изделие из стекла/зеркала; maybe — возможно (нужна проверка человеком)' },
          bbox: {
            type: 'object',
            description: 'Рамка изделия на изображении страницы, в процентах от ширины/высоты (0–100). Захвати изделие вместе с его размерными линиями',
            properties: {
              x: { type: 'number' }, y: { type: 'number' },
              w: { type: 'number' }, h: { type: 'number' },
            },
            required: ['x', 'y', 'w', 'h'],
          },
        },
        required: ['page', 'kind', 'title', 'confidence'],
      },
    },
  },
  required: ['page_report', 'items'],
}

const SYSTEM = `Ты — инженер стекольной компании M-Glass (зеркала, душевые ограждения, стеклянные и лофт-перегородки, стекло на заказ).
Тебе дают страницы дизайн-проекта интерьера (планы, развертки, ведомости). Найди ВСЕ изделия, которые компания могла бы изготовить:
зеркала (в т.ч. с подсветкой), душевые перегородки/ограждения/шторки, стеклянные перегородки, лофт-перегородки, стеклянные полки/фартуки/ограждения.
Размеры бери ТОЛЬКО из размерных цепочек и подписей на чертеже — ничего не вычисляй и не выдумывай; если размер не читается, не пиши его.
Одно и то же изделие на одной странице учитывай один раз. Мебель, окна, двери из дерева, картины — НЕ изделия.
Если страница — ведомость/спецификация с зеркалами или стеклом, тоже извлеки позиции.
ЧАСТЫЕ ЛОВУШКИ (не включай): настенные бра и светильники (в т.ч. вытянутой/фигурной формы — их легко спутать с фигурным зеркалом), картины и постеры, ниши, окна, зеркальные дверцы шкафов как мебель. Если нет явной подписи или очевидных признаков зеркала/стекла — ставь confidence=maybe или не включай вовсе.
bbox указывай аккуратно по той странице, где изделие видно.
Рассматривай КАЖДУЮ страницу отдельно и внимательно: сначала заполни page_report по каждой странице, потом перечисли изделия в items.`

export async function POST(req: Request) {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { pages, debug, hint, known, save_lesson } = await req.json() as {
    pages?: { page: number; image: string }[]; debug?: boolean; hint?: string; known?: string[]; save_lesson?: boolean
  }
  if (!Array.isArray(pages) || !pages.length) return NextResponse.json({ error: 'no pages' }, { status: 400 })
  if (pages.length > 6) return NextResponse.json({ error: 'max 6 pages per batch' }, { status: 400 })

  // Память уроков: заметки менеджеров с прошлых сканов подмешиваются в промпт,
  // новая заметка сохраняется один раз за повторный поиск (save_lesson с первой пачки).
  let lessonsBlock = ''
  try {
    if (save_lesson && typeof hint === 'string' && hint.trim()) {
      await sb.from('design_scan_lessons').insert({ lesson: hint.trim().slice(0, 1000) })
    }
    const { data: lessons } = await sb.from('design_scan_lessons')
      .select('lesson').order('created_at', { ascending: false }).limit(30)
    if (lessons?.length) {
      lessonsBlock = '\nУРОКИ ИЗ ПРОШЛЫХ ПРОЕКТОВ (замечания менеджеров — учитывай):\n' +
        [...new Set(lessons.map(l => l.lesson))].map(l => `— ${l}`).join('\n')
    }
  } catch { /* уроки не блокируют скан */ }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content: any[] = []
  for (const p of pages) {
    content.push({ type: 'text', text: `Страница ${p.page}:` })
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: p.image } })
  }
  if (Array.isArray(known) && known.length) {
    content.push({ type: 'text', text: 'Эти изделия УЖЕ найдены при первом проходе — НЕ включай их снова, ищи только ПРОПУЩЕННЫЕ:\n' + known.slice(0, 60).map(k => `— ${String(k).slice(0, 200)}`).join('\n') })
  }
  if (typeof hint === 'string' && hint.trim()) {
    content.push({ type: 'text', text: 'Замечания менеджера — учти обязательно: ' + hint.trim().slice(0, 2000) })
  }
  content.push({ type: 'text', text: 'Найди все изделия из стекла и зеркал на этих страницах.' })

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 4000,
      system: SYSTEM + lessonsBlock,
      tools: [{ name: 'items', description: 'Найденные изделия', input_schema: SCAN_SCHEMA }],
      tool_choice: { type: 'tool', name: 'items' },
      messages: [{ role: 'user', content }],
    })
    const tool = msg.content.find(c => c.type === 'tool_use')
    const input = (tool && tool.type === 'tool_use' ? tool.input : {}) as { items?: unknown[] }
    const items = Array.isArray(input.items) ? input.items : []
    if (debug) {
      return NextResponse.json({
        items,
        _debug: {
          received: pages.map(p => ({ page: p.page, imageLen: p.image?.length ?? 0 })),
          stop_reason: msg.stop_reason,
          usage: msg.usage,
          content_types: msg.content.map(c => c.type),
          raw_input_keys: tool && tool.type === 'tool_use' ? Object.keys(tool.input as object) : null,
          raw_input: tool && tool.type === 'tool_use' ? JSON.stringify(tool.input).slice(0, 1500) : null,
          raw_content: JSON.stringify(msg.content).slice(0, 1500),
        },
      })
    }
    return NextResponse.json({ items })
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: 'scan_failed', detail: detail.slice(0, 200) }, { status: 502 })
  }
}
