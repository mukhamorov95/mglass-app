import { NextRequest, NextResponse } from 'next/server'
import { vladDb } from '@/lib/vlad/vladClient'

// ICS-фид для подписки в Apple/Google Calendar. Календарь не умеет логиниться,
// поэтому аутентификация — секрет в URL (uuid из vlad_settings, знает только
// владелец). Односторонняя синхронизация: задачи со сроками → события.
// Путь в whitelist middleware (как вебхуки).

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ secret: string }> },
) {
  const { secret } = await params
  const db = vladDb()
  if (!db) return new NextResponse('not configured', { status: 503 })

  const { data: st } = await db.from('vlad_settings').select('value').eq('key', 'ics_secret').single()
  const real = typeof st?.value === 'string' ? st.value : ''
  if (!real || secret !== real) return new NextResponse('not found', { status: 404 })

  const { data: tasks } = await db.from('vlad_tasks')
    .select('id,title,role,due_date,status')
    .not('due_date', 'is', null)
    .in('status', ['inbox', 'active'])

  const ROLE_RU: Record<string, string> = {
    ceo: 'CEO', manager: 'Менеджер', cfo: 'Финансы', production: 'Производство',
    father: 'Отец', husband: 'Муж', son: 'Сын', brother: 'Брат', other: 'Личное',
  }
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z'

  const events = (tasks ?? []).map(t => {
    const d = String(t.due_date).replace(/-/g, '')
    return [
      'BEGIN:VEVENT',
      `UID:vlad-task-${t.id}@mglass-app`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${d}`,
      `SUMMARY:${esc(`[${ROLE_RU[t.role] ?? t.role}] ${t.title}`)}`,
      'END:VEVENT',
    ].join('\r\n')
  }).join('\r\n')

  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MGlass//Vlad//RU',
    'X-WR-CALNAME:Влад · Задачи', events, 'END:VCALENDAR',
  ].join('\r\n')

  return new NextResponse(ics, {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
