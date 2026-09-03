import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { requireDealActor } from '@/lib/b2c/dealScope'
import { phoneKey } from '@/lib/b2c/phoneKey'

export const dynamic = 'force-dynamic'

// Список сделок B2C + создание. Доступ и скоуп — через requireDealActor (общий
// helper для всех /api/deals*). Читаем/пишем сервис-клиентом, скоуп режем в коде,
// RLS на deals — защита в глубину.

const DEAL_COLS = 'id, client_name, phone, phone_key, address, manager_id, amo_lead_id, created_by, created_by_name, created_at, updated_at'

export async function GET(req: NextRequest) {
  const actor = await requireDealActor()
  if (actor instanceof NextResponse) return actor
  const svc = createServiceClient()

  let q = svc.from('deals').select(DEAL_COLS).order('updated_at', { ascending: false }).limit(500)
  if (!actor.seeAll) q = q.or(`created_by.eq.${actor.userId},manager_id.eq.${actor.userId}`)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let deals = (data ?? []) as Record<string, unknown>[]
  const search = req.nextUrl.searchParams.get('q')?.trim().toLowerCase()
  if (search) {
    // Поиск по телефону (нормализованный ключ), адресу и имени — владелец просил
    // именно телефон и адрес: через полгода помнят «квартиру на Лётной», не номер.
    const pk = phoneKey(search)
    deals = deals.filter(d =>
      (pk && String(d.phone_key ?? '').includes(pk)) ||
      String(d.address ?? '').toLowerCase().includes(search) ||
      String(d.client_name ?? '').toLowerCase().includes(search) ||
      String(d.phone ?? '').toLowerCase().includes(search))
  }

  // Счётчик расчётов на сделку — для списка (сколько просчётов по объекту).
  const ids = deals.map(d => Number(d.id))
  const counts = new Map<number, number>()
  if (ids.length) {
    const { data: calcs } = await svc.from('calculations').select('deal_id').in('deal_id', ids)
    for (const c of (calcs ?? []) as { deal_id: number | null }[]) {
      if (c.deal_id != null) counts.set(c.deal_id, (counts.get(c.deal_id) ?? 0) + 1)
    }
  }
  // «Требуют привязки»: сохранённые расчёты без сделки, но с клиентом/телефоном —
  // чтобы у постоянных клиентов (телефон совпал → пока осиротел) они были ВИДНЫ и
  // привязывались руками, а не искались. Черновики совсем без клиента сюда не тянем.
  let orphanQ = svc.from('calculations')
    .select('id, product_type, final_price, created_at, created_by, client_name, client_phone')
    .is('deal_id', null)
    .order('created_at', { ascending: false })
    .limit(200)
  if (!actor.seeAll) orphanQ = orphanQ.eq('created_by', actor.userId)
  const { data: orphanRaw } = await orphanQ
  // Только расчёты с клиентом/телефоном (по ним есть что привязать); NULL-безопасно
  // фильтруем в коде, не хрупким PostgREST .neq.
  const orphans = ((orphanRaw ?? []) as Record<string, unknown>[])
    .filter(c => String(c.client_phone ?? '').trim() || String(c.client_name ?? '').trim())
    .slice(0, 100)

  return NextResponse.json({
    deals: deals.map(d => ({ ...d, calc_count: counts.get(Number(d.id)) ?? 0 })),
    orphans,
    seeAll: actor.seeAll,
  }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest) {
  const actor = await requireDealActor()
  if (actor instanceof NextResponse) return actor
  const b = await req.json().catch(() => ({})) as {
    client_name?: string; phone?: string; address?: string; calc_id?: number; amo_lead_id?: string
  }
  const svc = createServiceClient()
  const { data, error } = await svc.from('deals').insert({
    client_name: (b.client_name ?? '').trim(),
    phone: (b.phone ?? '').trim(),
    phone_key: phoneKey(b.phone),
    address: (b.address ?? '').trim(),
    manager_id: actor.userId,
    amo_lead_id: b.amo_lead_id?.trim() || null,
    created_by: actor.userId,
    created_by_name: actor.name,
  }).select('id').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Создали из расчёта → сразу привязываем его к сделке.
  if (b.calc_id) {
    await svc.from('calculations').update({ deal_id: data.id }).eq('id', b.calc_id)
  }
  return NextResponse.json({ ok: true, id: data.id })
}
