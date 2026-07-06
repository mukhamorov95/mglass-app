import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { notifyAdmins } from '@/lib/telegram'

// Уведомление закупщику/владельцу в Telegram о новой заявке цеха «Необходимо купить»
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { title, qty, author, link } = await req.json().catch(() => ({}))
  if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 })

  const lines = [
    '🛒 <b>Цех просит купить</b>',
    `${title}${qty ? ` × ${qty}` : ''}`,
    author ? `от: ${author}` : '',
    link ? `ссылка: ${link}` : '',
    '',
    'Отметить «Заказано» — в Закупках (/admin/procurement) или в цеховом канбане.',
  ].filter(Boolean)
  await notifyAdmins(lines.join('\n')).catch(() => {})
  return NextResponse.json({ ok: true })
}
