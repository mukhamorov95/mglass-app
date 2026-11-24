'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase-browser'

export default function ChangePassword() {
  const [open, setOpen] = useState(false)
  const [pwd, setPwd] = useState('')
  const [pwd2, setPwd2] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const input = { background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', fontSize: 13.5, color: 'var(--ink)', fontFamily: 'inherit', outline: 'none', width: '100%' } as const

  async function save() {
    setMsg(null)
    if (pwd.length < 8) { setMsg({ ok: false, text: 'Минимум 8 символов' }); return }
    if (pwd !== pwd2) { setMsg({ ok: false, text: 'Пароли не совпадают' }); return }
    setSaving(true)
    try {
      const { error } = await createClient().auth.updateUser({ password: pwd })
      if (error) { setMsg({ ok: false, text: `Не сохранено: ${error.message}` }); return }
      setMsg({ ok: true, text: 'Пароль изменён — при следующем входе используйте новый' })
      setPwd(''); setPwd2(''); setOpen(false)
    } catch { setMsg({ ok: false, text: 'Не сохранено: нет связи, попробуйте ещё раз' }) }
    finally { setSaving(false) }
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-h"><h3>Вход в кабинет</h3>
        {!open && <button className="ghost" onClick={() => { setOpen(true); setMsg(null) }}>Сменить пароль</button>}
      </div>
      <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {open && <>
          <input style={input} type="password" value={pwd} onChange={e => { setPwd(e.target.value); setMsg(null) }} placeholder="Новый пароль (мин. 8 символов)" autoFocus />
          <input style={input} type="password" value={pwd2} onChange={e => { setPwd2(e.target.value); setMsg(null) }} placeholder="Повторите пароль" onKeyDown={e => { if (e.key === 'Enter') save() }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="primary" onClick={save} disabled={saving} style={{ flex: 1 }}>{saving ? 'Сохраняю…' : 'Сохранить пароль'}</button>
            <button className="ghost" onClick={() => { setOpen(false); setPwd(''); setPwd2(''); setMsg(null) }}>Отмена</button>
          </div>
        </>}
        {msg && <div style={{ fontSize: 12.5, color: msg.ok ? 'var(--green)' : '#dc2626' }}>{msg.text}</div>}
        {!open && !msg && <div className="cap">Пароль знаете только вы. Забыли — напишите менеджеру.</div>}
      </div>
    </div>
  )
}
