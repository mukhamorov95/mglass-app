import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { computeMarginStatus } from '@/lib/types'
import { notifyApprovalRequired } from '@/lib/notify'

export async function POST(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const body = await req.json()
  const {
    client_name, client_phone, object_address,
    amo_deal_id, amo_deal_url,
    deadline, notes,
    line, // single OrderLine payload from calculator
    financial_settings,
  } = body

  if (!client_name?.trim()) {
    return NextResponse.json({ error: 'Укажите имя клиента' }, { status: 400 })
  }
  if (!line) {
    return NextResponse.json({ error: 'Отсутствуют данные расчёта' }, { status: 400 })
  }

  const marginStatus = computeMarginStatus(
    line.margin_percent,
    financial_settings ?? { default_margin: 40, min_margin: 25 },
  )

  const isBlocked = marginStatus === 'red' || marginStatus === 'blocked'
  const orderStatus = isBlocked ? 'pending_approval' : 'in_work'
  const launchedAt = isBlocked ? null : new Date().toISOString()

  // Compute order-level totals from the single line (Phase 1: one line per order)
  const totalSalePrice = line.line_sale_price
  const totalCostPrice = line.line_cost_price
  const grossProfit    = totalSalePrice - totalCostPrice

  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .insert({
      number: '',  // will be set by trigger
      client_name: client_name.trim(),
      client_phone: client_phone?.trim() || null,
      object_address: object_address?.trim() || null,
      amo_deal_id: amo_deal_id?.trim() || null,
      amo_deal_url: amo_deal_url?.trim() || null,
      manager_id: user.id,
      order_type: line.product_type,
      notes: notes?.trim() || null,
      total_sale_price: totalSalePrice,
      total_cost_price: totalCostPrice,
      gross_profit: grossProfit,
      margin_percent: line.margin_percent,
      margin_status: marginStatus,
      status: orderStatus,
      launched_at: launchedAt,
      deadline: deadline || null,
    })
    .select('id, number, status')
    .single()

  if (orderErr) return NextResponse.json({ error: orderErr.message }, { status: 500 })

  const { error: lineErr } = await supabase
    .from('order_lines')
    .insert({
      order_id:         order.id,
      position_num:     1,
      product_type:     line.product_type,
      product_name:     line.product_name,
      description:      line.description || null,
      dimensions_text:  line.dimensions_text || null,
      quantity:         line.quantity ?? 1,
      unit:             line.unit ?? 'шт',
      unit_cost_price:  line.unit_cost_price,
      unit_sale_price:  line.unit_sale_price,
      discount_percent: line.discount_percent ?? 0,
      line_cost_price:  line.line_cost_price,
      line_sale_price:  line.line_sale_price,
      margin_percent:   line.margin_percent,
      margin_status:    marginStatus,
      input_snapshot:   line.input_snapshot ?? null,
      cost_snapshot:    line.cost_snapshot ?? null,
      materials_bom:    line.materials_bom ?? null,
      hardware_bom:     line.hardware_bom ?? null,
      services_bom:     line.services_bom ?? null,
      calculation_id:   line.calculation_id ?? null,
    })

  if (lineErr) {
    // Roll back the order if line insert failed
    await supabase.from('orders').delete().eq('id', order.id)
    return NextResponse.json({ error: lineErr.message }, { status: 500 })
  }

  if (isBlocked) {
    notifyApprovalRequired({
      orderNumber:   order.number,
      clientName:    client_name.trim(),
      marginPercent: line.margin_percent,
      orderId:       order.id,
    })
  }

  return NextResponse.json({
    id:     order.id,
    number: order.number,
    status: order.status,
    needs_approval: isBlocked,
  })
}
