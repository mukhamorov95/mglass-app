import { NextResponse, type NextRequest } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { createServiceClient } from '@/lib/supabase-service'
import { buildMarginAudit, type AuditOrderInput, type MarginThresholds } from '@/lib/b2b/marginAudit'
import type { SavedItemLike } from '@/lib/b2b/bomCheck'

// Аудит маржи по сохранённым просчётам. Себестоимость и маржа — чувствительные,
// поэтому строго owner-tier + логист-закупщик; менеджеру и наружу не отдаём.
const ALLOWED = ['admin', 'ceo', 'buyer'] as const

function parseNotes(n: unknown): Record<string, unknown> {
  if (!n) return {}
  if (typeof n === 'object') return n as Record<string, unknown>
  try { const p = JSON.parse(String(n)); return typeof p === 'object' && p ? p as Record<string, unknown> : {} } catch { return {} }
}

export async function GET(req: NextRequest) {
  const guard = await requireRole([...ALLOWED])
  if (guard instanceof NextResponse) return guard

  const sp = req.nextUrl.searchParams
  const now = new Date()
  const defFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.get('from') || '') ? sp.get('from')! : defFrom
  const to   = /^\d{4}-\d{2}-\d{2}$/.test(sp.get('to') || '')   ? sp.get('to')!   : now.toISOString().slice(0, 10)

  const supa = createServiceClient()

  // Пороги — из financial_settings, не зашиты в код. Берём базовый standard-профиль
  // (product_type IS NULL): B2B-просчёт смешивает изделия, единый ориентир корректнее.
  const { data: fs } = await supa
    .from('financial_settings')
    .select('default_margin, green_threshold, yellow_threshold, product_type, tier')
    .is('product_type', null)
    .eq('tier', 'standard')
    .maybeSingle()

  const t: MarginThresholds = {
    target: Number(fs?.default_margin) || 40,
    green:  Number(fs?.green_threshold) || 35,
    yellow: Number(fs?.yellow_threshold) || 25,
  }

  const { data, error } = await supa
    .from('b2b_orders')
    .select('id, created_at, client_id, client_name, discount_percent, margin_percent, total_cost_net, total_sale_inc_vat, total_after_discount, created_by_name, items, notes')
    .is('archived_at', null)
    .gte('created_at', `${from}T00:00:00`)
    .lte('created_at', `${to}T23:59:59`)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const inputs: AuditOrderInput[] = (data ?? [])
    .filter(o => Number(o.total_after_discount) > 0 && Number(o.total_cost_net) > 0)
    .map(o => {
      const notes = parseNotes(o.notes)
      const managerName = (o.created_by_name as string) || (notes.manager_name as string) || null
      return {
        id: o.id,
        createdAt: o.created_at,
        clientId: o.client_id,
        clientName: o.client_name || '—',
        managerName,
        discountPercent: Number(o.discount_percent) || 0,
        totalCostNet: Number(o.total_cost_net) || 0,
        totalSaleIncVat: Number(o.total_sale_inc_vat) || 0,
        totalAfterDiscount: Number(o.total_after_discount) || 0,
        items: Array.isArray(o.items) ? (o.items as SavedItemLike[]) : [],
      }
    })

  const report = buildMarginAudit(inputs, t)
  return NextResponse.json({ ...report, thresholds: t, from, to })
}
