import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { requireOwner } from '@/lib/apiAuth'

// DELETE — wipe all leads (owner only)
export async function DELETE() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard

  const { error } = await supabase.from('b2b_leads').delete().neq('id', 0)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
