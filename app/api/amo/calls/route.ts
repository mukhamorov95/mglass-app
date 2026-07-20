import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

const AMO_BASE  = `https://${process.env.AMO_SUBDOMAIN}.amocrm.ru/api/v4`
const AMO_TOKEN = process.env.AMO_ACCESS_TOKEN!

async function amoGet(path: string) {
  const res = await fetch(`${AMO_BASE}${path}`, {
    headers: { Authorization: `Bearer ${AMO_TOKEN}` },
    cache: 'no-store',
  })
  if (!res.ok || res.status === 204) return null
  return res.json()
}

export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const leadId = searchParams.get('lead_id')
  if (!leadId) return NextResponse.json({ error: 'lead_id required' }, { status: 400 })

  try {
    // Fetch call notes (incoming + outgoing) for this lead
    const data = await amoGet(
      `/leads/${leadId}/notes?filter[note_type][]=call_in&filter[note_type][]=call_out&limit=50&order[id]=desc`
    )
    type AmoCallNote = {
      id: number; note_type: string; created_at: number
      params?: { phone?: string; uniq_call_id?: string; duration?: number; link?: string }
    }
    const notes: AmoCallNote[] = data?._embedded?.notes ?? []

    // Fetch existing analyses from our DB
    const { data: analyses } = await supabase
      .from('call_analyses')
      .select('amo_note_id, summary, probability, manager_score, created_at')
      .eq('amo_lead_id', parseInt(leadId))

    const analysedNoteIds = new Set((analyses ?? []).map((a: { amo_note_id: number }) => a.amo_note_id))

    const calls = notes
      .filter(n => n.note_type === 'call_in' || n.note_type === 'call_out')
      .map(n => {
        const params = n.params ?? {}
        const analysed = analyses?.find((a: { amo_note_id: number }) => a.amo_note_id === n.id)
        return {
          note_id:       n.id as number,
          note_type:     n.note_type as string,
          direction:     n.note_type === 'call_in' ? 'in' : 'out',
          created_at:    n.created_at as number,  // unix timestamp
          phone:         (params.phone ?? params.uniq_call_id ?? '') as string,
          duration_sec:  (params.duration ?? 0) as number,
          recording_url: (params.link ?? null) as string | null,
          // Analysis status
          is_analysed:   analysedNoteIds.has(n.id),
          summary:       analysed?.summary ?? null,
          probability:   analysed?.probability ?? null,
          manager_score: analysed?.manager_score ?? null,
          analysed_at:   analysed?.created_at ?? null,
        }
      })

    return NextResponse.json({ calls, lead_id: parseInt(leadId) })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
