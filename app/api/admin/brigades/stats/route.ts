import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export async function GET() {
  const { data, error } = await svc()
    .from('installer_ratings')
    .select('brigade_id, rating')
    .not('brigade_id', 'is', null)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Group by brigade_id in JS
  const map: Record<string, { sum: number; count: number }> = {}
  for (const row of (data ?? [])) {
    if (!row.brigade_id) continue
    if (!map[row.brigade_id]) map[row.brigade_id] = { sum: 0, count: 0 }
    map[row.brigade_id].sum   += row.rating
    map[row.brigade_id].count += 1
  }

  const result = Object.entries(map).map(([brigade_id, { sum, count }]) => ({
    brigade_id,
    avg_rating: Math.round((sum / count) * 10) / 10,
    count,
  }))

  return NextResponse.json(result)
}
