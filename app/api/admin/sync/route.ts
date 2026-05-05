import { NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'
import { getRole } from '@/lib/getRole'

const execAsync = promisify(exec)

export async function POST() {
  const role = await getRole()
  if (role !== 'admin') return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 })

  try {
    const { stdout: statusOut } = await execAsync(
      'git status --porcelain',
      { cwd: process.cwd() }
    )

    const hasChanges = statusOut.trim().length > 0

    if (hasChanges) {
      await execAsync('git add -A', { cwd: process.cwd() })
      const date = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })
      await execAsync(
        `git commit -m "Синхронизация ${date}"`,
        { cwd: process.cwd() }
      )
    }

    const { stdout: pushOut } = await execAsync(
      'git push origin main',
      { cwd: process.cwd() }
    )

    const { stdout: logOut } = await execAsync(
      'git log --oneline -3',
      { cwd: process.cwd() }
    )

    return NextResponse.json({
      ok: true,
      hadChanges: hasChanges,
      log: logOut.trim(),
      push: pushOut.trim() || 'Pushed to origin/main',
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
