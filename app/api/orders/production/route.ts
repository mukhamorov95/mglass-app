import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const client = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data } = await client
    .from('orders')
    .select('id,number,client_name,client_phone,object_address,launched_at,deadline,total_sale_price,production_stages, order_lines(id,position_num,product_name,product_type,dimensions_text,quantity,unit,materials_bom,hardware_bom,services_bom,input_snapshot)')
    .eq('status', 'in_work')
    .order('launched_at', { ascending: true })

  return NextResponse.json(data ?? [])
}
