import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { resolvePartnerClient } from '@/lib/partnerClient'
import { paymentsEnabled } from '@/lib/payments/provider'

// Карточка заказа для кабинета. СТРОГО по своему client_id. Отдаём только
// клиентское: позиции (материал/размер/кол-во/цена), стадии производства,
// срок, ссылку на чертёж. Никакой себестоимости/маржи.

const LANE: { key: string; label: string }[] = [
  { key: 'printed', label: 'Чертёж подготовлен' },
  { key: 'material_ordered', label: 'Материал получен' },
  { key: 'cut', label: 'Резка' },
  { key: 'edge', label: 'Полировка кромки' },
  { key: 'drilled', label: 'Сверление' },
  { key: 'tempering', label: 'Закалка' },
  { key: 'packed', label: 'Упаковка' },
]

function parseNotes(n: unknown): Record<string, unknown> {
  if (!n) return {}
  if (typeof n === 'object') return n as Record<string, unknown>
  try { const p = JSON.parse(String(n)); return typeof p === 'object' && p ? p as Record<string, unknown> : {} } catch { return {} }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const oid = Number(id)
  if (!oid) return NextResponse.json({ error: 'Плохой id' }, { status: 400 })

  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const svc = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const client = await resolvePartnerClient<{ id: number; name: string; full_name: string | null; inn: string | null; kpp: string | null; ogrn: string | null; legal_address: string | null; bank_account: string | null; bank_name: string | null; bik: string | null; corr_account: string | null; can_self_invoice: boolean | null }>(
    svc, user.id, 'id, name, full_name, inn, kpp, ogrn, legal_address, bank_account, bank_name, bik, corr_account, can_self_invoice')
  if (!client) return NextResponse.json({ error: 'Аккаунт не привязан' }, { status: 403 })

  const { data: o } = await svc.from('b2b_orders')
    .select('id, client_id, custom_number, client_order_number, created_at, launched_at, discount_percent, total_after_discount, total_sale_inc_vat, items, notes')
    .eq('id', oid).maybeSingle()
  if (!o || o.client_id !== client.id) return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 })

  const pn = parseNotes(o.notes)
  const stages = (pn.stages ?? {}) as Record<string, unknown>
  const launched = !!(o.launched_at || pn.launched_at)
  const shipped = stages.shipped === true
  const packed = stages.packed === true
  const status = (pn.status as string) || 'quote'
  const lane = shipped ? 'shipped' : launched ? 'in_work' : status === 'pending_approval' ? 'submitted' : 'quote'
  const doneN = LANE.filter(s => stages[s.key] === true).length

  // Таймлайн: сделанные этапы (с датой если есть) + текущий/ожидаемые.
  const frontierIdx = LANE.findIndex(s => stages[s.key] !== true)
  const timeline = LANE.map((s, i) => ({
    label: s.label,
    state: stages[s.key] === true ? 'done' : (i === frontierIdx && launched && !shipped ? 'now' : 'wait'),
    date: typeof stages[s.key] === 'string' ? (stages[s.key] as string) : null,
  }))

  const discount = Number(o.discount_percent) || 0
  const rawItems = Array.isArray(o.items) ? (o.items as Record<string, unknown>[]) : []
  const items = rawItems.map(it => {
    const sale = Number(it.saleIncVat ?? 0)
    const price = Number(it.manualTotal ?? Math.round(sale * (1 - discount / 100)))
    return {
      material: String(it.materialName ?? ''),
      thickness: Number(it.thickness ?? 0),
      width: Number(it.width ?? 0),
      height: Number(it.height ?? 0),
      quantity: Number(it.quantity ?? 0),
      tempering: !!it.hasTempering,
      facet: !!it.hasFacet,
      triplex: !!it.hasTriplex,
      price,
    }
  })

  const deadline = pn.deadline_date ? new Date(pn.deadline_date as string).toISOString()
    : pn.launched_at && pn.production_days ? (() => { const d = new Date(pn.launched_at as string); d.setDate(d.getDate() + (pn.production_days as number)); return d.toISOString() })()
    : null

  const history = Array.isArray(pn.status_history) ? pn.status_history : []
  const drawingUrl = typeof pn.drawing_url === 'string' && pn.drawing_url ? `/api/b2b/drawing/${o.id}` : null
  const da = pn.drawing_approval as { status?: string; comment?: string | null; at?: string } | undefined
  const drawingApproval = da && (da.status === 'approved' || da.status === 'rework')
    ? { status: da.status as 'approved' | 'rework', comment: da.comment ?? null, at: da.at ?? null }
    : null
  const dl = pn.delivery as { method?: string; address?: string | null; comment?: string | null; status?: string | null } | undefined
  const delivery = dl && (dl.method === 'pickup' || dl.method === 'delivery')
    ? { method: dl.method as 'pickup' | 'delivery', address: dl.address ?? null, comment: dl.comment ?? null, status: dl.status ?? null }
    : null

  // Статус оплаты для партнёра: paid — оплачен (payment_status или этап invoice_paid);
  // awaiting — заказ в работе/отгружен, но оплата ещё не отмечена; null — просчёт.
  const paid = pn.payment_status === 'paid' || typeof stages.invoice_paid === 'string' || stages.invoice_paid === true
  const paymentStatus: 'paid' | 'awaiting' | null = paid ? 'paid' : (launched ? 'awaiting' : null)

  return NextResponse.json({
    id: o.id,
    number: (o.custom_number as string | null)?.trim() || `#${o.id}`,
    clientOrderNumber: (o.client_order_number as string | null) ?? null,
    clientName: client.name,
    buyer: {
      name: client.full_name || client.name,
      inn: client.inn ?? null, kpp: client.kpp ?? null, ogrn: client.ogrn ?? null,
      legalAddress: client.legal_address ?? null,
      bankAccount: client.bank_account ?? null, bankName: client.bank_name ?? null,
      bik: client.bik ?? null, corrAccount: client.corr_account ?? null,
    },
    created_at: o.created_at,
    lane,
    ready: packed && !shipped,
    progressPct: (lane === 'in_work' || lane === 'shipped') ? Math.round((doneN / LANE.length) * 100) : 0,
    deadline,
    paymentStatus,
    onlinePayEnabled: paymentStatus === 'awaiting' && paymentsEnabled(),
    canInvoice: !!client.can_self_invoice && launched,
    total: Number(o.total_after_discount ?? o.total_sale_inc_vat ?? 0),
    items,
    timeline,
    drawingUrl,
    drawingApproval,
    delivery,
    recalcNote: history.length > 0 ? ((pn.status_comment as string) || null) : null,
  })
}
