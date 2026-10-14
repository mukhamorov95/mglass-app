import type { SupabaseClient } from '@supabase/supabase-js'
import { readPaged } from '@/lib/money/paged'
import { EXECUTOR, SELLER_B2B } from '@/lib/companyRequisites'
import { matchInvoice, matchOrder, orderIdsIn } from './bankMatch'
import { applyBankOrderPayment, applyBankPayment, loadOpenInvoices, loadOpenOrders, type BankRow } from './bankPost'

// Оплата заказа по выписке — без человека. Только уверенные совпадения (номер счёта и сумма
// счёта или итога заказа; номер заказа без счёта и сумма — см. bankMatch); спорные — бухгалтеру. Операция ДДС здесь не создаётся: строка
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

  const candidates = rows.filter(r => !isOwnTransfer(r.inn) && !isLoan(r.purpose))
  const [open, openOrders] = await Promise.all([
    loadOpenInvoices(svc),
    loadOpenOrders(svc, [...new Set(candidates.flatMap(r => orderIdsIn(r.purpose)))]),
  ])
  const by = uploader ? `, загрузил(а) ${uploader}` : ''
  const less = (v: number, a: number) => Math.max(0, Math.round((v - a) * 100) / 100)

  for (const r of candidates) {
    const amount = Number(r.amount)
    const bank = { amount, inn: r.inn, purpose: r.purpose }
    const m = matchInvoice(bank, open)
    const mo = m?.strong ? null : matchOrder(bank, openOrders)
    if (!m?.strong && !mo) continue
    const no = m?.strong ? m.invoice.no : `заказ ${mo!.order.no}`
    if (opts.dry) {
      out.planned.push({ rowId: r.id, invoiceNo: no, amount, payer: r.counterparty, marked: m?.strong ? m.invoice.marked ?? 0 : mo!.order.marked })
    } else {
      if (Date.now() - t0 > budgetMs) { out.more = true; break }
      const res = m?.strong
        ? await applyBankPayment(svc, r, m.invoice.id, { id: null, name: null },
          { note: `Автоподбор по выписке: счёт № ${m.invoice.no}${m.byOrder ? ' (оплачен итог заказа)' : ''}${by}`, byOrder: m.byOrder })
        : await applyBankOrderPayment(svc, r, mo!.order.id, { id: null, name: null },
          `Автоподбор по выписке: заказ ${mo!.order.no}, счёта в приложении нет${by}`)
      if (!res.ok) { out.failed.push({ rowId: r.id, error: res.error }); continue }
      const { data: marked, error } = await svc.from('bank_statement_rows')
        .update({ payment_id: res.paymentId, invoice_id: m?.strong ? m.invoice.id : null }).eq('id', r.id).select('id')
      if (error || !marked?.length) {
        out.warnings.push(`Оплата (${no}) записана, но строка выписки не отмечена${error ? `: ${error.message}` : ''}`)
      }
      out.warnings.push(...res.warnings)
      const eff = 'invoice' in res ? res.invoice : res.order
      out.applied.push({ rowId: r.id, invoiceNo: no, amount, partial: eff.partial, replaced: eff.replaced })
    }
    // Следующая строка того же счёта/заказа видит уже уменьшенный остаток
    if (m?.strong) {
      m.invoice.remainder = less(m.invoice.remainder, amount)
      if (m.invoice.orderRemainder != null) m.invoice.orderRemainder = less(m.invoice.orderRemainder, amount)
    } else mo!.order.remainder = less(mo!.order.remainder, amount)
  }
  return out
}
