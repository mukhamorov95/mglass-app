import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

const AMO_BASE = `https://${process.env.AMO_SUBDOMAIN}.amocrm.ru/api/v4`
const AMO_TOKEN = process.env.AMO_ACCESS_TOKEN!
const SALES_PIPELINE_ID = 1654237

const MANAGERS: Record<number, string> = {
  1593673:  'Яна',
  8272804:  'Алина',
  8352283:  'Владислав',
  11127302: 'Александра',
  13677554: 'Семён',
  9309142:  'Нуржан',
  9811890:  'Артём',
  11789378: 'Гузель',
  12273478: 'Любовь',
  8114644:  'Сергей',
  8272783:  'Дима',
}

// Map raw tag names → canonical source group
const SOURCE_GROUPS: { pattern: RegExp; label: string }[] = [
  { pattern: /авито/i,               label: 'Авито' },
  { pattern: /wz|wazzup|whatsapp|вацап/i, label: 'WhatsApp' },
  { pattern: /сайт|mglass|стеклянн/i, label: 'Сайт' },
  { pattern: /инстаграм|instagram|inst/i, label: 'Instagram' },
  { pattern: /vk|вконтакте/i,        label: 'ВКонтакте' },
  { pattern: /дизайнер|дизайн/i,     label: 'Дизайнеры' },
  { pattern: /партнёр|партнер/i,     label: 'Партнёры' },
  { pattern: /повтор/i,              label: 'Повторный' },
  { pattern: /перехват/i,            label: 'Перехват' },
  { pattern: /звонок|call/i,         label: 'Звонок' },
  { pattern: /яндекс|yandex/i,       label: 'Яндекс' },
]

function getSource(tags: string[]): string {
  for (const tag of tags) {
    for (const g of SOURCE_GROUPS) {
      if (g.pattern.test(tag)) return g.label
    }
  }
  // If no pattern matched but there's a tag — use the raw tag name
  if (tags.length) return tags[0]
  return 'Без источника'
}

async function fetchAllLeads(from: number, to: number) {
  let page = 1
  const all: any[] = []
  while (true) {
    const res = await fetch(
      `${AMO_BASE}/leads?filter[pipeline_id]=${SALES_PIPELINE_ID}&filter[created_at][from]=${from}&filter[created_at][to]=${to}&with=tags&limit=250&page=${page}`,
      { headers: { Authorization: `Bearer ${AMO_TOKEN}` }, cache: 'no-store' }
    )
    if (!res.ok || res.status === 204) break
    const data = await res.json()
    const leads = data?._embedded?.leads ?? []
    if (!leads.length) break
    all.push(...leads)
    if (leads.length < 250) break
    page++
  }
  return all
}

type SourceStat = { total: number; won: number; lost: number; active: number }
type ManagerStat = {
  name: string
  total: number
  byDay: Record<string, number>
  lost: number
  won: number
  active: number
}

export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const from = parseInt(searchParams.get('from') || String(Math.floor(monthStart.getTime() / 1000)))
  const to   = parseInt(searchParams.get('to')   || String(Math.floor(now.getTime() / 1000)))

  const leads = await fetchAllLeads(from, to)

  const byManager: Record<number, ManagerStat> = {}
  const bySource:  Record<string, SourceStat>  = {}

  for (const lead of leads) {
    const mid: number = lead.responsible_user_id
    const tags: string[] = (lead._embedded?.tags ?? []).map((t: any) => String(t.name))
    const source = getSource(tags)
    const won  = lead.status_id === 142
    const lost = lead.status_id === 143

    // — by manager —
    if (!byManager[mid]) {
      byManager[mid] = { name: MANAGERS[mid] || `ID ${mid}`, total: 0, byDay: {}, lost: 0, won: 0, active: 0 }
    }
    const m = byManager[mid]
    m.total++
    const day = new Date(lead.created_at * 1000).toISOString().slice(0, 10)
    m.byDay[day] = (m.byDay[day] || 0) + 1
    if (lost) m.lost++; else if (won) m.won++; else m.active++

    // — by source —
    if (!bySource[source]) bySource[source] = { total: 0, won: 0, lost: 0, active: 0 }
    bySource[source].total++
    if (lost) bySource[source].lost++
    else if (won) bySource[source].won++
    else bySource[source].active++
  }

  for (const m of Object.values(byManager)) {
    m.byDay = Object.fromEntries(Object.entries(m.byDay).sort())
  }

  return NextResponse.json({ managers: byManager, sources: bySource, total: leads.length, from, to })
}
