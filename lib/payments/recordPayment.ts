import type { SupabaseClient } from '@supabase/supabase-js'
import { buildPaymentRow, type PaymentInput } from './paymentKeys'

// ЕДИНСТВЕННЫЙ писатель таблицы payments (docs/ERP_MONEY_ARCHITECTURE.md §3).
// Идемпотентность: upsert по external_key — повторный вызов с тем же ключом
// обновляет строку, а не плодит дубль. Платежи не удаляются: voidPayment.
// Вызывается ТОЛЬКО с service-role (RLS insert-политик нет — это защита).

export async function recordPayment(svc: SupabaseClient, input: PaymentInput): Promise<{ id: number } | null> {
  const row = buildPaymentRow(input)
  const { data, error } = await svc
    .from('payments')
    .upsert(row, { onConflict: 'external_key' })
    .select('id')
    .single()
  if (error) throw new Error(`recordPayment(${input.externalKey}): ${error.message}`)
  return data as { id: number } | null
}

// «Оплату сняли»: строка остаётся с voided_at (история не исчезает).
export async function voidPayment(svc: SupabaseClient, externalKey: string, voidedBy?: string): Promise<void> {
  const { error } = await svc.from('payments')
    .update({ voided_at: new Date().toISOString(), voided_by: voidedBy ?? null, updated_at: new Date().toISOString() })
    .eq('external_key', externalKey)
    .is('voided_at', null)
  if (error) throw new Error(`voidPayment(${externalKey}): ${error.message}`)
}

// Обратное снятие void (галочку вернули)
export async function unvoidPayment(svc: SupabaseClient, externalKey: string): Promise<void> {
  const { error } = await svc.from('payments')
    .update({ voided_at: null, voided_by: null, updated_at: new Date().toISOString() })
    .eq('external_key', externalKey)
  if (error) throw new Error(`unvoidPayment(${externalKey}): ${error.message}`)
}
