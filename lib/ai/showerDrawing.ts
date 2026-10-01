import 'server-only'
import type Anthropic from '@anthropic-ai/sdk'
import { M_MODELS } from '@/lib/configurator/arrangement'
import { ROLES, ROLE_META } from '@/lib/configurator/kit'
import type { ShowerDrawingParse } from '@/lib/calc/drawingParse'

// Разбор чертежа душевой в параметры «Расчёта» (Ч2). Модель читает, код считает:
// каждое поле — значение плюс «где это на чертеже», перевод в BuildRequest и все проверки —
// в lib/calc/drawingParse.ts. Общий для маршрута /api/ai/parse-shower-drawing и сверки с
// эталоном 0245 (scripts/drawing-0245-check.ts).

export const SHOWER_DRAWING_MODEL = 'claude-opus-5-5'

const ev = (type: 'number' | 'string', description: string) => ({
  type: 'object' as const,
  properties: {
    value: { type: [type, 'null'], description },
    evidence: { type: 'string', description: 'Где это на чертеже: лист, вид, размерная цепочка или подпись — коротко. Пусто, если не найдено.' },
  },
  required: ['value', 'evidence'],
})

const SCHEMA = {
  type: 'object' as const,
  properties: {
    is_shower_drawing: { type: 'boolean', description: 'true — чертёж/эскиз душевого ограждения; false — что-то другое' },
    showers: {
      type: 'array',
      description: 'Душевые на чертеже. Обычно одна на лист; лист с несколькими видами одной душевой — одна запись.',
      items: {
        type: 'object',
        properties: {
          sheet: { type: 'number', description: 'Номер страницы PDF (с 1); для фото — 1' },
          positions: { type: 'string', description: 'Номера позиций стёкол, как на чертеже, например «1–3»' },
          model: ev('string', `Код модели из списка: ${M_MODELS.map(m => m.code).join(', ')}. null, если ни одна не подходит.`),
          width_mm: ev('number', 'Ширина фронта (сторона с дверью) — общий размер по проёму или по оси, как проставлен'),
          depth_mm: ev('number', 'Только у угловых и трапеции: боковая сторона. Иначе null'),
          height_mm: ev('number', 'Высота ограждения'),
          door_width_mm: ev('number', 'Ширина двери (полотна), как проставлена в размерной цепочке'),
          color: ev('string', 'Цвет фурнитуры дословно, обычно в штампе «Цвет всей фурнитуры»'),
          glass: ev('string', 'Стекло дословно, обычно в штампе: «Стекло осветленное матовое 8 мм»'),
          thickness_mm: ev('number', 'Толщина стекла, мм'),
          hardware: {
            type: 'array',
            description: 'Фурнитура по выноскам и подписям. Каждая подпись — отдельно.',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string', description: 'Подпись дословно' },
                role: { type: ['string', 'null'], enum: [...ROLES, null], description: 'Роль из списка или null' },
                article: { type: ['string', 'null'], description: 'Артикул дословно, если он подписан (FDP-232, SD-210/L230). Не выдумывать.' },
                evidence: { type: 'string', description: 'Где подпись на чертеже' },
              },
              required: ['label', 'role', 'article', 'evidence'],
            },
          },
          notes: { type: 'array', items: { type: 'string' }, description: 'Примечания чертежа, важные для изготовления' },
        },
        required: ['sheet', 'model', 'width_mm', 'depth_mm', 'height_mm', 'door_width_mm', 'color', 'glass', 'thickness_mm', 'hardware'],
      },
    },
    warnings: { type: 'array', items: { type: 'string' }, description: 'Что прочитано неуверенно или противоречит друг другу' },
  },
  required: ['is_shower_drawing', 'showers'],
}

const SYS = [
  'Ты читаешь монтажные схемы душевых ограждений для расчёта M-Glass. Ты ничего не считаешь и не оцениваешь — только переносишь то, что написано на чертеже, и для каждого поля говоришь, где ты это увидел.',
  '',
  'Модели (код — что это):',
  ...M_MODELS.map(m => `${m.code} — ${m.name}: ${m.desc}`),
  '',
  'Роли фурнитуры (role — что это):',
  ...ROLES.map(r => `${r} — ${ROLE_META[r].label} (${ROLE_META[r].hint})`),
  '',
  'Правила:',
  '— Значение бери только с чертежа. Если его нет — value: null и пустой evidence. Не досчитывай размеры из цепочки сам, если итог не проставлен: впиши звенья в evidence, value оставь null.',
  '— Не путай размеры стекла с размерами проёма, выносками, штампом и рамкой листа.',
  '— Модель выбирай по виду сверху и виду спереди: сколько стёкол, где дверь, угол или прямая. Петля «стекло-стекло» — дверь висит на неподвижном стекле.',
  '— Артикул пиши ровно как подписан, с суффиксом (SD-210/L230). Похожий артикул из головы не подставляй.',
  '— Адрес, телефон и имя клиента не переносить.',
].join('\n')

export type ParseResult =
  | { ok: true; parsed: ShowerDrawingParse; model: string; outputTokens: number }
  | { ok: false; error: string; fatal?: boolean; stopReason?: string | null; outputTokens?: number; tail?: string }

type Media =
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } }
  | { type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'; data: string } }

export async function parseShowerDrawing(anthropic: Anthropic, media: Media): Promise<ParseResult> {
  try {
    const msg = await anthropic.messages.create({
      model: SHOWER_DRAWING_MODEL,
      max_tokens: 8000,
      system: SYS,
      tools: [{ name: 'shower_drawing', description: 'Прочитанные с чертежа параметры душевых', input_schema: SCHEMA as Anthropic.Tool.InputSchema }],
      tool_choice: { type: 'tool', name: 'shower_drawing' },
      messages: [{ role: 'user', content: [media, { type: 'text', text: 'Прочитай чертёж: все листы, каждую душевую.' }] }],
    })
    const tool = msg.content.find(c => c.type === 'tool_use')
    const parsed = tool && tool.type === 'tool_use' ? tool.input as ShowerDrawingParse : null
    if (msg.stop_reason === 'max_tokens' || !parsed || !Array.isArray(parsed.showers)) {
      const text = msg.content.map(c => (c.type === 'text' ? c.text : c.type === 'tool_use' ? JSON.stringify(c.input) : '')).join('')
      return { ok: false, error: 'no_structure', stopReason: msg.stop_reason, outputTokens: msg.usage.output_tokens, tail: text.slice(-300) }
    }
    return { ok: true, parsed, model: msg.model, outputTokens: msg.usage.output_tokens }
  } catch (e) {
    const err = e as { status?: number; error?: { error?: { type?: string } }; message?: string }
    const type = err.error?.error?.type ?? ''
    // Деньги и ключ повтором не чинятся — разбор останавливаем и говорим прямо.
    const fatal = type === 'billing_error' || type === 'authentication_error' || /credit balance/i.test(err.message ?? '')
    return { ok: false, error: `${type || 'api_error'}: ${(err.message ?? String(e)).slice(0, 240)}`, fatal }
  }
}
