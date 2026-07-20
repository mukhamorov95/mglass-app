import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'

export const runtime = 'nodejs'

export async function POST() {
  // Strictly admin: runs `git push origin main` on the server.
  const guard = await requireAdmin()
  if (guard instanceof NextResponse) return guard

  try {
    const { exec } = await import('child_process')
    const { promisify } = await import('util')
    const execAsync = promisify(exec)
    const cwd = process.cwd()

    const { stdout: statusOut } = await execAsync('git status --porcelain', { cwd })
    const hasChanges = statusOut.trim().length > 0

    if (hasChanges) {
      await execAsync('git add -A', { cwd })
      const date = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })
      await execAsync(`git commit -m "Синхронизация ${date}"`, { cwd })
    }

    const { stderr: pushErr } = await execAsync('git push origin main', { cwd })
    const { stdout: logOut } = await execAsync('git log --oneline -3', { cwd })

    return NextResponse.json({
      ok: true,
      hadChanges: hasChanges,
      log: logOut.trim(),
      push: pushErr.trim() || 'ok',
    })
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string }
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      stderr: e?.stderr ?? '',
      stdout: e?.stdout ?? '',
    })
  }
}
