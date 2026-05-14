import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import * as tg from '@/lib/telegram'
import { readMemory, writeMemory, writeLog, startRun, finishRun, failRun } from '@/lib/agentMemory'

export const runtime = 'nodejs'
export const maxDuration = 60

function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const active = await startRun('catalog')
  if (!active) return NextResponse.json({ ok: true, skipped: true, reason: 'agent disabled' })

  try {
    const memory = await readMemory<{
      total_suggestions: number
      pending_approvals: Array<{ table: string; suggestion: string; created_at: string }>
      approved_count: number
    }>('catalog')

    const supabase = db()
    const now = new Date()

    // Читаем текущий каталог (что уже есть)
    const { data: config } = await supabase
      .from('agent_settings').select('config').eq('agent_key', 'catalog').single()
    const cfg = (config?.config ?? {}) as Record<string, unknown>
    const requireApproval = (cfg.require_approval as boolean) ?? true
    const maxPerDay = (cfg.max_suggestions_per_day as number) ?? 5

    const [
      { data: services },
      { data: materials },
      { data: glassMatrix },
    ] = await Promise.all([
      supabase.from('services').select('name').limit(50),
      supabase.from('materials').select('name, category').limit(50),
      supabase.from('glass_price_matrix').select('name').eq('price_type', 'cost').limit(30),
    ])

    const serviceList   = services?.map(s => s.name).join(', ') || 'нет данных'
    const materialList  = materials?.map(m => `${m.category}: ${m.name}`).join(', ') || 'нет данных'
    const glassTypeList = glassMatrix?.map(g => g.name).join(', ') || 'нет данных'

    // Анализируем популярные запросы в расчётах
    const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const { data: recentCalcs } = await supabase
      .from('calculations')
      .select('product_type, input_data')
      .gte('created_at', since7d.toISOString())
      .limit(100)

    const productTypes = recentCalcs?.reduce((acc, c) => {
      acc[c.product_type] = (acc[c.product_type] ?? 0) + 1
      return acc
    }, {} as Record<string, number>) ?? {}
    const topProducts = Object.entries(productTypes)
      .sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([k, v]) => `${k}: ${v} расчётов`).join(', ')

    const pendingCount = memory.pending_approvals?.length ?? 0

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
    const prompt = `Ты — наполнитель справочников MGlass. Анализируй пробелы в каталоге и предлагай новые позиции.

ТЕКУЩИЙ КАТАЛОГ:
Услуги (services): ${serviceList.slice(0, 400)}
Материалы (materials): ${materialList.slice(0, 400)}
Стекло (glass_price_matrix): ${glassTypeList}

АКТИВНОСТЬ (7 дней):
Популярные продукты: ${topProducts || 'нет данных'}

ЗАДАЧА: Найди ${maxPerDay} позиций которых НЕТ в каталоге но они нужны MGlass (производство: стекло, зеркала, душевые, перегородки, зеркала с подсветкой).

Можешь предлагать только для таблиц "services" или "materials".
- services: только name (без category)
- materials: name + category (одна из: Стекло, Фурнитура, Комплектующие, Химия, Упаковка, Прочее)

Формат ответа — строго JSON-массив, без пояснений:
[
  {"table": "services", "name": "...", "reason": "..."},
  {"table": "materials", "name": "...", "category": "Фурнитура", "reason": "..."}
]

Только реально нужные позиции. Не дублируй существующее.`

    const ALLOWED_TABLES = ['services', 'materials']
    let suggestions: Array<{ table: string; name: string; category?: string; reason: string }> = []
    try {
      const resp = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001', max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      })
      const text = resp.content.find(b => b.type === 'text')?.text?.trim() ?? '[]'
      const jsonMatch = text.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        suggestions = parsed.filter((s: { table: string }) => ALLOWED_TABLES.includes(s.table))
      }
    } catch {
      // Если AI не ответил JSON — пропускаем
    }

    if (!suggestions.length) {
      await writeLog('catalog', 'idle', 'AI не предложил новых позиций')
      await finishRun('catalog', '😴 Нет предложений')
      return NextResponse.json({ ok: true, suggestions: 0 })
    }

    if (requireApproval) {
      // Сохраняем предложения с уникальными ID
      const newPending = suggestions.map(s => ({
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        table: s.table,
        name: s.name,
        category: s.category ?? null,
        reason: s.reason,
        created_at: now.toISOString(),
      }))

      const allPending = [...(memory.pending_approvals ?? []), ...newPending].slice(-20)

      await writeMemory('catalog', {
        total_suggestions: (memory.total_suggestions ?? 0) + suggestions.length,
        pending_approvals: allPending,
        last_run_at: now.toISOString(),
      })

      // Уведомляем админа — каждое предложение отдельным сообщением с кнопками
      const header = [
        `🧠 <b>Наполнитель — новые предложения</b>`,
        `<i>${now.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}</i>`,
        ``,
        `Найдено <b>${suggestions.length}</b> новых позиций. Одобряй или отклоняй:`,
      ].join('\n')
      await tg.notifyAdmins(header).catch(() => {})

      for (const item of newPending) {
        const text = [
          `📋 [${item.table}] <b>${item.name}</b>${item.category ? ` (${item.category})` : ''}`,
          `<i>${item.reason}</i>`,
        ].join('\n')
        const kb = [[
          { text: '✅ Добавить', callback_data: `catalog:approve:${item.id}` },
          { text: '❌ Пропустить', callback_data: `catalog:reject:${item.id}` },
        ]]
        await tg.notifyAdminsWithKeyboard(text, kb).catch(() => {})
      }

      await writeLog('catalog', 'info',
        `Предложил ${suggestions.length} позиций (ожидают одобрения)`,
        { count: suggestions.length, pending: allPending.length })

      await finishRun('catalog', `📋 Предложил ${suggestions.length} позиций, ожидают одобрения`)
      return NextResponse.json({ ok: true, suggestions: suggestions.length, pending: allPending.length })

    } else {
      // Автодобавление (если require_approval = false)
      let added = 0
      for (const s of suggestions) {
        try {
          const row: Record<string, string> = { name: s.name }
          if (s.category) row.category = s.category
          await supabase.from(s.table).insert(row)
          added++
        } catch {
          // Дубликат — пропускаем
        }
      }

      await writeMemory('catalog', {
        total_suggestions: (memory.total_suggestions ?? 0) + added,
        approved_count: (memory.approved_count ?? 0) + added,
        last_run_at: now.toISOString(),
      })

      await writeLog('catalog', 'success', `Добавил ${added} позиций в каталог автоматически`)
      await finishRun('catalog', `✅ Добавил ${added} позиций в каталог`)
      return NextResponse.json({ ok: true, added })
    }

  } catch (err) {
    await failRun('catalog', String(err))
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}

export const POST = GET
