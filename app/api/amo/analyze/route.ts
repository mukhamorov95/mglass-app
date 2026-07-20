import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase-server'

const AMO_BASE = `https://${process.env.AMO_SUBDOMAIN}.amocrm.ru/api/v4`
const AMO_TOKEN = process.env.AMO_ACCESS_TOKEN!
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

async function amoGet(path: string) {
  const res = await fetch(`${AMO_BASE}${path}`, {
    headers: { Authorization: `Bearer ${AMO_TOKEN}` },
    cache: 'no-store',
  })
  if (res.status === 204) return null
  if (!res.ok) throw new Error(`AmoCRM ${res.status}: ${path}`)
  return res.json()
}

type AmoLead = { name?: string; price?: number; status_id: number; responsible_user_id: number; updated_at: number }
type AmoPipeline = { id: number; name: string; _embedded?: { statuses?: { id: number; name: string }[] } }
type AmoUser = { id: number; name: string }

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const [page1, page2, pipelinesData, usersData] = await Promise.all([
      amoGet('/leads?limit=250&page=1&with=contacts'),
      amoGet('/leads?limit=250&page=2&with=contacts'),
      amoGet('/leads/pipelines'),
      amoGet('/users'),
    ])

    const allLeads = [
      ...(page1?._embedded?.leads ?? []),
      ...(page2?._embedded?.leads ?? []),
    ]

    // 142 = Won, 143 = Lost in AmoCRM
    const active = allLeads.filter(l => l.status_id !== 142 && l.status_id !== 143)

    const pipelines: AmoPipeline[] = pipelinesData?._embedded?.pipelines ?? []
    const users: AmoUser[] = usersData?._embedded?.users ?? []

    const statusMap: Record<number, string> = {}
    const pipelineMap: Record<number, string> = {}
    for (const p of pipelines) {
      pipelineMap[p.id] = p.name
      for (const s of p._embedded?.statuses ?? []) {
        statusMap[s.id] = s.name
      }
    }

    const userMap: Record<number, string> = {}
    for (const u of users) userMap[u.id] = u.name

    const now = Math.floor(Date.now() / 1000)
    const day = 86400

    const totalValue = active.reduce((s: number, l: AmoLead) => s + (l.price || 0), 0)
    const stale7 = active.filter((l: AmoLead) => now - l.updated_at > 7 * day)
    const stale14 = active.filter((l: AmoLead) => now - l.updated_at > 14 * day)

    const byStage: Record<string, { name: string; count: number; value: number }> = {}
    const byManager: Record<string, { name: string; count: number; value: number; stale: number }> = {}

    for (const l of active) {
      const sid = l.status_id
      const uid = l.responsible_user_id
      const stageName = statusMap[sid] ?? `Этап ${sid}`
      const managerName = userMap[uid] ?? `Менеджер ${uid}`

      if (!byStage[sid]) byStage[sid] = { name: stageName, count: 0, value: 0 }
      byStage[sid].count++
      byStage[sid].value += l.price || 0

      if (!byManager[uid]) byManager[uid] = { name: managerName, count: 0, value: 0, stale: 0 }
      byManager[uid].count++
      byManager[uid].value += l.price || 0
      if (now - l.updated_at > 7 * day) byManager[uid].stale++
    }

    const critical = stale14
      .filter((l: AmoLead) => (l.price || 0) > 30000)
      .sort((a: AmoLead, b: AmoLead) => (b.price || 0) - (a.price || 0))
      .slice(0, 12)
      .map((l: AmoLead) => ({
        name: l.name || 'Без названия',
        value: l.price || 0,
        stage: statusMap[l.status_id] ?? 'Неизвестно',
        manager: userMap[l.responsible_user_id] ?? 'Неизвестно',
        days: Math.floor((now - l.updated_at) / day),
      }))

    const stageList = Object.values(byStage).sort((a, b) => b.value - a.value)
    const managerList = Object.values(byManager).sort((a, b) => b.value - a.value)

    const prompt = `Данные воронки продаж MGlass на сегодня:

ОБЩАЯ КАРТИНА:
- Активных сделок: ${active.length}
- Общая сумма: ${(totalValue / 1000).toFixed(0)} тыс. ₽
- Зависших (7+ дней без активности): ${stale7.length} сделок на ${(stale7.reduce((s: number, l: AmoLead) => s + (l.price || 0), 0) / 1000).toFixed(0)} тыс. ₽
- Критичных (14+ дней): ${stale14.length} сделок

ПО ЭТАПАМ ВОРОНКИ:
${stageList.map(s => `- ${s.name}: ${s.count} сд., ${(s.value / 1000).toFixed(0)} тыс. ₽`).join('\n')}

ПО МЕНЕДЖЕРАМ:
${managerList.map(m => `- ${m.name}: ${m.count} сд., ${(m.value / 1000).toFixed(0)} тыс. ₽, зависших: ${m.stale}`).join('\n')}

КРИТИЧНЫЕ СДЕЛКИ (14+ дней без движения, сумма > 30 тыс.):
${critical.map(d => `- «${d.name}»: ${(d.value / 1000).toFixed(0)} тыс., этап «${d.stage}», ${d.manager}, ${d.days} дн. без движения`).join('\n')}

Дай развёрнутый анализ в двух ролях:

## 💰 Финансовый директор
(оцени финансовое здоровье воронки, риски, реалистичный прогноз закрытия в этом месяце, сколько денег под угрозой)

## 📊 Руководитель отдела продаж
(оцени работу команды, кто отстаёт и почему, конкретные действия на эту неделю по каждому пункту)`

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2500,
      system: `Ты — директор по продажам и CFO MGlass (производство зеркал с подсветкой, лофт-перегородок, душевых).
Говори прямо, конкретно, как человек у которого есть реальная ответственность за результат.
Называй конкретные числа, имена менеджеров, конкретные сделки. Никакой воды.`,
      messages: [{ role: 'user', content: prompt }],
    })

    const analysis = msg.content[0].type === 'text' ? msg.content[0].text : ''

    return NextResponse.json({
      stats: {
        total: active.length,
        totalValue,
        stale7Count: stale7.length,
        stale7Value: stale7.reduce((s: number, l: AmoLead) => s + (l.price || 0), 0),
        stale14Count: stale14.length,
      },
      byStage: stageList,
      byManager: managerList,
      critical,
      analysis,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
