import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import React from 'react'
import { createClient } from '@/lib/supabase-server'
import QuotePDF, { type QuotePDFProps } from '@/components/QuotePDF'
import { isOwnerRole } from '@/lib/getRole'

export const runtime = 'nodejs'

function parseNotes(n: string | null): Record<string, unknown> {
  if (!n) return {}
  try { const p = JSON.parse(n); if (typeof p === 'object' && p !== null) return p } catch {}
  return {}
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const orderId = Number(id)
  if (!orderId) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: order, error } = await sb
    .from('b2b_orders')
    .select('id,client_id,client_name,custom_number,client_order_number,discount_percent,items,total_area,total_weight,total_sale_inc_vat,total_after_discount,notes,created_at,created_by')
    .eq('id', orderId)
    .single()

  if (error || !order) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Проверяем доступ: только владелец заказа или owner-tier (admin/ceo) / see_all_orders
  const { data: profile } = await sb.from('users').select('role,see_all_orders').eq('id', user.id).maybeSingle()
  const canAccess =
    isOwnerRole(profile?.role) ||
    (profile?.see_all_orders ?? false) ||
    order.created_by === user.id ||
    order.created_by === null
  if (!canAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Load client for contact details
  let contact: string | null = null
  let phone: string | null = null
  if (order.client_id) {
    const { data: client } = await sb
      .from('b2b_clients')
      .select('contact,phone')
      .eq('id', order.client_id)
      .single()
    contact = client?.contact ?? null
    phone   = client?.phone   ?? null
  }

  const notes       = parseNotes(order.notes)
  const managerName = (notes.manager_name as string | null) ?? null
  const productionDays = (notes.production_days as number) || 7
  const quoteDate   = (notes.quote_date as string) || order.created_at
  const userNotes   = (notes.user_notes as string | null) ?? null

  const props: QuotePDFProps = {
    id:                 order.id,
    customNumber:       (order.custom_number as string | null) ?? null,
    clientOrderNumber:  (order.client_order_number as string | null) ?? null,
    clientName:         order.client_name,
    contact,
    phone,
    discountPercent:    order.discount_percent ?? 0,
    items:              Array.isArray(order.items) ? order.items : [],
    totalSaleIncVat:    order.total_sale_inc_vat ?? 0,
    totalAfterDiscount: order.total_after_discount || order.total_sale_inc_vat || 0,   // фолбэк: без скидки итог = цена с НДС
    totalArea:          order.total_area ?? 0,
    totalWeight:        order.total_weight ?? 0,
    managerName,
    productionDays,
    quoteDate,
    userNotes,
    priceMode: notes.kp_price_mode === 'detailed' ? 'detailed' : 'consolidated',
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = await renderToBuffer(React.createElement(QuotePDF, props) as any)

  const safeName = order.client_name.replace(/[^\p{L}0-9\s]/gu, '').trim().replace(/\s+/g, '_')
  const filename = `КП-${String(orderId).padStart(5, '0')}-${safeName}.pdf`

  return new Response(Buffer.from(buffer), {
    headers: {
      'Content-Type':        'application/pdf',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control':       'no-store',
    },
  })
}
