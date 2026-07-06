import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

async function db() {
  const s = await createClient()
  const { data: { user } } = await s.auth.getUser()
  if (!user) return null
  return s
}

export async function GET(req: NextRequest) {
  const s = await db()
  if (!s) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { searchParams } = new URL(req.url)
  const date = searchParams.get('date') ?? new Date().toISOString().slice(0, 10)

  const { data, error } = await s
    .from('marketing_daily_ai')
    .select('*')
    .eq('date', date)
    .order('content_type')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const s = await db()
  if (!s) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { date, content_type, content } = await req.json()

  const { data, error } = await s
    .from('marketing_daily_ai')
    .upsert({ date, content_type, content }, { onConflict: 'date,content_type' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Дневной план сразу превращается в задачи (однократно на дату) —
  // иначе идеи остаются в кеше и не исполняются.
  if (content_type === 'daily_plan' && content && typeof content === 'object') {
    const prefix = `[AI ${date}]`
    const { count } = await s.from('marketing_tasks')
      .select('id', { count: 'exact', head: true }).like('title', `${prefix}%`)
    if (!count) {
      const pick = (o: unknown): string => {
        if (!o || typeof o !== 'object') return ''
        const x = o as Record<string, unknown>
        return String(x.title ?? x.text ?? x.description ?? x.idea ?? '').slice(0, 180)
      }
      const c = content as Record<string, unknown>
      const tasks = [
        { t: pick(c.top_reel_script), dir: 'content', label: 'Снять видео' },
        { t: pick(c.telegram_post), dir: 'content', label: 'Опубликовать в Telegram' },
        { t: pick(c.whatsapp_status), dir: 'content', label: 'Выставить WhatsApp-статус' },
        { t: pick(c.b2b_idea), dir: 'b2b', label: 'B2B-действие' },
        { t: pick(c.partner_action), dir: 'partners', label: 'Партнёрское действие' },
      ].filter(x => x.t)
      if (tasks.length) {
        await s.from('marketing_tasks').insert(tasks.map(x => ({
          title: `${prefix} ${x.label}: ${x.t}`,
          direction: x.dir,
          priority: 'high',
          status: 'todo',
          deadline: date,
        })))
      }
    }
  }
  return NextResponse.json(data)
}
