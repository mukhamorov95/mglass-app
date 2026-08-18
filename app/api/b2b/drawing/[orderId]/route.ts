import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { parseNotes } from '@/lib/orderFlags'
import { getRole } from '@/lib/getRole'
import { getPartnerClientId } from '@/lib/partnerScope'

// Чертёж заказа лежит в приватном bucket b2b-attachments (order-drawings/<id>),
// прямой publicUrl отдаёт 404 «Bucket not found» — редиректим на короткоживущую
// подписанную ссылку, как /api/b2b/attachments/[id] для вложений просчётов.
export async function GET(_req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params
  const oid = Number(orderId)
  if (!oid) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = await getRole()
  if (!role) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const svc = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: row } = await svc.from('b2b_orders').select('notes, client_id').eq('id', oid).single()
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Партнёр — только чертёж своего заказа. Внутренние роли — любой. Без этой
  // проверки партнёр мог перебором id вытащить чужие производственные чертежи.
  if (role === 'partner') {
    const clientId = await getPartnerClientId(user.id)
    if (!clientId || (row as { client_id: number | null }).client_id !== clientId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
  }

  const drawing = parseNotes(row.notes ?? null).drawing_url
  if (typeof drawing !== 'string' || !drawing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // В notes может лежать и старый publicUrl (с ?t=бустером), и просто путь
  const marker = '/b2b-attachments/'
  const noQuery = drawing.split('?')[0]
  const path = noQuery.includes(marker) ? noQuery.slice(noQuery.indexOf(marker) + marker.length) : noQuery

  const { data: signed, error } = await svc.storage.from('b2b-attachments').createSignedUrl(path, 3600)
  if (error || !signed?.signedUrl) return NextResponse.json({ error: 'Sign failed' }, { status: 500 })
  return NextResponse.redirect(signed.signedUrl)
}
