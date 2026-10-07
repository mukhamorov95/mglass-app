import { NextRequest, NextResponse } from 'next/server'
import { requirePageAccess } from '@/lib/apiAuth'
import { createServiceClient } from '@/lib/supabase-service'
import { notifyAdmins } from '@/lib/telegram'
import { notifyUser } from '@/lib/b2b/notifyManager'
import { appUrl } from '@/lib/appUrl'
import { escapeHtml } from '@/lib/production/managerNotices'

// Заявка цеха «Необходимо купить» → Telegram владельцу и закупщику. Раньше уходила
// только роли admin, а заказывает материал закупщик — он узнавал о нехватке от цеха голосом.
// Зовут экраны цеха; service-role нужен, чтобы найти закупщиков, — поэтому сначала роль.
export async function POST(req: NextRequest) {
  const guard = await requirePageAccess('/production-app')
  if (guard instanceof NextResponse) return guard

  const { title, qty, author, link } = await req.json().catch(() => ({})) as Record<string, unknown>
  if (!title || typeof title !== 'string') return NextResponse.json({ error: 'title required' }, { status: 400 })

  const lines = [
    '🛒 <b>Цех просит купить</b>',
    `${escapeHtml(title)}${qty ? ` × ${escapeHtml(String(qty))}` : ''}`,
    author ? `от: ${escapeHtml(String(author))}` : '',
    link ? `ссылка: ${escapeHtml(String(link))}` : '',
    '',
    'Отметить «заказан» (с датой) или «есть» — в «Материал под заказы» (/purchasing): резчик увидит отметку у себя.',
  ].filter(Boolean)
  const text = lines.join('\n')

  await notifyAdmins(text).catch(() => {})

  const svc = createServiceClient()
  const { data: buyers, error } = await svc.from('users').select('id').eq('role', 'buyer')
  if (error) return NextResponse.json({ ok: false, error: `Закупщики не прочитались: ${error.message}` }, { status: 500 })
  const keyboard = [[{ text: 'Открыть закупку', url: appUrl('/purchasing') }]]
  const sent = await Promise.all((buyers ?? []).map(b => notifyUser(b.id as string, text, keyboard)))

  // Закупщик без привязанного Telegram сообщения не получит — говорим, кто дошёл.
  return NextResponse.json({ ok: true, buyers: (buyers ?? []).length, buyersNotified: sent.filter(Boolean).length })
}
