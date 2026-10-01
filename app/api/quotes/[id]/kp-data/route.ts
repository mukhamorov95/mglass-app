import { NextResponse } from 'next/server'
import { loadOrderWithAccess } from '@/lib/b2bOrderAccess'

// Данные для печатной КП — та же калитка, что у счёта-спецификации. Раньше
// старый заказ без автора (4 275 из 5 258) открывался любому вошедшему.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const r = await loadOrderWithAccess(id)
  if (r.status !== 200) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ order: r.order })
}
