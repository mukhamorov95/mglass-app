import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

// POST /api/auth/setup-org
// Called once after first login. Creates the default organization and profile
// for the current user if they don't exist yet. Idempotent — safe to call multiple times.
export async function POST() {
  const sb = await createClient()
  const { data: { user }, error: authErr } = await sb.auth.getUser()
  if (authErr || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check if a profile already exists
  const { data: existing } = await sb
    .from('profiles')
    .select('organization_id, role')
    .eq('user_id', user.id)
    .single()

  if (existing) {
    return NextResponse.json({ orgId: existing.organization_id, role: existing.role })
  }

  // Derive a friendly org name from the user's email domain
  const domain = user.email?.split('@')[1] ?? 'company'
  const orgName = domain.split('.')[0].charAt(0).toUpperCase() + domain.split('.')[0].slice(1)
  const slug = `${domain.split('.')[0]}-${user.id.slice(0, 6)}`

  // Create a new organization for this user
  const { data: org, error: orgErr } = await sb
    .from('organizations')
    .insert({ name: orgName, slug, plan: 'standard' })
    .select('id')
    .single()

  if (orgErr || !org) {
    return NextResponse.json({ error: orgErr?.message ?? 'Failed to create org' }, { status: 500 })
  }

  // Determine role: first user in the org becomes admin, subsequent ones are managers
  const role = 'admin'

  const { error: profileErr } = await sb
    .from('profiles')
    .insert({ user_id: user.id, organization_id: org.id, role })

  if (profileErr) {
    return NextResponse.json({ error: profileErr.message }, { status: 500 })
  }

  return NextResponse.json({ orgId: org.id, role })
}

// GET /api/auth/setup-org — read current profile (used by OrganizationProvider)
export async function GET() {
  const sb = await createClient()
  const { data: { user }, error: authErr } = await sb.auth.getUser()
  if (authErr || !user) {
    return NextResponse.json({ orgId: 1, role: 'manager' })
  }

  const { data: profile } = await sb
    .from('profiles')
    .select('organization_id, role')
    .eq('user_id', user.id)
    .single()

  if (!profile) {
    // Auto-provision on first access
    const setupRes = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL?.replace('supabase.co', 'supabase.co') ?? ''}/api/auth/setup-org`,
      { method: 'POST' }
    )
    if (setupRes.ok) {
      const data = await setupRes.json()
      return NextResponse.json({ orgId: data.orgId ?? 1, role: data.role ?? 'manager' })
    }
    return NextResponse.json({ orgId: 1, role: 'manager' })
  }

  return NextResponse.json({ orgId: profile.organization_id, role: profile.role })
}
