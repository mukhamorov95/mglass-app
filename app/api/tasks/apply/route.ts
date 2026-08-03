import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase-server'

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// Manually trigger processing of a single config task
export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { taskId } = await req.json() as { taskId: string }
  if (!taskId) return NextResponse.json({ error: 'taskId required' }, { status: 400 })

  const sb = db()
  const { data: task } = await sb.from('task_queue').select('*').eq('id', taskId).single()
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  // For config tasks — call the cron endpoint logic inline
  if (task.type === 'config') {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL}/api/cron/process-tasks`,
      { method: 'POST', headers: {
        'Content-Type': 'application/json',
        ...(process.env.CRON_SECRET ? { Authorization: `Bearer ${process.env.CRON_SECRET}` } : {}),
      } }
    )
    const data = await res.json()
    return NextResponse.json(data)
  }

  // For code tasks — just mark as pending so it shows up in queue
  await sb.from('task_queue').update({ status: 'pending' }).eq('id', taskId)
  return NextResponse.json({ ok: true, message: 'Задача поставлена в очередь для разработчика' })
}
