import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { requireAnyPageAccess } from '@/lib/apiAuth'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

const PRODUCT_LABELS: Record<string, string> = {
  mirror: 'Зеркало с подсветкой',
  loft: 'Лофт-перегородка',
  shower: 'Душевая перегородка',
}

export async function POST(req: Request) {
  const guard = await requireAnyPageAccess(['/ai-sales', '/kp-generator'])
  if (guard instanceof NextResponse) return guard

  try {
    // Расчёт читается под RLS вошедшего: service-ключ при гейте «вошёл» отдавал
    // любой роли, включая партнёра, чужой расчёт по id (аудиты 20.07 и 30.09).
    const auth = await createServerClient()
    const { data: { user } } = await auth.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

    const { calculation_id, context } = await req.json() as {
      calculation_id?: number | null
      context?: string
    }

    let prompt: string

    if (calculation_id) {
      const { data: calc, error } = await auth
        .from('calculations')
        .select('*')
        .eq('id', calculation_id)
        .maybeSingle()

      if (error) return NextResponse.json({ error: `Расчёт не прочитан: ${error.message}` }, { status: 500 })
      if (!calc) return NextResponse.json({ error: 'Расчёт не найден' }, { status: 404 })

      const productLabel = PRODUCT_LABELS[calc.product_type] ?? calc.product_type
      const clientText = (calc.client_text as string | null) ?? ''

      prompt = `Составь профессиональное коммерческое предложение для клиента от компании MGlass.

СОСТАВ ИЗДЕЛИЯ (только то, что реально входит в расчёт — не добавляй ничего лишнего):
${clientText || `${productLabel}, стоимость ${(calc.final_price as number).toLocaleString('ru-RU')} ₽`}

Итоговая стоимость: ${(calc.final_price as number).toLocaleString('ru-RU')} ₽${calc.discount ? `\nСкидка: ${calc.discount}%` : ''}
${context ? `\nДополнительная информация от менеджера: ${context}` : ''}

Структура КП:
1. Краткое вступление (1-2 предложения, без воды)
2. Описание изделия — используй ТОЛЬКО то, что указано в СОСТАВЕ выше, ничего не придумывай
3. Стоимость (выделить)
4. Сроки изготовления
5. Гарантия и условия
6. Призыв к действию (конкретный следующий шаг)

Стиль: профессионально, дружелюбно, без клише. Конкретно и по делу.`
    } else {
      prompt = `Составь шаблон коммерческого предложения компании MGlass (стекло, зеркала, лофт-перегородки, душевые).
${context ? `\nКонтекст: ${context}` : ''}

Используй плейсхолдеры [ИМЯ КЛИЕНТА], [ИЗДЕЛИЕ], [РАЗМЕРЫ], [СТОИМОСТЬ] и т.д.

Структура КП:
1. Обращение к клиенту
2. Описание изделия
3. Состав работ
4. Стоимость
5. Сроки
6. Гарантия и условия
7. Следующий шаг

Стиль: профессионально, без шаблонных фраз.`
    }

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 2048,
      system: 'Ты — специалист по продажам компании MGlass. Пишешь коммерческие предложения чётко и профессионально.',
      messages: [{ role: 'user', content: prompt }],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    return NextResponse.json({ text })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Ошибка сервера'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
