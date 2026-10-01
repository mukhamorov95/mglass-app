import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { classifyDevice, DEVICE_CLASS_LABELS, type DeviceClass } from '@/lib/deviceClass'
import { deviceLabel, deviceLimitFor } from '@/lib/deviceLimits'

// Свои устройства — для экрана /device-limit: что держит место и когда его видели.
// Только свои записи: фильтр по user_id из сессии, чужой id в запросе не принимаем.

export async function GET(req: Request) {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const cls = classifyDevice(req.headers.get('user-agent')) as DeviceClass
  const myDeviceId = (await cookies()).get('device-id')?.value ?? null

  try {
    const svc = createServiceClient()
    const { data, error } = await svc.from('user_devices')
      .select('device_id, device_class, user_agent, last_seen_at, created_at')
      .eq('user_id', user.id).eq('device_class', cls).is('revoked_at', null)
      .order('last_seen_at', { ascending: false, nullsFirst: false })
    if (error) throw new Error(error.message)

    const rows = (data ?? []) as
      { device_id: string; device_class: string; user_agent: string | null; last_seen_at: string | null; created_at: string }[]
    return NextResponse.json({
      deviceClass: cls,
      deviceClassLabel: DEVICE_CLASS_LABELS[cls],
      limit: deviceLimitFor(cls),
      devices: rows.map(r => ({
        label: deviceLabel(r.user_agent),
        lastSeenAt: r.last_seen_at ?? r.created_at,
        seenTracked: Boolean(r.last_seen_at),
        isCurrent: Boolean(myDeviceId) && r.device_id === myDeviceId,
      })),
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 200) : 'error' }, { status: 500 })
  }
}
