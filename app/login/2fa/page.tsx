'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'

// Второй шаг входа для владельца: код из Telegram. Middleware приводит сюда
// owner-tier пользователя, пока он не подтвердил вход. Без кода — дальше никуда.
export default function TwoFactorPage() {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [info, setInfo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [recovery, setRecovery] = useState(false)
  const sentOnce = useRef(false)

  async function sendCode() {
    setSending(true); setError(null)
    try {
      const r = await fetch('/api/security/2fa/send', { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      if (j.ok) setInfo('Код отправлен в Telegram. Действует 5 минут.')
      else if (j.reason === 'throttled') setInfo('Код уже отправлен — проверьте Telegram.')
      else if (j.reason === 'no_telegram') { setInfo(null); setRecovery(true); setError('Telegram не привязан. Введите резервный код.') }
      else setError('Не удалось отправить код. Попробуйте резервный код.')
    } catch { setError('Сеть недоступна. Повторите.') }
    setSending(false)
  }

  useEffect(() => {
    if (sentOnce.current) return
    sentOnce.current = true
    void sendCode()
  }, [])

  async function verify(e: React.FormEvent) {
    e.preventDefault()
    setVerifying(true); setError(null)
    try {
      const r = await fetch('/api/security/2fa/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      })
      const j = await r.json().catch(() => ({}))
      if (j.ok) { router.push('/'); router.refresh(); return }
      const reasons: Record<string, string> = {
        mismatch: 'Неверный код.', expired: 'Код истёк — запросите новый.',
        too_many: 'Слишком много попыток — запросите новый код.', no_code: 'Код не запрашивался — нажмите «Отправить код».',
      }
      setError(reasons[j.reason as string] ?? 'Не удалось подтвердить.')
    } catch { setError('Сеть недоступна. Повторите.') }
    setVerifying(false)
  }

  async function logout() {
    await createClient().auth.signOut()
    router.push('/login'); router.refresh()
  }

  return (
    <div className="min-h-screen bg-[#f8f8f7] flex items-center justify-center px-4">
      <div className="w-full max-w-[360px]">
        <div className="mb-10">
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-7 h-7 bg-[#111110] rounded-sm flex items-center justify-center">
              <span className="text-white text-xs font-bold tracking-tight">MG</span>
            </div>
            <span className="text-[15px] font-semibold text-[#111110] tracking-tight">MGlass</span>
          </div>
          <p className="text-[13px] text-[#8a8a85] ml-9">Подтверждение входа</p>
        </div>

        <div className="bg-white border border-[#e4e4e0] rounded-xl p-7 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <h2 className="text-[15px] font-semibold text-[#111110] mb-1">Второй фактор</h2>
          <p className="text-[13px] text-[#8a8a85] mb-5">
            {recovery ? 'Введите резервный код.' : 'Код отправлен вам в Telegram. Введите его, чтобы войти.'}
          </p>

          <form onSubmit={verify} className="space-y-3.5">
            <div>
              <label className="block text-[12px] font-medium text-[#6b6b66] mb-1.5 tracking-wide uppercase">
                {recovery ? 'Резервный код' : 'Код из Telegram'}
              </label>
              <input
                type="text" inputMode={recovery ? 'text' : 'numeric'} autoComplete="one-time-code" required autoFocus
                className="w-full bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-3 py-2.5 text-[16px] tracking-[0.3em] font-mono text-[#111110] placeholder-[#b0b0a8] outline-none focus:border-[#111110] focus:bg-white transition-all"
                value={code}
                onChange={e => setCode(e.target.value)}
                placeholder={recovery ? 'резервный код' : '000000'}
              />
            </div>

            {info && !error && (
              <div className="bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2.5">
                <p className="text-[13px] text-emerald-700">{info}</p>
              </div>
            )}
            {error && (
              <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2.5">
                <p className="text-[13px] text-red-600">{error}</p>
              </div>
            )}

            <button
              type="submit" disabled={verifying || !code.trim()}
              className="w-full mt-1 bg-[#111110] text-white text-[14px] font-medium rounded-lg py-2.5 hover:bg-[#2a2a28] disabled:opacity-40 transition-colors"
            >
              {verifying ? 'Проверка...' : 'Подтвердить'}
            </button>
          </form>

          <div className="flex items-center justify-between mt-4 text-[12px]">
            <button onClick={sendCode} disabled={sending} className="text-[#6b6b66] hover:text-[#111110] disabled:opacity-40">
              {sending ? 'Отправка...' : 'Отправить код повторно'}
            </button>
            <button onClick={() => { setRecovery(v => !v); setCode(''); setError(null) }} className="text-[#6b6b66] hover:text-[#111110]">
              {recovery ? 'Ввести код из Telegram' : 'Резервный код'}
            </button>
          </div>
        </div>

        <button onClick={logout} className="w-full text-center mt-4 text-[12px] text-[#9a9a95] hover:text-[#6b6b66]">
          Выйти
        </button>
      </div>
    </div>
  )
}
