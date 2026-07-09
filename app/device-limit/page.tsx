'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'

// Сюда попадает устройство, вытесненное входом на другом устройстве того же
// класса (лимит: 1 телефон + 1 ПК на аккаунт). Можно вернуть себе доступ —
// тогда вытеснится то, другое устройство.

export default function DeviceLimitPage() {
  const router = useRouter()
  const [busy, setBusy] = useState<'claim' | 'logout' | null>(null)

  async function claimDevice() {
    setBusy('claim')
    try {
      await fetch('/api/security/register-device', { method: 'POST' })
      router.push('/')
      router.refresh()
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

  return (
    <div className="min-h-screen bg-[#f8f8f7] flex items-center justify-center px-4">
      <div className="w-full max-w-[400px] bg-white border border-[#e4e4e0] rounded-xl p-7 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <div className="text-[32px] mb-3">🔒</div>
        <h1 className="text-[16px] font-semibold text-[#111110] mb-2">Вход выполнен на другом устройстве</h1>
        <p className="text-[13px] text-[#6b6b66] leading-relaxed mb-5">
          В этот аккаунт вошли с другого устройства такого же типа. Правило безопасности:
          один аккаунт — один телефон и один компьютер одновременно.
        </p>
        <button
          onClick={claimDevice}
          disabled={busy !== null}
          className="w-full py-2.5 bg-[#111110] text-white text-[14px] font-semibold rounded-lg hover:bg-[#2a2a28] disabled:opacity-50 transition-colors">
          {busy === 'claim' ? '...' : 'Работать на этом устройстве'}
        </button>
        <p className="text-[11px] text-[#9a9a95] mt-2 text-center">то, другое устройство будет отключено</p>
        <button
          onClick={logout}
          disabled={busy !== null}
          className="w-full mt-3 py-2 text-[13px] text-[#6b6b66] hover:text-[#111110] transition-colors">
          {busy === 'logout' ? '...' : 'Выйти из аккаунта'}
        </button>
      </div>
    </div>
  )
}
