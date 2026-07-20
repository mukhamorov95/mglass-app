import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { vladDb } from '@/lib/vlad/vladClient'
import { simulatePayoff, monthlyLoad, totalDebt, type Obligation } from '@/lib/vlad/debtMath'

export const maxDuration = 120

// AI-советник владельца: 2 раза в день (утро/вечер, vercel.json) заходит в
// личный контур, анализирует финансы + задачи + дисциплину и кладёт разбор
// во вкладку «Предложения». Роль — финансовый директор / антикризис-менеджер.
// ВАЖНО: агент только советует, данные не меняет («ничего молча»). Все цифры
// считаются детерминированно ДО модели — модель интерпретирует, не вычисляет.

const SYSTEM = `Ты — личный финансовый директор и антикризис-менеджер Владислава,
владельца стекольной компании M-Glass. У него много кредитов и обязательств,
он тянет всё сам и его цель — полностью освободиться от долгов: выделять деньги
на досрочное гашение и каждый месяц отдавать всё больше.

Тебе дают снимок его личного контура: долги с готовыми расчётами (симуляции уже
посчитаны кодом — НЕ пересчитывай), задачи по ролям (CEO/менеджер/финансы/
производство/отец/муж/сын/брат), входящее, спорт-дисциплину.

Верни СТРОГО JSON: {"title": "заголовок разбора одной фразой", "items": [
 {"point": "короткий тезис", "detail": "2-4 предложения конкретики: что вижу в цифрах и что предлагаю обсудить/сделать", "kind": "finance"|"tasks"|"discipline"|"idea"}
]}

Правила:
- 3-6 пунктов, самое важное первым. Опирайся ТОЛЬКО на данные снимка, цифры не выдумывай.
- finance: наблюдения по долгам и темпу (что дала бы досрочка, где платёж не покрывает проценты, какой долг близок к закрытию — это мотивация).
- tasks: просроченное, неразобранное входящее, задачи без сроков, перекос ролей (например, семья давно без внимания).
- discipline: спорт-серия, надиктовки (пустые дни = голова не выгружается).
- Не рекомендуй финансовые продукты, брокеров, инвестиции. Решения по кредитам
  (рефинансировать, что гасить) подавай как варианты с цифрами, решает он.
- Тон: прямой, поддерживающий, без воды и морализаторства. Он в тяжёлом периоде
  и хочет не сдаться — помогай видеть прогресс и следующий шаг.`

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const db = vladDb()
  if (!db) return NextResponse.json({ error: 'VLAD_SUPABASE_* не настроены' }, { status: 503 })

  const hour = Number(new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'Europe/Moscow' }))
  const slot = req.nextUrl.searchParams.get('slot') ?? (hour < 14 ? 'morning' : 'evening')

  // ── Снимок: всё считаем кодом, модель только интерпретирует ──
  const today = new Date().toISOString().slice(0, 10)
  const nowISO = new Date().toISOString()
  const [obsR, tasksR, notesR, sportR] = await Promise.all([
    db.from('vlad_obligations').select('*'),
    db.from('vlad_tasks').select('*').in('status', ['inbox', 'active']),
    db.from('vlad_notes').select('id,created_at,status').gte('created_at', new Date(Date.now() - 7 * 86400_000).toISOString()),
    db.from('vlad_sport').select('day,exercise,done').gte('day', new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10)),
  ])
  const obs = (obsR.data ?? []) as Obligation[]
  const tasks = tasksR.data ?? []
  const active = obs.filter(o => !o.closed_at)

  const sim0 = active.length ? simulatePayoff(obs, 'avalanche', 0, nowISO) : null
  const sim50 = active.length ? simulatePayoff(obs, 'avalanche', 50_000, nowISO) : null
  const simSnow = active.length ? simulatePayoff(obs, 'snowball', 0, nowISO) : null

  const snapshot = {
    date: today, slot,
    debts: {
      count: active.length,
      total: totalDebt(obs),
      monthly_load: monthlyLoad(obs),
      closed_total: obs.length - active.length,
      list: active.map(o => ({ creditor: o.creditor, principal: o.principal, rate: o.rate_pct, payment: o.monthly_payment })),
      freedom_no_extra: sim0 ? { months: sim0.months, date: sim0.freedomDate, interest: sim0.totalInterest, stuck: sim0.stuck } : null,
      freedom_extra_50k: sim50 ? { months: sim50.months, date: sim50.freedomDate, interest: sim50.totalInterest } : null,
      snowball_first_closure: simSnow?.closures[0] ?? null,
    },
    tasks: {
      inbox_unconfirmed: tasks.filter(t => t.status === 'inbox').length,
      overdue: tasks.filter(t => t.due_date && t.due_date < today).map(t => ({ role: t.role, title: t.title, due: t.due_date })),
      due_today: tasks.filter(t => t.due_date === today).map(t => ({ role: t.role, title: t.title })),
      no_due_date: tasks.filter(t => !t.due_date && t.status === 'active').length,
      by_role: Object.fromEntries([...new Set(tasks.map(t => t.role))].map(r => [r, tasks.filter(t => t.role === r).length])),
      commitments: tasks.filter(t => t.kind === 'commitment').map(t => ({ role: t.role, title: t.title, due: t.due_date })),
    },
    discipline: {
      notes_last_7d: (notesR.data ?? []).length,
      sport_done_days_30d: [...new Set((sportR.data ?? []).filter(s => s.done).map(s => s.day))].length,
    },
  }

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const msg = await anthropic.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 3000,
      system: SYSTEM,
      messages: [{ role: 'user', content: `Снимок (${slot === 'morning' ? 'утро' : 'вечер'}):\n${JSON.stringify(snapshot, null, 1)}` }],
    })
    const text = msg.content.find(b => b.type === 'text')?.text ?? '{}'
    const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as { title?: string; items?: unknown[] }
    const title = String(parsed.title ?? 'Разбор').slice(0, 200)
    const items = (Array.isArray(parsed.items) ? parsed.items : []).flatMap(i => {
      const o = i as Record<string, unknown>
      if (!o.point) return []
      return [{
        point: String(o.point).slice(0, 200),
        detail: String(o.detail ?? ''),
        kind: ['finance', 'tasks', 'discipline', 'idea'].includes(String(o.kind)) ? String(o.kind) : 'idea',
      }]
    })
    if (items.length === 0) throw new Error('Пустой разбор')

    const { error } = await db.from('vlad_advice').insert({ slot, title, items, snapshot })
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true, slot, items: items.length })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'fail' }, { status: 500 })
  }
}
