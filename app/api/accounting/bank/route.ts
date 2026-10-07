import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { FIN_ROLES } from '@/lib/accounting/roles'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { parseStatement, dedupe } from '@/lib/bank/parseStatement'
import { loadOpenInvoices, postBankRow, type BankRow } from '@/lib/accounting/bankPost'
import { matchInvoice, type OpenInvoice } from '@/lib/accounting/bankMatch'

// Б9: загрузка банковской выписки и разнесение её по фондам.
// Строка выписки — кандидат, а не операция: ДДС рождается только после
// подтверждения бухгалтером. Подсказки берём из истории (как разносили этого
// же контрагента) и из одобренных заявок на оплату той же суммы.

export const maxDuration = 120


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

  // Сверка с итогами банка: сумма разобранных строк должна совпасть с
  // ВсегоПоступило/ВсегоСписано из выписки. Расхождение = парсер что-то пропустил.
  const inSum = round2(parsed.rows.filter(r => r.direction === 'in').reduce((s, r) => s + r.amount, 0))
  const outSum = round2(parsed.rows.filter(r => r.direction === 'out').reduce((s, r) => s + r.amount, 0))
  const bank = parsed.balances[0] ?? null
  const reconcile = bank && bank.credit != null && bank.debit != null
    ? {
        ok: Math.abs(inSum - bank.credit) < 0.01 && Math.abs(outSum - bank.debit) < 0.01,
        bankIn: bank.credit, bankOut: bank.debit, parsedIn: inSum, parsedOut: outSum,
        opening: bank.opening, closing: bank.closing, account: bank.account,
      }
    : null

  return NextResponse.json({
    ok: true, format: parsed.format, parsed: rows.length,
    added: count ?? 0, duplicates: rows.length - (count ?? 0),
    empty: rows.length === 0, reconcile,
  })
}

const round2 = (v: number) => Math.round(v * 100) / 100

export async function GET(req: NextRequest) {
  const guard = await requireRole([...FIN_ROLES])
  if (guard instanceof NextResponse) return guard

  const url = new URL(req.url)
  const unit = url.searchParams.get('unit') === 'ooo' ? 'ooo' : 'ip'
  const status = url.searchParams.get('status') ?? 'new'

  const svc = createServiceClient()
  const { data: rows, error: rowsErr } = await svc.from('bank_statement_rows')
    .select('*').eq('unit', unit).eq('status', status)
    .order('op_date', { ascending: false }).limit(400)
  if (rowsErr) return NextResponse.json({ error: `Выписка не прочитана: ${rowsErr.message}` }, { status: 500 })

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

  // Приход ищем среди неоплаченных по платежам счетов: ИНН плательщика, номер счёта в
  // назначении и сумма против ОСТАТКА. Сбой чтения счетов — не пустой подбор, а ошибка словами.
  let open: OpenInvoice[] = []
  let invoicesError: string | null = null
  if (status === 'new') {
    try { open = await loadOpenInvoices(svc) } catch (e) {
      invoicesError = e instanceof Error ? e.message : String(e)
    }
  }
  // Проведённые строки показывают свой счёт, даже если он уже оплачен
  const linkedIds = status === 'new' ? [] : [...new Set((rows ?? []).map(r => Number(r.invoice_id)).filter(n => n > 0))]
  const { data: linked } = linkedIds.length
    ? await svc.from('invoices').select('id,invoice_no,payer_name,amount,order_ids').in('id', linkedIds)
    : { data: [] }
  const linkedBy = new Map((linked ?? []).map(i => [Number(i.id), i]))

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
    const auto = r.direction === 'in' && status === 'new'
      ? matchInvoice({ amount: Number(r.amount), inn: r.inn ?? null, purpose: r.purpose ?? null }, open)
      : null
    const had = linkedBy.get(Number(r.invoice_id))
    return {
      ...r,
      invoice: auto
        ? { ...auto.invoice, partial: auto.partial, rest: auto.rest, over: auto.over }
        : had
          ? { id: Number(had.id), no: String(had.invoice_no), payer: (had.payer_name as string | null) ?? null, amount: Number(had.amount), orders: (had.order_ids as number[]) ?? [] }
          : null,
      suggest: hist
        ? { fund_id: hist.fund_id, subfund_id: hist.subfund_id, account: hist.account, from: 'история' as const }
        : match
          ? { fund_id: match.fund_id, subfund_id: match.subfund_id, account: null, from: 'заявка' as const }
          : null,
      request: match ? { id: Number(match.id), status: match.status as string } : null,
    }
  })

  return NextResponse.json({ items, invoices: open, invoicesError })
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
  const { data: row, error: rowErr } = await svc.from('bank_statement_rows').select('*').eq('id', id).maybeSingle()
  if (rowErr) return NextResponse.json({ error: `Строка не прочитана: ${rowErr.message}` }, { status: 500 })
  if (!row) return NextResponse.json({ error: 'Строка не найдена' }, { status: 404 })

  if (action === 'skip' || action === 'unskip') {
    if (row.status === 'posted') return NextResponse.json({ error: 'Строка уже проведена' }, { status: 409 })
    const { data, error } = await svc.from('bank_statement_rows')
      .update({ status: action === 'skip' ? 'skipped' : 'new' }).eq('id', id).select('id')
    if (error || !data?.length) return NextResponse.json({ error: error?.message ?? 'Строка не обновилась' }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  const fundId = Number(body.fund_id)
  if (!(fundId > 0)) return NextResponse.json({ error: 'Выберите фонд' }, { status: 400 })

  const res = await postBankRow(svc, row as BankRow, {
    fundId,
    subfundId: Number(body.subfund_id) || null,
    account: String(body.account ?? '').trim() || null,
    requestId: Number(body.request_id) || null,
    invoiceId: Number(body.invoice_id) || null,
  }, me)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ ok: true, entry_id: res.entryId, payment_id: res.paymentId, invoice: res.invoice, warnings: res.warnings })
}
