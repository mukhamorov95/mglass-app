'use client'

import { useEffect, useState } from 'react'
import { loadJson } from '@/lib/toast'
import { confirmDialog } from '@/lib/dialog'
import { TEAM_ROLES, TEAM_ROLE_RU, type TeamRole } from '@/lib/partner/teamRoles'

// «Команда» (docs/PARTNER_TEAM_ROUTE.md, Т2): руководитель партнёра сам выдаёт доступы своим людям.
// Пароль человек задаёт сам по ссылке — руководитель его не знает и не видит.

type Member = {
  userId: string; name: string | null; email: string | null; role: TeamRole; primary: boolean; disabled: boolean
  invitedBy: string | null; createdAt: string | null; lastSeen: string | null; days30: number; quotes30: number; passwordSet: boolean
}
type Resp = { team: Member[]; seats: { used: number; max: number }; me: string }

const ROLE_HINT: Record<TeamRole, string> = {
  admin: 'всё, включая команду',
  manager: 'просчёты, заказы, цены, статус оплаты',
  accountant: 'заказы, цены, оплаты, счета, УПД, реквизиты',
  storekeeper: 'заказы, сроки, получение — без цен',
}
const fmtSeen = (s: string | null) => s
  ? new Date(s).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  : 'ещё не заходил'

export default function PartnerTeamPage() {
  const [data, setData] = useState<Resp | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<TeamRole>('manager')
  const [busy, setBusy] = useState(false)
  const [formErr, setFormErr] = useState<string | null>(null)
  const [link, setLink] = useState<{ who: string; url: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [rowErr, setRowErr] = useState<{ id: string; text: string } | null>(null)

  const apply = (r: Awaited<ReturnType<typeof loadJson<Resp>>>) => {
    if (r.error === null) { setData(r.data); setErr(null) } else setErr(r.error)
  }
  const load = () => loadJson<Resp>('/api/partner/team').then(apply)
  useEffect(() => { loadJson<Resp>('/api/partner/team').then(apply) }, [])

  async function invite(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setFormErr(null)
    try {
      const res = await fetch('/api/partner/team', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, email, role }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setFormErr(d.error || `Не добавлен (${res.status})`); return }
      setLink({ who: `${name} — ${TEAM_ROLE_RU[role]}`, url: d.link }); setCopied(false)
      setName(''); setEmail(''); setRole('manager'); setOpen(false)
      await load()
    } catch { setFormErr('Нет связи — проверьте интернет и повторите') }
    finally { setBusy(false) }
  }

  async function patch(m: Member, body: Record<string, unknown>) {
    setRowErr(null)
    try {
      const res = await fetch('/api/partner/team', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: m.userId, ...body }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setRowErr({ id: m.userId, text: d.error || `Не сохранено (${res.status})` }); return }
      await load()
    } catch { setRowErr({ id: m.userId, text: 'Нет связи — не сохранено' }) }
  }

  async function relink(m: Member) {
    setRowErr(null)
    const res = await fetch('/api/partner/team', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'relink', userId: m.userId }) })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) { setRowErr({ id: m.userId, text: d.error || 'Ссылка не создана' }); return }
    setLink({ who: m.name ?? m.email ?? 'сотрудник', url: d.link }); setCopied(false)
  }

  async function toggle(m: Member) {
    if (!m.disabled && !(await confirmDialog({ title: `Отключить ${m.name ?? m.email}?`, text: 'Человек сразу потеряет доступ к кабинету. Включить обратно можно здесь же.', confirmLabel: 'Отключить', danger: true }))) return
    await patch(m, { disabled: !m.disabled })
  }

  async function copy() {
    if (!link) return
    try { await navigator.clipboard.writeText(link.url); setCopied(true) } catch { setCopied(false) }
  }

  const full = !!data && data.seats.used >= data.seats.max

  return (
    <>
      <div className="top">
        <div>
          <h1>Команда</h1>
          <div className="cap">У каждого сотрудника свой вход и своя роль. Пароль человек задаёт сам по ссылке.</div>
        </div>
        <button className="primary" onClick={() => { setOpen(o => !o); setFormErr(null) }} disabled={full}>＋ Пригласить</button>
      </div>
      <div className="wrap">
        {err && <div className="perr">Команда не загрузилась: {err}</div>}
        {data && <div className="cap" style={{ marginBottom: 12 }}>Мест занято: {data.seats.used} из {data.seats.max}{full ? ' — чтобы добавить, отключите неактивного сотрудника или напишите нам' : ''}</div>}

        {link && (
          <div className="card" style={{ marginBottom: 14 }}>
            <div style={{ fontWeight: 600 }}>Ссылка для входа: {link.who}</div>
            <div className="cap" style={{ marginTop: 4 }}>Перешлите её сотруднику сами (мессенджер, почта). По ссылке он задаст пароль; она одноразовая и действует 7 дней.</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <input readOnly value={link.url} onFocus={e => e.currentTarget.select()} style={{ flex: '1 1 260px', minWidth: 0 }} />
              <button className="ghost" onClick={copy}>{copied ? 'Скопировано' : 'Копировать'}</button>
              <button className="ghost" onClick={() => setLink(null)}>Готово</button>
            </div>
          </div>
        )}

        {open && (
          <form className="card" onSubmit={invite} style={{ marginBottom: 14, display: 'grid', gap: 10 }}>
            <div style={{ fontWeight: 600 }}>Новый сотрудник</div>
            <label className="cap">Имя<input value={name} onChange={e => setName(e.target.value)} placeholder="Анна Петрова" maxLength={80} required style={{ display: 'block', width: '100%', marginTop: 4 }} /></label>
            <label className="cap">Email — станет логином<input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="anna@company.ru" required style={{ display: 'block', width: '100%', marginTop: 4 }} /></label>
            <div className="cap">Роль</div>
            <div style={{ display: 'grid', gap: 6 }}>
              {TEAM_ROLES.map(r => (
                <label key={r} style={{ display: 'flex', gap: 8, alignItems: 'baseline', cursor: 'pointer' }}>
                  <input type="radio" name="role" checked={role === r} onChange={() => setRole(r)} />
                  <span><b>{TEAM_ROLE_RU[r]}</b> <span className="cap">— {ROLE_HINT[r]}</span></span>
                </label>
              ))}
            </div>
            {formErr && <div className="perr">{formErr}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="primary" type="submit" disabled={busy}>{busy ? 'Добавляю…' : 'Добавить и получить ссылку'}</button>
              <button className="ghost" type="button" onClick={() => setOpen(false)}>Отмена</button>
            </div>
          </form>
        )}

        {data && data.team.map(m => (
          <div key={m.userId} className="ord" style={{ opacity: m.disabled ? 0.6 : 1 }}>
            <div className="r1">
              <div style={{ minWidth: 0 }}>
                <div className="num">{m.name ?? m.email ?? 'Без имени'}{m.userId === data.me ? <span className="yr"> · это вы</span> : null}</div>
                <div className="meta">{m.email ?? '—'}</div>
                <div className="meta">
                  {m.disabled ? 'Отключён' : !m.passwordSet ? 'Ещё не задал пароль' : `Последний вход: ${fmtSeen(m.lastSeen)}`}
                  {!m.disabled && m.passwordSet ? ` · дней с заходами за 30: ${m.days30}` : ''}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                {m.primary || m.userId === data.me
                  ? <span className="pill p-ready">{TEAM_ROLE_RU[m.role]}</span>
                  : (
                    <select value={m.role} disabled={m.disabled} onChange={e => patch(m, { role: e.target.value })} aria-label="Роль">
                      {TEAM_ROLES.map(r => <option key={r} value={r}>{TEAM_ROLE_RU[r]}</option>)}
                    </select>
                  )}
              </div>
            </div>
            {!m.primary && m.userId !== data.me && (
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                {!m.disabled && <button className="ghost" onClick={() => relink(m)}>Новая ссылка для входа</button>}
                <button className="ghost" onClick={() => toggle(m)}>{m.disabled ? 'Включить' : 'Отключить'}</button>
              </div>
            )}
            {m.primary && <div className="meta" style={{ marginTop: 6 }}>Основной вход компании — меняется через M-Glass.</div>}
            {rowErr?.id === m.userId && <div className="perr">{rowErr.text}</div>}
          </div>
        ))}
      </div>
    </>
  )
}
