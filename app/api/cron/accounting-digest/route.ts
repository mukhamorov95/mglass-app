import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { collectAudit } from '@/lib/accounting/collectAudit'
import { digest } from '@/lib/accounting/audit'
import { notifyAdmins } from '@/lib/telegram'

export const maxDuration = 120

// Б14: утренняя сводка бухгалтерии владельцу. Молчит, когда всё чисто —
// ежедневное «всё хорошо» перестают читать через неделю.

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const today = new Date().toISOString().slice(0, 10)
  const findings = await collectAudit(createServiceClient(), today)
  const text = digest(findings)
  if (text) await notifyAdmins(text).catch(() => {})

  return NextResponse.json({ ok: true, findings: findings.length, sent: !!text })
}
