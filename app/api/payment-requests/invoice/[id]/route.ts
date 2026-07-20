import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'

// Счёт-вложение заявки на оплату: bucket приватный — отдаём подписанную
// ссылку. Доступ = RLS заявки (финконтур всё, закупщик своё).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  // RLS сама решит, видна ли заявка этому пользователю
  const { data: req } = await supabase.from('payment_requests').select('invoice_path').eq('id', Number(id)).maybeSingle()
  const path = (req as { invoice_path?: string } | null)?.invoice_path
  if (!path) return NextResponse.json({ error: 'Нет вложения' }, { status: 404 })

  const svc = createServiceClient()
  const { data, error } = await svc.storage.from('b2b-attachments').createSignedUrl(path, 300)
  if (error || !data) return NextResponse.json({ error: 'Ссылка не создалась' }, { status: 500 })
  return NextResponse.redirect(data.signedUrl)
}
