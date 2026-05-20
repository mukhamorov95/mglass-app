import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as svc } from '@supabase/supabase-js'

function service() {
  return svc(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

type Row = Record<string, string>

const TABLE_MAP: Record<string, string> = {
  suppliers:      'suppliers',
  b2b_clients:    'b2b_clients',
  purchase_orders:'purchase_orders',
  materials:      'materials',
}

export async function POST(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single()
  const role = (profile as { role: string } | null)?.role ?? ''
  if (!['admin', 'buyer'].includes(role)) return NextResponse.json({ error: 'Нет доступа' }, { status: 403 })

  const { target, rows, mapping, source_name, source } = await req.json() as {
    target:      string
    rows:        Row[]
    mapping:     Record<string, string>   // csvCol → dbField
    source_name: string
    source:      string  // 'csv' | 'google_sheets'
  }

  const table = TABLE_MAP[target]
  if (!table) return NextResponse.json({ error: 'Неизвестный целевой модуль' }, { status: 400 })

  let okCount = 0
  let errCount = 0
  const errors: string[] = []

  for (const row of rows) {
    const record: Record<string, unknown> = {}
    for (const [csvCol, dbField] of Object.entries(mapping)) {
      if (dbField && row[csvCol] !== undefined) {
        const val = row[csvCol]?.trim() ?? ''
        record[dbField] = val || null
      }
    }

    if (!record.name && table === 'suppliers') { errCount++; errors.push(`Пропущена строка — нет названия`); continue }

    const { error } = await service().from(table).insert(record)
    if (error) { errCount++; errors.push(error.message) }
    else okCount++
  }

  // Write log
  await service().from('data_import_logs').insert({
    source,
    source_name,
    target_module: target,
    rows_total:  rows.length,
    rows_ok:     okCount,
    rows_error:  errCount,
    error_details: errors.length > 0 ? errors.slice(0, 5).join('; ') : null,
    created_by: user.id,
  })

  return NextResponse.json({ ok: true, rows_ok: okCount, rows_error: errCount, errors: errors.slice(0, 5) })
}
