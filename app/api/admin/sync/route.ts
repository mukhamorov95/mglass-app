import { NextResponse } from 'next/server'
import { getRole } from '@/lib/getRole'

export const runtime = 'nodejs'

export async function POST() {
  const role = await getRole()
  if (role !== 'admin') return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 })

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
  } catch (err: any) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      stderr: err?.stderr ?? '',
      stdout: err?.stdout ?? '',
    })
  }
}
