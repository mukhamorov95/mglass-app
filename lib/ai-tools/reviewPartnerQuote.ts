import Anthropic from '@anthropic-ai/sdk'

// AI-проверка ЛОГИКИ партнёрского просчёта (не цены — цену считает наш движок).
// Ищет то, что внешний заказчик мог упустить: забытую закалку, нереальные
// габариты, отверстия/форму без пояснений, неподходящий материал. Для менеджера.

export type QuoteReviewIssue = { severity: 'warn' | 'info'; text: string }
export type QuoteReview = { issues: QuoteReviewIssue[]; summary: string }

export type ReviewItem = {
  material: string; thickness: number; width: number; height: number; quantity: number
  hasTempering?: boolean; hasFacet?: boolean; hasHoles?: boolean; shape?: string
}

const SYSTEM = `Ты — технолог стекольного производства M-Glass. Менеджер получил ПРОСЧЁТ от партнёра (внешнего заказчика), который считал сам в нашем калькуляторе. Цена уже посчитана нашим движком — её проверять НЕ нужно. Найди ЛОГИЧЕСКИЕ ошибки/риски в спецификации, которые партнёр мог упустить, чтобы менеджер проверил их перед запуском.

Проверяй: не забыта ли закалка там, где она нужна по безопасности (душевые, крупные полотна, стекло у пола/двери, большие площади); реальны ли габариты (лист макс ~3210×2250 мм — деталь больше не режется целиком); нет ли отверстий/криволинейной формы без пояснений (нужен чертёж); подходит ли толщина под задачу; хрупкие соотношения (очень узкие длинные детали). Если всё логично — так и скажи в summary и верни пустой issues. Не выдумывай проблемы. Кратко, по-русски, для менеджера.`

const TOOL = {
  name: 'review',
  description: 'Вернуть проверку логики просчёта',
  input_schema: {
    type: 'object' as const,
    properties: {
      issues: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            severity: { type: 'string', enum: ['warn', 'info'] },
            text: { type: 'string' },
          },
          required: ['severity', 'text'],
        },
      },
      summary: { type: 'string' },
    },
    required: ['issues', 'summary'],
  },
}

export async function reviewPartnerQuote(items: ReviewItem[]): Promise<QuoteReview> {
  if (!process.env.ANTHROPIC_API_KEY || items.length === 0) return { issues: [], summary: '' }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const spec = items.map((it, i) =>
    `${i + 1}. ${it.material} ${it.thickness}мм, ${it.width}×${it.height} мм, ${it.quantity} шт` +
    `${it.hasTempering ? ', закалка' : ''}${it.hasFacet ? ', фацет' : ''}` +
    `${it.hasHoles ? ', отверстия' : ''}${it.shape === 'curved' ? ', криволинейная форма' : ''}`,
  ).join('\n')

  const res = await anthropic.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 800,
    system: SYSTEM,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: 'review' },
    messages: [{ role: 'user', content: `Спецификация просчёта:\n${spec}` }],
  })

  const tu = res.content.find(c => c.type === 'tool_use') as Anthropic.ToolUseBlock | undefined
  const input = (tu?.input ?? {}) as Partial<QuoteReview>
  const issues: QuoteReviewIssue[] = Array.isArray(input.issues)
    ? input.issues
        .filter(x => x && typeof x.text === 'string')
        .map(x => ({ severity: (x.severity === 'warn' ? 'warn' : 'info') as 'warn' | 'info', text: String(x.text).slice(0, 300) }))
        .slice(0, 8)
    : []
  return { issues, summary: String(input.summary ?? '').slice(0, 400) }
}
