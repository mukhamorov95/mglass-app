import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase-server'
import { requireOwner } from '@/lib/apiAuth'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

export async function POST(req: Request) {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard

  const { perspective, healthSummary } = await req.json()
  const sb = await createClient()

  // Collect system context
  const [calcsRes, ordersRes, usersRes, glassRes, strategyRes, b2bRes] = await Promise.all([
    sb.from('calculations').select('final_price, margin, created_at').order('created_at', { ascending: false }).limit(30),
    sb.from('orders').select('status').limit(100),
    sb.from('users').select('role'),
    sb.from('glass_price_matrix').select('name, category, price_type, price').eq('price_type', 'cost').limit(20),
    fetch(`${process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'}/api/admin/owner-strategy`).then(r => r.json()).catch(() => null),
    sb.from('b2b_quotes').select('*', { count: 'exact', head: true }),
  ])

  const calcs   = calcsRes.data ?? []
  const orders  = ordersRes.data ?? []
  const users   = usersRes.data ?? []
  const glasses = glassRes.data ?? []

  const avgMargin = calcs.length
    ? Math.round(calcs.reduce((s, c) => s + (c.margin ?? 0), 0) / calcs.length)
    : 0

  const avgPrice = calcs.length
    ? Math.round(calcs.reduce((s, c) => s + (c.final_price ?? 0), 0) / calcs.length)
    : 0

  const ordersByStatus = orders.reduce<Record<string, number>>((acc, o) => {
    acc[o.status ?? 'unknown'] = (acc[o.status ?? 'unknown'] ?? 0) + 1
    return acc
  }, {})

  const roleBreakdown = users.reduce<Record<string, number>>((acc, u) => {
    acc[u.role ?? 'null'] = (acc[u.role ?? 'null'] ?? 0) + 1
    return acc
  }, {})

  const systemContext = {
    calculations:    { total: calcs.length, avg_margin_pct: avgMargin, avg_price_rub: avgPrice },
    orders:          { total: orders.length, by_status: ordersByStatus },
    users:           { total: users.length, by_role: roleBreakdown },
    glass_positions: glasses.length,
    b2b_quotes:      b2bRes.count ?? 0,
    strategy:        strategyRes,
    health_summary:  healthSummary ?? null,
  }

  const perspectiveInstructions: Record<string, string> = {
    ceo:        'CEO и собственника бизнеса: сосредоточься на выручке, рисках прибыльности, стратегических пробелах',
    analyst:    'системного аналитика: сосредоточься на качестве данных, надёжности интеграций, узких местах процессов',
    product:    'Product Owner: сосредоточься на UX, недостающих функциях, дублировании интерфейсов',
    erp:        'ERP-специалиста: сосредоточься на автоматизации, складе, закупках, логистике',
    marketing:  'маркетолога и SEO: сосредоточься на конверсии, скорости работы, видимости продукта',
  }

  const perspectiveLabel = perspectiveInstructions[perspective ?? 'ceo'] ?? perspectiveInstructions.ceo

  const prompt = `Ты — опытный консультант для стекольно-зеркальной производственной компании MGlass. Анализируй платформу с позиции ${perspectiveLabel}.

ДАННЫЕ СИСТЕМЫ:
${JSON.stringify(systemContext, null, 2)}

ЗАДАЧА:
Дай 5–7 конкретных рекомендаций для улучшения платформы MGlass.

Каждую рекомендацию оформи СТРОГО в формате JSON-объекта в массиве:
[
  {
    "title": "Краткий заголовок (до 60 символов)",
    "priority": "critical|high|medium|low",
    "category": "Финансы|UX|Автоматизация|Данные|Интеграция|Рост|Риск",
    "problem": "Что именно не так — одно предложение",
    "impact": "Какой эффект это оказывает на бизнес — одно предложение",
    "recommendation": "Конкретное действие — одно-два предложения",
    "metric": "Измеримый результат: на X% больше / экономия Y часов в неделю / и т.п."
  }
]

Отвечай ТОЛЬКО JSON-массивом, без markdown, без пояснений.`

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = message.content[0].type === 'text' ? message.content[0].text : '[]'

    let recommendations: unknown[] = []
    try {
      const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      recommendations = JSON.parse(cleaned)
    } catch {
      recommendations = []
    }

    return NextResponse.json({ recommendations, context: systemContext })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
