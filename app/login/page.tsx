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
      setLoading(false)
      router.push('/')
      router.refresh()
    }
  }

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center px-4">
      <div className="w-full max-w-[360px]">

        {/* Логотип */}
        <div className="mb-10">
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-7 h-7 bg-ink rounded-sm flex items-center justify-center">
              <span className="text-white text-xs font-semibold tracking-tight">MG</span>
            </div>
            <span className="text-[15px] font-semibold text-ink tracking-tight">MGlass</span>
          </div>
          <p className="text-[13px] text-muted ml-9">Система расчёта заказов</p>
        </div>

        <div className="bg-surface border border-line rounded-xl p-7 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <h2 className="text-[15px] font-semibold text-ink mb-5">Вход в систему</h2>

          <form onSubmit={handleLogin} className="space-y-3.5">
            <div>
              <label className="block text-[12px] font-medium text-ink-soft mb-1.5 tracking-wide uppercase">Email</label>
              <input
                type="email"
                autoComplete="email"
                required
                className="w-full bg-canvas border border-line rounded-lg px-3 py-2.5 text-[14px] text-ink placeholder-faint outline-none focus:border-ink focus:bg-surface transition-all"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="email@mglass.ru"
              />
            </div>

            <div>
              <label className="block text-[12px] font-medium text-ink-soft mb-1.5 tracking-wide uppercase">Пароль</label>
              <input
                type="password"
                autoComplete="current-password"
                required
                className="w-full bg-canvas border border-line rounded-lg px-3 py-2.5 text-[14px] text-ink placeholder-faint outline-none focus:border-ink focus:bg-surface transition-all"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2.5">
                <p className="text-[13px] text-red-600">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-1 bg-ink text-white text-[14px] font-medium rounded-lg py-2.5 hover:bg-[#2a2a28] disabled:opacity-40 transition-colors"
            >
              {loading ? 'Вход...' : 'Войти'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
