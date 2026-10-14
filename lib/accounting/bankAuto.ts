import type { SupabaseClient } from '@supabase/supabase-js'
import { readPaged } from '@/lib/money/paged'
import { EXECUTOR, SELLER_B2B } from '@/lib/companyRequisites'
import { matchInvoice } from './bankMatch'
import { applyBankPayment, loadOpenInvoices, type BankRow } from './bankPost'

// Оплата заказа по выписке — без человека. Только уверенные совпадения (номер счёта и сумма,
// см. bankMatch); спорные остаются бухгалтеру. Операция ДДС здесь не создаётся: строка
// остаётся «новой» с проставленным платежом, бухгалтер проводит её в фонд как обычно.
// За один вызов — сколько успеем за budgetMs: запрос идёт через прокси и не должен упереться
// в лимит ответа, остальное доделает следующий вызов (more: true).

const OWN_INNS = new Set<string>([EXECUTOR.inn, SELLER_B2B.inn])

// Свои переводы ИП ↔ ООО и займы — не деньги клиентов: ни счёта, ни оплаты заказа у них нет.
export function isOwnTransfer(inn: string | null | undefined): boolean {
  return !!inn && OWN_INNS.has(inn.trim())
}

export function isLoan(purpose: string | null | undefined): boolean {
  return /за[её]м|займ/i.test(purpose ?? '')
}

export type AutoResult = {
  applied: { rowId: number; invoiceNo: string; amount: number; partial: boolean; replaced: number }[]
  // dry: что было бы проставлено — без записи (проверка на проде до первого прогона)
  planned: { rowId: number; invoiceNo: string; amount: number; payer: string | null; marked: number }[]
  failed: { rowId: number; error: string }[]
  warnings: string[]
  more: boolean
}

type Row = BankRow & { inn: string | null; payment_id: number | null }

export async function autoApplyBank(
  svc: SupabaseClient, unit: 'ip' | 'ooo', uploader: string | null, opts: { budgetMs?: number; dry?: boolean } = {},
): Promise<AutoResult> {
  const t0 = Date.now()
  const budgetMs = opts.budgetMs ?? 12000
  const out: AutoResult = { applied: [], planned: [], failed: [], warnings: [], more: false }
  const rows = (await readPaged(() => svc.from('bank_statement_rows')
    .select('id, unit, external_key, op_date, amount, direction, counterparty, purpose, account, status, inn, payment_id')
    .eq('unit', unit).eq('status', 'new').eq('direction', 'in').is('payment_id', null)
    .order('op_date').order('id'))) as unknown as Row[]
  if (rows.length === 0) return out

  const open = await loadOpenInvoices(svc)
  for (const r of rows) {
    if (isOwnTransfer(r.inn) || isLoan(r.purpose)) continue
    const m = matchInvoice({ amount: Number(r.amount), inn: r.inn, purpose: r.purpose }, open)
    if (!m?.strong) continue
    if (opts.dry) {
      out.planned.push({ rowId: r.id, invoiceNo: m.invoice.no, amount: Number(r.amount), payer: r.counterparty, marked: m.invoice.marked ?? 0 })
      m.invoice.remainder = Math.max(0, Math.round((m.invoice.remainder - Number(r.amount)) * 100) / 100)
      continue
    }
    if (Date.now() - t0 > budgetMs) { out.more = true; break }

    const res = await applyBankPayment(svc, r, m.invoice.id, { id: null, name: null },
      `Автоподбор по выписке: счёт № ${m.invoice.no}${uploader ? `, загрузил(а) ${uploader}` : ''}`)
    if (!res.ok) { out.failed.push({ rowId: r.id, error: res.error }); continue }
    const { data: marked, error } = await svc.from('bank_statement_rows')
      .update({ payment_id: res.paymentId, invoice_id: m.invoice.id }).eq('id', r.id).select('id')
    if (error || !marked?.length) {
      out.warnings.push(`Оплата по счёту № ${res.invoice.no} записана, но строка выписки не отмечена${error ? `: ${error.message}` : ''}`)
    }
    out.warnings.push(...res.warnings)
    out.applied.push({ rowId: r.id, invoiceNo: res.invoice.no, amount: Number(r.amount), partial: res.invoice.partial, replaced: res.invoice.replaced })
    // Следующая строка того же счёта видит уже уменьшенный остаток
    m.invoice.remainder = Math.max(0, Math.round((m.invoice.remainder - Number(r.amount)) * 100) / 100)
  }
  return out
}
