'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'login' | 'reset'>('login')
  const [resetSent, setResetSent] = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError('Неверный email или пароль')
      setLoading(false)
    } else {
      // Регистрация устройства (лимит 1 телефон + 1 ПК); сбой не блокирует вход
      try { await fetch('/api/security/register-device', { method: 'POST' }) } catch { /* noop */ }
      setLoading(false)
      router.push('/')
      router.refresh()
    }
  }

  // Восстановление пароля: письмо со ссылкой на /set-password (Supabase Auth).
  async function handleReset(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError(null)
    const { error } = await createClient().auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/set-password` })
    setLoading(false)
    if (error) setError('Не удалось отправить письмо. Проверьте email.')
    else setResetSent(true)
  }

  return (
    <div className="min-h-screen bg-[#f8f8f7] flex items-center justify-center px-4">
      <div className="w-full max-w-[360px]">

        {/* Логотип */}
        <div className="mb-10">
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-7 h-7 bg-[#111110] rounded-sm flex items-center justify-center">
              <span className="text-white text-xs font-bold tracking-tight">MG</span>
            </div>
            <span className="text-[15px] font-semibold text-[#111110] tracking-tight">MGlass</span>
          </div>
          <p className="text-[13px] text-[#8a8a85] ml-9">Система расчёта заказов</p>
        </div>

        <div className="bg-white border border-[#e4e4e0] rounded-xl p-7 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          {mode === 'login' ? (
            <>
              <h2 className="text-[15px] font-semibold text-[#111110] mb-5">Вход в систему</h2>
              <form onSubmit={handleLogin} className="space-y-3.5">
                <div>
                  <label className="block text-[12px] font-medium text-[#6b6b66] mb-1.5 tracking-wide uppercase">Email</label>
                  <input type="email" autoComplete="email" required
                    className="w-full bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-3 py-2.5 text-[14px] text-[#111110] placeholder-[#b0b0a8] outline-none focus:border-[#111110] focus:bg-white transition-all"
                    value={email} onChange={e => setEmail(e.target.value)} placeholder="email@mglass.ru" />
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-[#6b6b66] mb-1.5 tracking-wide uppercase">Пароль</label>
                  <input type="password" autoComplete="current-password" required
                    className="w-full bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-3 py-2.5 text-[14px] text-[#111110] placeholder-[#b0b0a8] outline-none focus:border-[#111110] focus:bg-white transition-all"
                    value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
                </div>
                {error && <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2.5"><p className="text-[13px] text-red-600">{error}</p></div>}
                <button type="submit" disabled={loading}
                  className="w-full mt-1 bg-[#111110] text-white text-[14px] font-medium rounded-lg py-2.5 hover:bg-[#2a2a28] disabled:opacity-40 transition-colors">
                  {loading ? 'Вход...' : 'Войти'}
                </button>
              </form>
              <button onClick={() => { setMode('reset'); setError(null) }} className="mt-3 text-[12px] text-[#6b6b66] hover:text-[#111110] transition-colors">Забыли пароль?</button>
            </>
          ) : resetSent ? (
            <div>
              <h2 className="text-[15px] font-semibold text-[#111110] mb-2">Проверьте почту</h2>
              <p className="text-[13px] text-[#6b6b66] mb-5">Отправили ссылку для сброса пароля на <b>{email}</b>. Перейдите по ней и задайте новый пароль.</p>
              <button onClick={() => { setMode('login'); setResetSent(false); setError(null) }} className="text-[13px] text-[#111110] font-medium hover:underline">← Ко входу</button>
            </div>
          ) : (
            <>
              <h2 className="text-[15px] font-semibold text-[#111110] mb-2">Восстановление пароля</h2>
              <p className="text-[13px] text-[#6b6b66] mb-5">Укажите email — пришлём ссылку для сброса пароля.</p>
              <form onSubmit={handleReset} className="space-y-3.5">
                <div>
                  <label className="block text-[12px] font-medium text-[#6b6b66] mb-1.5 tracking-wide uppercase">Email</label>
                  <input type="email" autoComplete="email" required
                    className="w-full bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-3 py-2.5 text-[14px] text-[#111110] placeholder-[#b0b0a8] outline-none focus:border-[#111110] focus:bg-white transition-all"
                    value={email} onChange={e => setEmail(e.target.value)} placeholder="email@mglass.ru" />
                </div>
                {error && <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2.5"><p className="text-[13px] text-red-600">{error}</p></div>}
                <button type="submit" disabled={loading}
                  className="w-full mt-1 bg-[#111110] text-white text-[14px] font-medium rounded-lg py-2.5 hover:bg-[#2a2a28] disabled:opacity-40 transition-colors">
                  {loading ? 'Отправка…' : 'Отправить ссылку'}
                </button>
              </form>
              <button onClick={() => { setMode('login'); setError(null) }} className="mt-3 text-[12px] text-[#6b6b66] hover:text-[#111110] transition-colors">← Назад ко входу</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
