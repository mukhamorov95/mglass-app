import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { parseStatement, dedupe } from '@/lib/bank/parseStatement'

// Б9: загрузка банковской выписки и разнесение её по фондам.
// Строка выписки — кандидат, а не операция: ДДС рождается только после
// подтверждения бухгалтером. Подсказки берём из истории (как разносили этого
// же контрагента) и из одобренных заявок на оплату той же суммы.

export const maxDuration = 120

const FIN_ROLES = ['accountant', 'cfo', 'admin', 'ceo'] as const

// Банки отдают 1С-обмен в windows-1251; utf-8 распознаём по отсутствию «замен».
async function decode(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer())
  const utf = new TextDecoder('utf-8').decode(buf)
  if (!utf.includes('�')) return utf
  try { return new TextDecoder('windows-1251').decode(buf) } catch { return utf }
}

async function whoAmI() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  const { data: me } = await sb.from('users').select('name').eq('id', user?.id ?? '').maybeSingle()
  return {
    id: user?.id ?? null,
    name: (me as { name?: string } | null)?.name ?? user?.email ?? 'бухгалтерия',
  }
}

export async function POST(req: NextRequest) {
  const guard = await requireRole([...FIN_ROLES])
  if (guard instanceof NextResponse) return guard

  const form = await req.formData().catch(() => null)
  const file = form?.get('file') as File | null
  const unit = String(form?.get('unit') ?? 'ip') === 'ooo' ? 'ooo' : 'ip'
  if (!file) return NextResponse.json({ error: 'Нужен файл выписки' }, { status: 400 })

  const parsed = parseStatement(await decode(file))
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const me = await whoAmI()
  const batch = `bank_${file.name}`.slice(0, 80)
  const rows = dedupe(parsed.rows).map(r => ({
    unit, external_key: r.externalKey, doc_no: r.docNo, op_date: r.date,
    amount: r.amount, direction: r.direction, counterparty: r.counterparty,
    inn: r.inn, purpose: r.purpose, account: r.account,
    import_batch: batch, imported_by: me.name,
  }))

  const svc = createServiceClient()
  // ignoreDuplicates: повторная загрузка того же периода не трогает уже
  // разнесённые строки — иначе статус «проведено» слетал бы на «новая».
  const { error, count } = await svc.from('bank_statement_rows')
    .upsert(rows, { onConflict: 'unit,external_key', ignoreDuplicates: true, count: 'exact' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    ok: true, format: parsed.format, parsed: rows.length,
    added: count ?? 0, duplicates: rows.length - (count ?? 0),
  })
}

export async function GET(req: NextRequest) {
  const guard = await requireRole([...FIN_ROLES])
  if (guard instanceof NextResponse) return guard

  const url = new URL(req.url)
  const unit = url.searchParams.get('unit') === 'ooo' ? 'ooo' : 'ip'
  const status = url.searchParams.get('status') ?? 'new'

  const svc = createServiceClient()
  const { data: rows } = await svc.from('bank_statement_rows')
    .select('*').eq('unit', unit).eq('status', status)
    .order('op_date', { ascending: false }).limit(400)

  // Как этого контрагента разносили раньше
  const { data: history } = await svc.from('cashflow_entries')
    .select('kind,fund_id,subfund_id,account,counterparty')
    .eq('unit', unit).not('counterparty', 'is', null)
    .order('id', { ascending: false }).limit(600)
  type Hist = { kind: string; fund_id: number; subfund_id: number | null; account: string | null; counterparty: string | null }
  const byCp = new Map<string, Hist>()
  for (const h of (history ?? []) as Hist[]) {
    const k = `${h.kind}|${(h.counterparty ?? '').trim().toLowerCase()}`
    if (!byCp.has(k)) byCp.set(k, h)
  }

  // Одобренные заявки — кандидаты на «этот расход уже согласован»
  const { data: reqs } = await svc.from('payment_requests')
    .select('id,amount,counterparty,fund_id,subfund_id,status,desired_date')
    .eq('unit', unit).in('status', ['approved', 'pending']).limit(300)

  const items = (rows ?? []).map(r => {
    const cp = (r.counterparty ?? '').trim().toLowerCase()
    const hist = byCp.get(`${r.direction}|${cp}`) ?? null
    const match = r.direction === 'out'
      ? (reqs ?? []).find(q =>
          Math.abs(Number(q.amount) - Number(r.amount)) < 0.5 &&
          (!q.counterparty || !cp || q.counterparty.trim().toLowerCase().slice(0, 12) === cp.slice(0, 12)))
      : null
    return {
      ...r,
      suggest: hist
        ? { fund_id: hist.fund_id, subfund_id: hist.subfund_id, account: hist.account, from: 'история' as const }
        : match
          ? { fund_id: match.fund_id, subfund_id: match.subfund_id, account: null, from: 'заявка' as const }
          : null,
      request: match ? { id: Number(match.id), status: match.status as string } : null,
    }
  })

  return NextResponse.json({ items })
}

export async function PATCH(req: NextRequest) {
  const guard = await requireRole([...FIN_ROLES])
  if (guard instanceof NextResponse) return guard

  const me = await whoAmI()
  const body = await req.json().catch(() => ({}))
  const id = Number(body.id)
  const action = String(body.action ?? 'post')
  if (!(id > 0)) return NextResponse.json({ error: 'Нет строки' }, { status: 400 })

  const svc = createServiceClient()
  const { data: row } = await svc.from('bank_statement_rows').select('*').eq('id', id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'Строка не найдена' }, { status: 404 })

  if (action === 'skip') {
    await svc.from('bank_statement_rows').update({ status: 'skipped' }).eq('id', id)
    return NextResponse.json({ ok: true })
  }
  if (action === 'unskip') {
    await svc.from('bank_statement_rows').update({ status: 'new' }).eq('id', id)
    return NextResponse.json({ ok: true })
  }
  if (row.status === 'posted') return NextResponse.json({ error: 'Уже проведена' }, { status: 409 })

  const fundId = Number(body.fund_id)
  if (!(fundId > 0)) return NextResponse.json({ error: 'Выберите фонд' }, { status: 400 })

  const { data: entry, error } = await svc.from('cashflow_entries').insert({
    entry_date: row.op_date, unit: row.unit, kind: row.direction, fund_id: fundId,
    subfund_id: Number(body.subfund_id) || null, amount: Number(row.amount),
    account: String(body.account ?? row.account ?? '').trim() || null,
    counterparty: row.counterparty,
    comment: (row.purpose as string | null)?.slice(0, 300) ?? null,
    entered_by: me.id, entered_by_name: me.name,
  }).select('id').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const requestId = Number(body.request_id) || null
  if (requestId) {
    // Заявка закрывается фактом платежа из банка — руками её больше не отмечают
    await svc.from('payment_requests').update({
      status: 'paid', entry_id: entry.id, status_changed_at: new Date().toISOString(),
      status_changed_by: me.name, updated_at: new Date().toISOString(),
    }).eq('id', requestId)
  }

  await svc.from('bank_statement_rows')
    .update({ status: 'posted', entry_id: entry.id, request_id: requestId }).eq('id', id)

  return NextResponse.json({ ok: true, entry_id: entry.id })
}
