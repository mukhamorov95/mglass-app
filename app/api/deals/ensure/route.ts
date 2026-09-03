import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { requireDealActor } from '@/lib/b2c/dealScope'
import { phoneKey, samePhone } from '@/lib/b2c/phoneKey'

export const dynamic = 'force-dynamic'

// Единая точка решения «куда деть сохранённый расчёт» при авто-сохранении (переход
// в КП) и вручную. Правило владельца: сделка живёт по ОБЪЕКТУ (адресу), не по человеку.
//
// АВТО-СОЗДАНИЕ ≠ АВТО-СКЛЕЙКА. Создать новую сделку, когда склеивать не с чем —
// безопасно и обратимо. Склеить расчёт в чужую сделку — необратимо на глаз, поэтому
// только через вопрос менеджеру (это UI, PR2b). Здесь:
//   • нет телефона и адреса → осиротевший (черновик), ничего не создаём;
//   • телефон новый (в deals нет такого phone_key) → создаём сделку молча, привязываем (case 3);
//   • телефон совпал (адрес тот же или другой) → НЕ склеиваем и НЕ плодим: возвращаем
//     ambiguous + кандидатов, решение за человеком (в PR2a расчёт остаётся осиротевшим).

export async function POST(req: NextRequest) {
  const actor = await requireDealActor()
  if (actor instanceof NextResponse) return actor

  const b = await req.json().catch(() => ({})) as {
    calc_id?: number; client_name?: string; phone?: string; address?: string
  }
  const calcId = Number(b.calc_id)
  if (!Number.isFinite(calcId)) return NextResponse.json({ error: 'Нужен calc_id' }, { status: 400 })

  const pk = phoneKey(b.phone)
  const address = (b.address ?? '').trim()

  // Нечем идентифицировать объект → осиротевший черновик.
  if (!pk && !address) return NextResponse.json({ ok: true, created: false, reason: 'no_key' })

  const svc = createServiceClient()

  // Кандидаты для склейки — только среди сделок, доступных актору (свои/все).
  let existing: Record<string, unknown>[] = []
  if (pk) {
    let q = svc.from('deals').select('id, address, client_name, phone, created_by, manager_id').eq('phone_key', pk)
    if (!actor.seeAll) q = q.or(`created_by.eq.${actor.userId},manager_id.eq.${actor.userId}`)
    const { data } = await q
    existing = (data ?? []) as Record<string, unknown>[]
  }

  // Телефон новый (или его нет, но есть адрес) → создаём сделку молча (case 3).
  if (existing.length === 0) {
    const { data, error } = await svc.from('deals').insert({
      client_name: (b.client_name ?? '').trim(),
      phone: (b.phone ?? '').trim(),
      phone_key: pk,
      address,
      manager_id: actor.userId,
      created_by: actor.userId,
      created_by_name: actor.name,
    }).select('id').single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await svc.from('calculations').update({ deal_id: data.id }).eq('id', calcId)
    return NextResponse.json({ ok: true, created: true, dealId: data.id })
  }

  // Телефон совпал → неоднозначность, решает человек (PR2b покажет вопрос).
  // Не склеиваем и не создаём второй объект молча.
  const exactByAddress = address ? existing.find(d => String(d.address ?? '').trim().toLowerCase() === address.toLowerCase()) : null
  return NextResponse.json({
    ok: true,
    created: false,
    ambiguous: true,
    exactAddressMatch: exactByAddress ? Number(exactByAddress.id) : null,
    candidates: existing.map(d => ({ id: Number(d.id), address: String(d.address ?? ''), client_name: String(d.client_name ?? '') })),
    samePhone: existing.length > 0 && samePhone(b.phone, String(existing[0].phone ?? '')),
  })
}
