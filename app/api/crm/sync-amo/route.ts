import { NextResponse } from 'next/server'
import { requireOwner } from '@/lib/apiAuth'
import { createServiceClient } from '@/lib/supabase-service'
import { amoGetAll, getPipelines, getUsers, type AmoLead } from '@/lib/amocrm'

// Зеркало активных сделок воронки «Продажи» из AmoCRM в нашу CRM (crm_leads).
// AmoCRM — ТОЛЬКО ЧТЕНИЕ. Дедуп по amo_lead_id; повторный запуск обновляет
// этап/ответственного/сумму (amo — источник правды, пока работаем параллельно).
// Массовая запись — только по кнопке владельца (requireOwner).

export const maxDuration = 120

export async function POST() {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard

  const pipelines = await getPipelines()
  const sales = pipelines.find(p => /продаж/i.test(p.name))
  if (!sales) return NextResponse.json({ error: 'Воронка «Продажи» не найдена в AmoCRM' }, { status: 400 })
  const stageById = new Map(sales._embedded.statuses.map(s => [s.id, s.name]))

  const users = await getUsers()
  const userById = new Map(users.map(u => [u.id, u.name]))

  const all = await amoGetAll<AmoLead & { price?: number }>(
    '/leads', { 'filter[pipeline_id]': String(sales.id) }, 'leads',
  )
  // Активные — не «успешно реализовано» (142) и не «закрыто/не реализовано» (143)
  const active = all.filter(l => l.status_id !== 142 && l.status_id !== 143)
  if (!active.length) return NextResponse.json({ ok: true, total: 0, new: 0, updated: 0 })

  const sb = createServiceClient()
  const ids = active.map(l => l.id)
  const existingRows: { amo_lead_id: number }[] = []
  for (let i = 0; i < ids.length; i += 500) {
    const { data } = await sb.from('crm_leads').select('amo_lead_id').in('amo_lead_id', ids.slice(i, i + 500))
    existingRows.push(...((data ?? []) as { amo_lead_id: number }[]))
  }
  const have = new Set(existingRows.map(r => Number(r.amo_lead_id)))

  const rows = active.map(l => ({
    source: 'manual',
    name: l.name || `Сделка AmoCRM #${l.id}`,
    stage: stageById.get(l.status_id) ?? 'Получена новая заявка',
    est_amount: l.price || null,
    manager: userById.get(l.responsible_user_id) ?? null,
    amo_lead_id: l.id,
    updated_at: new Date().toISOString(),
  }))

  const { error } = await sb.from('crm_leads').upsert(rows, { onConflict: 'amo_lead_id' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Событие «синхронизирован» только на новых лидах
  const newIds = active.filter(l => !have.has(l.id)).map(l => l.id)
  if (newIds.length) {
    const created: { id: number }[] = []
    for (let i = 0; i < newIds.length; i += 500) {
      const { data } = await sb.from('crm_leads').select('id').in('amo_lead_id', newIds.slice(i, i + 500))
      created.push(...((data ?? []) as { id: number }[]))
    }
    const evs = created.map(c => ({ lead_id: c.id, kind: 'system', text: 'Синхронизирован из AmoCRM', author: 'Синхронизация' }))
    for (let i = 0; i < evs.length; i += 500) await sb.from('crm_lead_events').insert(evs.slice(i, i + 500))
  }

  return NextResponse.json({ ok: true, total: active.length, new: newIds.length, updated: active.length - newIds.length })
}
