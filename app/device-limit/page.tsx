'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'

// Сюда попадает устройство, которому не осталось места в своём классе
// (01.10: два компьютера, один телефон, один планшет на аккаунт). Экран обязан
// назвать, что занимает места и когда его видели: причина попадания — почти всегда
// свой же второй браузер, и «вход на другом устройстве» звучало как взлом.

type Device = { label: string; lastSeenAt: string; seenTracked: boolean; isCurrent: boolean }
type Info = { deviceClassLabel: string; limit: number; devices: Device[] }

function when(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const mins = Math.round((Date.now() - d.getTime()) / 60000)
  if (mins < 2) return 'прямо сейчас'
  if (mins < 60) return `${mins} мин назад`
  if (mins < 60 * 24) return `${Math.round(mins / 60)} ч назад`
  return d.toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
}

export default function DeviceLimitPage() {
  const router = useRouter()
  const [busy, setBusy] = useState<'claim' | 'logout' | null>(null)
  const [info, setInfo] = useState<Info | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/security/my-devices')
      .then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
      .then((d: Info) => setInfo(d))
      .catch(() => setErr('Не удалось получить список устройств'))
  }, [])

  async function claimDevice() {
    setBusy('claim')
    setErr(null)
    try {
      const r = await fetch('/api/security/register-device', { method: 'POST' })
      if (!r.ok) throw new Error(String(r.status))
      router.push('/')
      router.refresh()
    } catch {
      setErr('Не удалось занять место. Попробуйте ещё раз или войдите заново')
    } finally { setBusy(null) }
  }

  async function logout() {
    setBusy('logout')
    try {
      await createClient().auth.signOut()
      router.push('/login')
      router.refresh()
    } finally { setBusy(null) }
  }

  const others = (info?.devices ?? []).filter(d => !d.isCurrent)

  return (
    <div className="min-h-screen bg-[#f5f5f3] flex items-center justify-center px-4">
      <div className="w-full max-w-[440px] bg-white border border-[#e4e4e0] rounded-xl p-7 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <div className="text-[32px] mb-3">🔒</div>
        <h1 className="text-[16px] font-semibold text-[#111110] mb-2">
          Места для этого компьютера не осталось
        </h1>
        <p className="text-[13px] text-[#6b6b66] leading-relaxed mb-4">
          {info
            ? `Правило безопасности: на аккаунт одновременно ${info.limit === 1 ? 'одно устройство' : `${info.limit} устройства`} типа «${info.deviceClassLabel.toLowerCase()}». Сейчас места заняты:`
            : 'Правило безопасности: ограниченное число устройств на аккаунт.'}
        </p>

        {others.length > 0 && (
          <ul className="mb-4 border border-[#e4e4e0] rounded-lg divide-y divide-[#e4e4e0]">
            {others.map((d, i) => (
              <li key={i} className="px-3 py-2.5">
                <div className="text-[13px] text-[#111110]">{d.label}</div>
                <div className="text-[11px] text-[#9a9a95]">
                  {d.seenTracked ? `заходили ${when(d.lastSeenAt)}` : `вход ${when(d.lastSeenAt)}, после этого не отмечался`}
                </div>
              </li>
            ))}
          </ul>
        )}
        {info && others.length === 0 && (
          <p className="text-[12px] text-[#9a9a95] mb-4">
            Другие устройства не числятся — похоже, место держит ваш же прежний браузер.
            Нажмите «Работать на этом устройстве».
          </p>
        )}

        <button
          onClick={claimDevice}
          disabled={busy !== null}
          className="w-full py-2.5 bg-[#111110] text-white text-[14px] font-semibold rounded-lg hover:bg-[#2a2a28] disabled:opacity-50 transition-colors">
          {busy === 'claim' ? '...' : 'Работать на этом устройстве'}
        </button>
        <p className="text-[11px] text-[#9a9a95] mt-2 text-center">
          освободится место того устройства, которое дольше всех не заходило
        </p>
        <button
          onClick={logout}
          disabled={busy !== null}
          className="w-full mt-3 py-2 text-[13px] text-[#6b6b66] hover:text-[#111110] transition-colors">
          {busy === 'logout' ? '...' : 'Выйти из аккаунта'}
        </button>
        {err && <p className="text-[12px] text-[#b4231f] mt-3 text-center">{err}</p>}
      </div>
    </div>
  )
}
