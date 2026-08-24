'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'

// Вход в систему. Общий для сотрудников и партнёров. Премиальная тема,
// самодостаточные стили (.mgl) со светлой и тёмной палитрой (prefers-color-scheme),
// чтобы вид не зависел от конфигурации Tailwind. Логика входа/сброса без изменений.

const CSS = `
.mgl{--bg:#f5f5f3;--panel:#ffffff;--ink:#111110;--ink-2:#6b6b66;--muted:#9a9a95;
  --border:#e4e4e0;--field:#f8f8f7;--brand-lt:#d0574a;--brand-dk:#9c3529;
  --err-bg:#fef2f2;--err-bd:#f6d5d5;--err:#dc2626;
  min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;
  background:var(--bg);color:var(--ink);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  background-image:radial-gradient(120% 55% at 50% -10%,rgba(208,87,74,.06),transparent 60%);}
@media (prefers-color-scheme:dark){.mgl{--bg:#141413;--panel:#1f1f1e;--ink:#f4f4f1;--ink-2:#c8c8c3;
  --muted:#8a8a85;--border:#33332f;--field:#262625;--err-bg:#2a1a1a;--err-bd:#4a2a2a;--err:#f78d8d;
  background-image:radial-gradient(120% 55% at 50% -10%,rgba(208,87,74,.10),transparent 60%);}}
.mgl *{box-sizing:border-box}
.mgl .box{width:100%;max-width:360px}
.mgl .brand{display:flex;align-items:center;gap:11px;margin-bottom:6px}
.mgl .logo{width:30px;height:27px;display:flex;flex-shrink:0}
.mgl .logo svg{width:30px;height:27px;display:block}
.mgl .co{font-size:16px;font-weight:800;letter-spacing:.02em}
.mgl .tag{font-size:13px;color:var(--muted);margin:0 0 28px 41px}
.mgl .panel{background:var(--panel);border:1px solid var(--border);border-radius:16px;padding:26px;
  box-shadow:0 1px 3px rgba(0,0,0,.05),0 20px 48px -28px rgba(0,0,0,.3)}
.mgl h2{margin:0 0 18px;font-size:15px;font-weight:700}
.mgl .sub{margin:0 0 18px;font-size:13px;color:var(--ink-2);line-height:1.5}
.mgl form{display:flex;flex-direction:column;gap:13px}
.mgl label{display:block;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-2);margin-bottom:7px}
.mgl input{width:100%;background:var(--field);border:1px solid var(--border);border-radius:10px;
  padding:11px 13px;font-size:14px;color:var(--ink);font-family:inherit;outline:none;transition:.14s}
.mgl input::placeholder{color:var(--muted)}
.mgl input:focus{border-color:var(--ink);background:var(--panel)}
.mgl .btn{width:100%;margin-top:4px;background:var(--ink);color:var(--bg);border:0;border-radius:10px;
  padding:12px;font-size:14px;font-weight:600;cursor:pointer;transition:.14s;font-family:inherit}
.mgl .btn:hover{opacity:.9}.mgl .btn:disabled{opacity:.4;cursor:default}
.mgl .err{background:var(--err-bg);border:1px solid var(--err-bd);border-radius:10px;padding:10px 12px;font-size:13px;color:var(--err)}
.mgl .link{margin-top:14px;background:none;border:0;color:var(--ink-2);font-size:12.5px;cursor:pointer;font-family:inherit;padding:0}
.mgl .link:hover{color:var(--ink)}
.mgl b{color:var(--ink)}
`

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
      try { await fetch('/api/security/register-device', { method: 'POST' }) } catch { /* noop */ }
      setLoading(false)
      router.push('/')
      router.refresh()
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError(null)
    const { error } = await createClient().auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/set-password` })
    setLoading(false)
    if (error) setError('Не удалось отправить письмо. Проверьте email.')
    else setResetSent(true)
  }

  return (
    <div className="mgl">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="box">
        <div className="brand">
          <span className="logo" aria-label="M-Glass">
            <svg viewBox="0 0 64 56" xmlns="http://www.w3.org/2000/svg">
              <polygon points="0,3 15,3 15,53 0,53" fill="var(--brand-lt)" />
              <polygon points="15,3 32,28 32,44 15,19" fill="var(--brand-lt)" />
              <polygon points="49,3 64,3 64,53 49,53" fill="var(--brand-dk)" />
              <polygon points="49,3 32,28 32,44 49,19" fill="var(--brand-dk)" />
            </svg>
          </span>
          <span className="co">M‑GLASS</span>
        </div>
        <p className="tag">Система расчёта заказов</p>

        <div className="panel">
          {mode === 'login' ? (
            <>
              <h2>Вход в систему</h2>
              <form onSubmit={handleLogin}>
                <div>
                  <label>Email</label>
                  <input type="email" autoComplete="email" required value={email}
                    onChange={e => setEmail(e.target.value)} placeholder="email@mglass.ru" />
                </div>
                <div>
                  <label>Пароль</label>
                  <input type="password" autoComplete="current-password" required value={password}
                    onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
                </div>
                {error && <div className="err">{error}</div>}
                <button type="submit" className="btn" disabled={loading}>{loading ? 'Вход…' : 'Войти'}</button>
              </form>
              <button className="link" onClick={() => { setMode('reset'); setError(null) }}>Забыли пароль?</button>
            </>
          ) : resetSent ? (
            <>
              <h2>Проверьте почту</h2>
              <p className="sub">Отправили ссылку для сброса пароля на <b>{email}</b>. Перейдите по ней и задайте новый пароль.</p>
              <button className="link" onClick={() => { setMode('login'); setResetSent(false); setError(null) }}>← Ко входу</button>
            </>
          ) : (
            <>
              <h2>Восстановление пароля</h2>
              <p className="sub">Укажите email — пришлём ссылку для сброса пароля.</p>
              <form onSubmit={handleReset}>
                <div>
                  <label>Email</label>
                  <input type="email" autoComplete="email" required value={email}
                    onChange={e => setEmail(e.target.value)} placeholder="email@mglass.ru" />
                </div>
                {error && <div className="err">{error}</div>}
                <button type="submit" className="btn" disabled={loading}>{loading ? 'Отправка…' : 'Отправить ссылку'}</button>
              </form>
              <button className="link" onClick={() => { setMode('login'); setError(null) }}>← Назад ко входу</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
