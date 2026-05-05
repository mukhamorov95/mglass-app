import { createClient } from '@supabase/supabase-js'
import type { Tool } from '@anthropic-ai/sdk/resources/messages/messages'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

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
    description: 'Получить текущие финансовые настройки: маржа, расходы, налоги',
    input_schema: { type: 'object' as const, properties: {} },
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

export async function executeTool(name: string, input: Record<string, unknown>): Promise<string> {
  try {
    const supabase = getSupabase()
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
        const { data, error } = await supabase.from('financial_settings').select('*').single()
        if (error) return `Ошибка: ${error.message}`
        return JSON.stringify(data)
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
