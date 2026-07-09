'use client'

import { useEffect, useState, useCallback } from 'react'
import { DEVICE_CLASS_LABELS, type DeviceClass } from '@/lib/deviceClass'

// Безопасность: активные устройства по каждому сотруднику + журнал событий
// входа. Политика: 1 телефон + 1 ПК на аккаунт; вход на новом устройстве
// вытесняет старое. Частые «вытеснения» у одного аккаунта = аккаунтом делятся.

type Device = {
  id: string; user_id: string; device_class: DeviceClass; user_agent: string | null
  last_ip: string | null; created_at: string; last_seen_at: string
  revoked_at: string | null; revoked_reason: string | null
}
type SecEvent = {
  id: number; user_id: string | null; email: string | null; event: string
  device_class: DeviceClass | null; user_agent: string | null; ip: string | null; created_at: string
}
type UserLite = { id: string; name: string | null; email: string | null }

const EVENT_LABELS: Record<string, { label: string; cls: string }> = {
  login:             { label: 'Вход',                    cls: 'bg-emerald-50 text-emerald-700' },
  device_registered: { label: 'Новое устройство',        cls: 'bg-blue-50 text-blue-700' },
  device_replaced:   { label: 'Смена устройства',        cls: 'bg-amber-50 text-amber-700' },
  device_kicked:     { label: '⚠️ Вытеснено устройство', cls: 'bg-red-50 text-red-700' },
  logout_forced:     { label: 'Отключено админом',       cls: 'bg-red-50 text-red-700' },
}

function shortUA(ua: string | null): string {
  if (!ua) return '—'
  const os = /iphone|ipad/i.test(ua) ? 'iPhone' : /android/i.test(ua) ? 'Android' : /mac os/i.test(ua) ? 'Mac' : /windows/i.test(ua) ? 'Windows' : /linux/i.test(ua) ? 'Linux' : '?'
  const br = /edg\//i.test(ua) ? 'Edge' : /yabrowser/i.test(ua) ? 'Яндекс' : /chrome/i.test(ua) ? 'Chrome' : /safari/i.test(ua) ? 'Safari' : /firefox/i.test(ua) ? 'Firefox' : '?'
  return `${os} · ${br}`
}
const fmtDT = (s: string) => new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

export default function SecurityPage() {
  const [devices, setDevices] = useState<Device[]>([])
  const [events, setEvents] = useState<SecEvent[]>([])
  const [users, setUsers] = useState<UserLite[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [revoking, setRevoking] = useState<string | null>(null)
  const [kicksByUser, setKicksByUser] = useState<Map<string, number>>(new Map())

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/security/devices')
      const j = await r.json()
      setDevices(j.devices ?? []); setEvents(j.events ?? []); setUsers(j.users ?? []); setErrors(j.errors ?? [])
      // сигнал шаринга: вытеснения за последние 7 дней по пользователю
      const weekAgo = Date.now() - 7 * 86400_000
      const kicks = new Map<string, number>()
      for (const e of (j.events ?? []) as SecEvent[])
        if (e.event === 'device_kicked' && e.user_id && new Date(e.created_at).getTime() > weekAgo)
          kicks.set(e.user_id, (kicks.get(e.user_id) ?? 0) + 1)
      setKicksByUser(kicks)
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  async function revoke(id: string) {
    setRevoking(id)
    try { await fetch('/api/security/devices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }); await load() }
    finally { setRevoking(null) }
  }

  const userOf = (uid: string | null) => users.find(u => u.id === uid)
  const nameOf = (uid: string | null, email?: string | null) => userOf(uid)?.name || userOf(uid)?.email || email || uid?.slice(0, 8) || '—'
  const active = devices.filter(d => !d.revoked_at)
  const byUser = new Map<string, Device[]>()
  for (const d of active) { const l = byUser.get(d.user_id) ?? []; l.push(d); byUser.set(d.user_id, l) }

  return (
    <div className="min-h-screen bg-[#f5f5f3] p-6">
      <div className="max-w-[900px]">
        <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Безопасность</h1>
        <p className="text-[13px] text-[#9a9a95] mt-0.5 mb-5">Устройства сотрудников и журнал входов · правило: 1 телефон + 1 ПК на аккаунт</p>

        {errors.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-[13px] text-amber-800 mb-4">
            ⚠️ {errors.join(' · ')} — вероятно, не применена миграция 20260709_security_devices.sql
          </div>
        )}

        {/* Сигнал шаринга */}
        {[...kicksByUser.entries()].filter(([, n]) => n >= 3).length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4">
            <p className="text-[13px] font-bold text-red-700 mb-1">Похоже на передачу аккаунта</p>
            {[...kicksByUser.entries()].filter(([, n]) => n >= 3).map(([uid, n]) => (
              <p key={uid} className="text-[13px] text-red-700">{nameOf(uid)} — {n} вытеснений устройств за 7 дней</p>
            ))}
          </div>
        )}

        {/* Устройства по сотрудникам */}
        <div className="bg-white rounded-xl border border-[#e4e4e0] overflow-hidden mb-5">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-[#9a9a95] px-4 pt-3.5 pb-2">Активные устройства · {active.length}</p>
          {loading ? <p className="text-[13px] text-[#9a9a95] px-4 pb-4">Загрузка…</p> :
            active.length === 0 ? <p className="text-[13px] text-[#9a9a95] px-4 pb-4">Пока пусто — устройства появляются при входе сотрудников</p> : (
            <div className="divide-y divide-[#f0f0ec]">
              {[...byUser.entries()].map(([uid, devs]) => (
                <div key={uid} className="px-4 py-2.5">
                  <p className="text-[13px] font-semibold text-[#111110]">{nameOf(uid)}
                    {(kicksByUser.get(uid) ?? 0) > 0 && <span className="ml-2 text-[10px] font-medium px-1.5 py-px rounded-full bg-red-50 text-red-600">{kicksByUser.get(uid)} вытесн./7дн</span>}
                  </p>
                  <div className="mt-1 space-y-1">
                    {devs.map(d => (
                      <div key={d.id} className="flex items-center justify-between gap-2">
                        <span className="text-[12px] text-[#6b6b66]">
                          {d.device_class === 'mobile' ? '📱' : '💻'} {DEVICE_CLASS_LABELS[d.device_class]} · {shortUA(d.user_agent)}
                          {d.last_ip && <span className="text-[#b0b0aa]"> · {d.last_ip}</span>}
                          <span className="text-[#b0b0aa]"> · был {fmtDT(d.last_seen_at)}</span>
                        </span>
                        <button onClick={() => revoke(d.id)} disabled={revoking === d.id}
                          className="text-[11px] px-2 py-0.5 rounded-md border border-[#e4e4e0] text-[#6b6b66] hover:border-red-300 hover:text-red-600 disabled:opacity-40 transition-colors">
                          {revoking === d.id ? '...' : 'Отключить'}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Журнал */}
        <div className="bg-white rounded-xl border border-[#e4e4e0] overflow-hidden">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-[#9a9a95] px-4 pt-3.5 pb-2">Журнал событий · последние {events.length}</p>
          <div className="divide-y divide-[#f8f8f7] max-h-[480px] overflow-y-auto">
            {events.map(e => {
              const ev = EVENT_LABELS[e.event] ?? { label: e.event, cls: 'bg-[#f0f0ec] text-[#6b6b66]' }
              return (
                <div key={e.id} className="px-4 py-2 flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] text-[#b0b0aa] font-mono w-[86px] flex-shrink-0">{fmtDT(e.created_at)}</span>
                  <span className={`text-[10px] font-medium px-1.5 py-px rounded-full ${ev.cls}`}>{ev.label}</span>
                  <span className="text-[12px] font-medium text-[#111110]">{nameOf(e.user_id, e.email)}</span>
                  <span className="text-[11px] text-[#9a9a95]">{e.device_class ? (e.device_class === 'mobile' ? '📱' : '💻') : ''} {shortUA(e.user_agent)}{e.ip ? ` · ${e.ip}` : ''}</span>
                </div>
              )
            })}
            {!loading && events.length === 0 && <p className="text-[13px] text-[#9a9a95] px-4 py-3">Событий пока нет</p>}
          </div>
        </div>
      </div>
    </div>
  )
}
