import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as svc } from '@supabase/supabase-js'

function service() {
  return svc(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const { data, error } = await service()
    .from('data_import_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}
