import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getRole } from '@/lib/getRole'
import { getPartnerClientId } from '@/lib/partnerScope'

// Выдаёт короткоживущую подписанную ссылку на вложение и редиректит на неё.
// Bucket b2b-attachments приватный, поэтому прямые publicUrl не работают (400).
// Путь берём из file_url: либо это уже путь (новые записи), либо старый publicUrl
// (вырезаем часть после /b2b-attachments/).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const attId = Number(id)
  if (!attId) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = await getRole()
  if (!role) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const svc = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: att } = await svc.from('b2b_calculation_attachments').select('file_url, order_id').eq('id', attId).single()
  if (!att?.file_url) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // Партнёр — только вложение своего заказа. Внутренние роли — любое.
  if (role === 'partner') {
    const clientId = await getPartnerClientId(user.id)
    let ok = false
    if (clientId && att.order_id != null) {
      const { data: ord } = await svc.from('b2b_orders').select('client_id').eq('id', att.order_id).maybeSingle()
      ok = !!ord && (ord as { client_id: number | null }).client_id === clientId
    }
    if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const marker = '/b2b-attachments/'
  const raw = String(att.file_url)
  const path = raw.includes(marker) ? raw.slice(raw.indexOf(marker) + marker.length) : raw

  const { data: signed, error } = await svc.storage.from('b2b-attachments').createSignedUrl(path, 300)
  if (error || !signed?.signedUrl) return NextResponse.json({ error: 'Sign failed' }, { status: 500 })

  return NextResponse.redirect(signed.signedUrl)
}
