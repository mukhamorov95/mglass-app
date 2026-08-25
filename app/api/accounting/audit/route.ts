import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { FIN_ROLES } from '@/lib/accounting/roles'
import { createServiceClient } from '@/lib/supabase-service'
import { collectAudit } from '@/lib/accounting/collectAudit'

// Б14: сводка расхождений в кабинете. Дата приходит от клиента (у бухгалтера
// свой часовой пояс), но проверяется — иначе кривой параметр даст кривой аудит.


export async function GET(req: NextRequest) {
  const guard = await requireRole([...FIN_ROLES])
  if (guard instanceof NextResponse) return guard

  const raw = new URL(req.url).searchParams.get('today') ?? ''
  const today = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : new Date().toISOString().slice(0, 10)

  const findings = await collectAudit(createServiceClient(), today)
  return NextResponse.json({ today, findings })
}
