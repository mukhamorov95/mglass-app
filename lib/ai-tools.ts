import type { SupabaseClient } from '@supabase/supabase-js'
import type { Tool } from '@anthropic-ai/sdk/resources/messages/messages'

export const AI_TOOLS: Tool[] = [
  {
    name: 'get_materials',
    description: 'Получить активные материалы с ценами из справочника MGlass',
    input_schema: {
      type: 'object' as const,
      properties: {
        category: {
          type: 'string',
          description: 'Категория: зеркало, стекло, подсветка, профиль, электрика, расходники, работа, услуга, фурнитура. Пропустить — вернёт все.',
        },
      },
    },
  },
  {
    name: 'get_financial_settings',
    description:
      'Получить финансовые настройки: налог, маржа (default_margin, min_margin), проценты расходов, пороги цвета маржи, ' +
      'максимальная скидка, сроки SLA. Строк несколько — по типу изделия и уровню (tier). Строки с product_type = null — ' +
      'общие по уровням budget/standard. Без product_type вернёт все строки.',
    input_schema: {
      type: 'object' as const,
      properties: {
        product_type: {
          type: 'string',
          description:
            'Тип изделия, например: mirror, mirror_light, loft, shower_standard, shower_budget. ' +
            'Если своей строки у типа нет — вернутся общие строки (product_type = null).',
        },
      },
    },
  },
  {
    name: 'get_recent_calculations',
    description: 'Получить последние расчёты из истории',
    input_schema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number', description: 'Количество записей (по умолчанию 5, макс 20)' },
        product_type: { type: 'string', description: 'Тип изделия: mirror, loft, shower' },
      },
    },
  },
  {
    name: 'get_calculation',
    description: 'Получить конкретный расчёт по ID со всеми деталями',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'number', description: 'ID расчёта' },
      },
      required: ['id'],
    },
  },
]

// supabase — клиент вызывающего (RLS): модель видит ровно то, что человек увидел бы на
// экране. Service-ключ здесь отдавал партнёру закупочные цены, а любому сотруднику —
// чужие расчёты с телефонами клиентов (30.09).
export async function executeTool(name: string, input: Record<string, unknown>, supabase: SupabaseClient): Promise<string> {
  try {
    switch (name) {
      case 'get_materials': {
        let query = supabase
          .from('materials')
          .select('name,category,unit,cost_price,in_stock')
          .eq('active', true)
        if (input.category) query = query.eq('category', input.category as string)
        const { data, error } = await query.order('category').order('name')
        if (error) return `Ошибка: ${error.message}`
        return JSON.stringify(data ?? [])
      }
      case 'get_financial_settings': {
        // Фильтр в коде, а не в запросе: строк единицы, а запасные общие строки нужны,
        // когда у типа своей нет — так же выбирают калькуляторы (quickCalc.pickSettings).
        const { data, error } = await supabase.from('financial_settings').select('*').order('id')
        if (error) return `Ошибка: ${error.message}`
        const rows = (data ?? []) as { product_type: string | null }[]
        const productType = input.product_type as string | undefined
        if (!productType) return JSON.stringify(rows)
        const own = rows.filter(r => r.product_type === productType)
        return JSON.stringify(own.length > 0 ? own : rows.filter(r => r.product_type == null))
      }
      case 'get_recent_calculations': {
        const limit = Math.min((input.limit as number) ?? 5, 20)
        let query = supabase
          .from('calculations')
          .select('id,product_type,final_price,margin,profit,status,created_at,input_data')
          .order('created_at', { ascending: false })
          .limit(limit)
        if (input.product_type) query = query.eq('product_type', input.product_type as string)
        const { data, error } = await query
        if (error) return `Ошибка: ${error.message}`
        return JSON.stringify(data ?? [])
      }
      case 'get_calculation': {
        const { data, error } = await supabase
          .from('calculations')
          .select('*')
          .eq('id', input.id as number)
          .single()
        if (error) return `Ошибка: ${error.message}`
        return JSON.stringify(data)
      }
      default:
        return `Неизвестный инструмент: ${name}`
    }
  } catch (err) {
    return `Ошибка выполнения: ${err instanceof Error ? err.message : String(err)}`
  }
}
