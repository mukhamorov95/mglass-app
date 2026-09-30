import { NextResponse } from 'next/server'
import { amoGet, getPipelines, getDomain } from '@/lib/amocrm'
import { AMO_CLOSED_STATUSES } from '@/lib/amoLead'
import { getAmoViewer, linkedWork } from '@/lib/amoViewer'

// Мои открытые сделки AmoCRM — список, из которого расчёт делается одним нажатием.
// Свежие сверху: менеджер обычно считает то, с чем работал сегодня. AmoCRM только читаем.

type Lead = { id: number; name: string; price?: number | null; status_id: number; pipeline_id: number; updated_at: number; closed_at: number | null }
const LIMIT = 30

export async function GET() {
  const viewer = await getAmoViewer()
  if ('error' in viewer) return NextResponse.json({ error: viewer.error }, { status: viewer.status })
  if (!viewer.amoUserId) return NextResponse.json({ error: 'amo_not_configured' }, { status: 200 })

  let leads: Lead[]
  let pipelines: Awaited<ReturnType<typeof getPipelines>>
  try {
    const [data, p] = await Promise.all([
      amoGet<{ _embedded?: { leads?: Lead[] } }>('/leads', {
        'filter[responsible_user_id]': String(viewer.amoUserId),
        'order[updated_at]': 'desc',
        limit: '100',
      }),
      getPipelines(),
    ])
    leads = (data?._embedded?.leads ?? []).filter(l => l.closed_at == null && !AMO_CLOSED_STATUSES.has(l.status_id)).slice(0, LIMIT)
    pipelines = p
  } catch (e) {
    return NextResponse.json({ error: `AmoCRM не ответила: ${(e as Error).message}` }, { status: 502 })
  }

  const stageName = (l: Lead) => pipelines.find(p => p.id === l.pipeline_id)?._embedded.statuses.find(s => s.id === l.status_id)?.name ?? null
  const work = await linkedWork(leads.map(l => l.id))
  const domain = getDomain()

  return NextResponse.json({
    leads: leads.map(l => ({
      id: l.id,
      name: l.name,
      price: l.price ?? null,
      stageName: stageName(l),
      updatedAt: new Date(l.updated_at * 1000).toISOString(),
      url: `https://${domain}/leads/detail/${l.id}`,
      calcs: work.calcs.filter(c => c.amo_lead_id === l.id).length,
      kps: work.kps.filter(k => k.amo_lead_id === l.id).length,
      lastKpId: work.kps.find(k => k.amo_lead_id === l.id)?.id ?? null,
    })),
    workError: work.error,
  })
}
