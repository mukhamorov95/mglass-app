import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const PRODUCT_LABELS: Record<string, string> = {
  mirror: 'Зеркало с подсветкой',
  loft: 'Лофт-перегородка',
  shower: 'Душевая перегородка',
}

export async function POST(req: Request) {
  try {
    const { calculation_id, context } = await req.json() as {
      calculation_id?: number | null
      context?: string
    }

    let prompt: string

    if (calculation_id) {
      const { data: calc, error } = await supabase
        .from('calculations')
        .select('*')
        .eq('id', calculation_id)
        .single()

      if (error || !calc) {
        return NextResponse.json({ error: 'Расчёт не найден' }, { status: 404 })
      }

      const productLabel = PRODUCT_LABELS[calc.product_type] ?? calc.product_type
      const inputData = calc.input_data as Record<string, unknown>
      const dimensions = inputData.width && inputData.height
        ? `${inputData.width}×${inputData.height} мм`
        : null

      prompt = `Составь профессиональное коммерческое предложение для клиента от компании MGlass.

Данные расчёта:
- Изделие: ${productLabel}
${dimensions ? `- Размеры: ${dimensions}` : ''}
- Итоговая стоимость: ${(calc.final_price as number).toLocaleString('ru-RU')} ₽
- Скидка: ${calc.discount ? `${calc.discount}%` : 'нет'}
${context ? `\nДополнительная информация: ${context}` : ''}

Структура КП:
1. Краткое вступление (1-2 предложения, без воды)
2. Описание изделия и что входит в стоимость
3. Стоимость (выделить)
4. Сроки изготовления и монтажа
5. Условия оплаты
6. Гарантия
7. Призыв к действию (конкретный следующий шаг)

Стиль: профессионально, дружелюбно, без клише типа "рады предложить" и "в сжатые сроки". Конкретно и по делу.`
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
      model: 'claude-sonnet-4-6',
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
