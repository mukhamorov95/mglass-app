import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase-server'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

export type OrderItem = {
  name:       string
  qty:        number
  unit:       string
  unit_price: number  // sale price per unit (before discount)
}

export type PriceSuggestion = {
  recommended_discount: number        // percent, integer
  min_safe_discount:    number        // floor where margin = min_margin
  expected_margin:      number        // percent at recommended discount
  rationale:            string        // 2-3 sentences
  win_probability:      'high' | 'medium' | 'low'
  warning:              string | null // e.g. "Below segment average margin"
}

export async function POST(req: Request) {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { client_id, items } = await req.json() as { client_id: number; items: OrderItem[] }
  if (!client_id || !items?.length) {
    return NextResponse.json({ error: 'client_id and items required' }, { status: 400 })
  }

  // ── Load client + order history + margin threshold ─────────────────────────
  const [{ data: client }, { data: orders }, { data: settings }] = await Promise.all([
    sb.from('b2b_clients')
      .select('name,discount_percent,crm_segment,crm_score,crm_status')
      .eq('id', client_id)
      .single(),

    sb.from('b2b_orders')
      .select('total_after_discount,total_sale_inc_vat,discount_percent,margin_percent,created_at')
      .eq('client_id', client_id)
      .order('created_at', { ascending: false })
      .limit(10),

    // B2B min margin from financial_settings (tier = 'standard', product_type = 'b2b')
    sb.from('financial_settings')
      .select('min_margin,default_margin,max_discount_percent')
      .eq('tier', 'standard')
      .limit(1)
      .maybeSingle(),
  ])

  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

  const minMargin        = settings?.min_margin        ?? 15   // B2B floor
  const defaultMargin    = settings?.default_margin    ?? 30
  const maxDiscountLimit = settings?.max_discount_percent ?? 30

  // ── Segment average from recent orders ────────────────────────────────────
  let segmentAvgMargin: number | null = null
  if (client.crm_segment) {
    const { data: segOrders } = await sb
      .from('b2b_orders')
      .select('margin_percent,b2b_clients!inner(crm_segment)')
      .filter('b2b_clients.crm_segment', 'eq', client.crm_segment)
      .gte('created_at', new Date(Date.now() - 90 * 86_400_000).toISOString())
      .limit(50)

    if (segOrders?.length) {
      segmentAvgMargin = Math.round(
        segOrders.reduce((s, o) => s + (o.margin_percent ?? 0), 0) / segOrders.length
      )
    }
  }

  const orderHistory = (orders ?? []).map(o => ({
    date:     new Date(o.created_at).toLocaleDateString('ru-RU'),
    amount:   o.discount_percent > 0 ? o.total_after_discount : o.total_sale_inc_vat,
    discount: o.discount_percent,
    margin:   o.margin_percent,
  }))

  const totalOrderValue = items.reduce((s, i) => s + i.unit_price * i.qty, 0)

  // ── Prompt ─────────────────────────────────────────────────────────────────
  const prompt = `Ты — ценовой аналитик компании MGlass (производство стекла, зеркал, душевых ограждений).

Нужно определить оптимальную скидку для нового заказа.

Клиент: ${client.name}
Сегмент: ${client.crm_segment ?? 'не указан'}
Текущая скидка клиента: ${client.discount_percent}%
Класс клиента (A/B/C): ${client.crm_score ?? 'C'}
Статус: ${client.crm_status ?? 'new'}

Состав нового заказа:
${items.map(i => `- ${i.name}: ${i.qty} ${i.unit} × ${i.unit_price.toLocaleString('ru-RU')} ₽`).join('\n')}
Итого без скидки: ${totalOrderValue.toLocaleString('ru-RU')} ₽

История заказов этого клиента (последние 10):
${orderHistory.length ? JSON.stringify(orderHistory) : 'нет заказов'}

Средняя маржа по сегменту (последние 90 дней): ${segmentAvgMargin != null ? segmentAvgMargin + '%' : 'нет данных'}

Ограничения:
- Минимальная маржа B2B: ${minMargin}%
- Целевая маржа: ${defaultMargin}%
- Максимальная скидка по правилам: ${maxDiscountLimit}%

Верни ответ строго в формате JSON (без markdown-блоков):
{
  "recommended_discount": <целое число — процент скидки который рекомендуешь>,
  "min_safe_discount": <целое число — максимальная скидка при которой маржа ≥ ${minMargin}%>,
  "expected_margin": <целое число — ожидаемая маржа при recommended_discount>,
  "rationale": "2-3 предложения почему именно такая скидка выиграет заказ",
  "win_probability": "high" | "medium" | "low",
  "warning": "предупреждение если есть риски (или null)"
}

Логика выбора скидки:
- Клиент класса A с историей заказов → можно предложить чуть больше чтобы удержать
- Новый клиент или класс C → начни с минимума, не ниже min_margin
- Если объём > 300 000 ₽ → можно дать дополнительно 2-3% для закрытия сделки
- Никогда не рекомендуй ниже min_safe_discount`

  const msg = await anthropic.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 512,
    system:     'Ты — ценовой аналитик. Отвечаешь только валидным JSON без markdown-блоков.',
    messages:   [{ role: 'user', content: prompt }],
  })

  const raw = msg.content[0].type === 'text' ? msg.content[0].text : '{}'
  try {
    const result: PriceSuggestion = JSON.parse(raw.replace(/```json\s*/gi, '').replace(/```/g, '').trim())
    // Hard clamp: never exceed company policy
    result.recommended_discount = Math.min(result.recommended_discount, maxDiscountLimit)
    result.min_safe_discount    = Math.min(result.min_safe_discount, maxDiscountLimit)
    return NextResponse.json(result)
  } catch {
    return NextResponse.json({
      recommended_discount: client.discount_percent,
      min_safe_discount:    client.discount_percent,
      expected_margin:      defaultMargin,
      rationale:            'Не удалось получить рекомендацию. Используйте стандартную скидку клиента.',
      win_probability:      'medium',
      warning:              'AI-анализ недоступен',
    } satisfies PriceSuggestion)
  }
}
