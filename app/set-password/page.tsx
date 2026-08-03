'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'

// Пользователь задаёт свой пароль по одноразовой ссылке. Никто (включая
// владельца) его не вводит и не видит. Токен берём из адресной строки.
function SetPasswordInner() {
  const token = useSearchParams().get('token') ?? ''
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (pw.length < 8) { setError('Пароль минимум 8 символов'); return }
    if (pw !== pw2) { setError('Пароли не совпадают'); return }
    setSaving(true)
    try {
      const r = await fetch('/api/auth/set-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password: pw }),
      })
      const j = await r.json().catch(() => ({}))
      if (j.ok) setDone(true)
      else setError(j.error ?? 'Не удалось установить пароль')
    } catch { setError('Сеть недоступна. Повторите.') }
    setSaving(false)
  }

  return (
    <div className="bg-white border border-[#e4e4e0] rounded-xl p-7 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      {done ? (
        <>
          <h2 className="text-[15px] font-semibold text-[#111110] mb-2">Пароль установлен</h2>
          <p className="text-[13px] text-[#8a8a85] mb-5">Теперь войдите с новым паролём.</p>
          <a href="/login" className="block w-full text-center bg-[#111110] text-white text-[14px] font-medium rounded-lg py-2.5 hover:bg-[#2a2a28] transition-colors">
            Войти
          </a>
        </>
      ) : (
        <>
          <h2 className="text-[15px] font-semibold text-[#111110] mb-1">Придумайте пароль</h2>
          <p className="text-[13px] text-[#8a8a85] mb-5">Его знаете только вы. Минимум 8 символов.</p>
          <form onSubmit={submit} className="space-y-3.5">
            <div>
              <label className="block text-[12px] font-medium text-[#6b6b66] mb-1.5 tracking-wide uppercase">Новый пароль</label>
              <input
                type="password" autoComplete="new-password" required autoFocus
                className="w-full bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-3 py-2.5 text-[14px] text-[#111110] outline-none focus:border-[#111110] focus:bg-white transition-all"
                value={pw} onChange={e => setPw(e.target.value)} placeholder="••••••••"
              />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-[#6b6b66] mb-1.5 tracking-wide uppercase">Повторите пароль</label>
              <input
                type="password" autoComplete="new-password" required
                className="w-full bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-3 py-2.5 text-[14px] text-[#111110] outline-none focus:border-[#111110] focus:bg-white transition-all"
                value={pw2} onChange={e => setPw2(e.target.value)} placeholder="••••••••"
              />
            </div>
            {error && (
              <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2.5">
                <p className="text-[13px] text-red-600">{error}</p>
              </div>
            )}
            <button
              type="submit" disabled={saving || !token}
              className="w-full mt-1 bg-[#111110] text-white text-[14px] font-medium rounded-lg py-2.5 hover:bg-[#2a2a28] disabled:opacity-40 transition-colors"
            >
              {saving ? 'Сохранение...' : 'Сохранить пароль'}
            </button>
            {!token && <p className="text-[12px] text-red-600">Ссылка без токена — попросите новую.</p>}
          </form>
        </>
      )}
    </div>
  )
}

export default function SetPasswordPage() {
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
          <p className="text-[13px] text-[#8a8a85] ml-9">Установка пароля</p>
        </div>
        <Suspense fallback={<div className="text-[13px] text-[#8a8a85]">Загрузка…</div>}>
          <SetPasswordInner />
        </Suspense>
      </div>
    </div>
  )
}
