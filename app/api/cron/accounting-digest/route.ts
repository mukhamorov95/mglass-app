import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { collectAudit } from '@/lib/accounting/collectAudit'
import { digest } from '@/lib/accounting/audit'
import { notifyAdmins } from '@/lib/telegram'
import { notifyAccountants } from '@/lib/accounting/notifyAccountants'
import { appUrl } from '@/lib/appUrl'
import { mskDayKey } from '@/lib/time'

export const maxDuration = 120

// Б14: утренняя сводка бухгалтерии — владельцу и бухгалтерам (роль accountant с
// привязанным Telegram): это их очередь, а не только контроль владельца. Молчит, когда
// всё чисто — ежедневное «всё хорошо» перестают читать через неделю.

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const svc = createServiceClient()
  let findings: Awaited<ReturnType<typeof collectAudit>>
  try { findings = await collectAudit(svc, mskDayKey()) } catch (e) {
    return NextResponse.json({ error: `Проверка не собралась: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 })
  }
  const text = digest(findings)
  let accountants: Awaited<ReturnType<typeof notifyAccountants>> | null = null
  let accountantsError: string | null = null
  if (text) {
    await notifyAdmins(text).catch(() => {})
    try {
      accountants = await notifyAccountants(svc, text, [[{ text: 'Открыть «Ждут действия»', url: appUrl('/accounting') }]])
    } catch (e) {
      accountantsError = e instanceof Error ? e.message : String(e)
      console.error('[accounting-digest]', accountantsError)
    }
  }

  return NextResponse.json({ ok: true, findings: findings.length, sent: !!text, accountants, accountantsError })
}
