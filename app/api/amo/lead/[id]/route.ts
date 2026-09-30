import { NextResponse } from 'next/server'
import { canSeeLead, leadIdFrom } from '@/lib/amoLead'
import { getAmoViewer, linkedWork, fetchAmoLeadCard } from '@/lib/amoViewer'

// Карточка сделки AmoCRM для расчёта и КП: клиент, телефон, этап и что по ней уже
// сделано в приложении. AmoCRM только читаем.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getAmoViewer()
  if ('error' in viewer) return NextResponse.json({ error: viewer.error }, { status: viewer.status })

  const { id } = await params
  const leadId = leadIdFrom(decodeURIComponent(id))
  if (!leadId) return NextResponse.json({ error: 'Нужен номер сделки или ссылка на неё' }, { status: 400 })

  let lead
  try {
    lead = await fetchAmoLeadCard(leadId)
  } catch (e) {
    return NextResponse.json({ error: `AmoCRM не ответила: ${(e as Error).message}` }, { status: 502 })
  }
  if (!lead) return NextResponse.json({ error: `Сделки №${leadId} в AmoCRM нет` }, { status: 404 })
  if (!canSeeLead(viewer, lead.responsibleUserId)) {
    return NextResponse.json({ error: 'Это сделка другого менеджера' }, { status: 403 })
  }

  const work = await linkedWork([lead.id])
  return NextResponse.json({ lead, calcs: work.calcs, kps: work.kps, workError: work.error })
}
