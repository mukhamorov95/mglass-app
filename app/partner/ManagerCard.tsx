'use client'

import { useEffect, useState } from 'react'
import type { ClientManager } from '@/lib/partner/manager'

// «Ваш менеджер» — кому звонить и писать. Нет назначенного — блок не показываем.
export function ManagerContacts({ m }: { m: ClientManager }) {
  const line = (label: string, value: React.ReactNode) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderTop: '1px solid var(--border)' }}>
      <span className="cap" style={{ flexShrink: 0 }}>{label}</span>
      <span style={{ textAlign: 'right', fontWeight: 500, overflowWrap: 'anywhere' }}>{value}</span>
    </div>
  )
  return (
    <div style={{ padding: '4px 14px 10px' }}>
      <div style={{ fontWeight: 700, fontSize: 15, padding: '6px 0 8px' }}>{m.name}</div>
      {m.phone && line('Телефон', <a href={`tel:${m.phone.replace(/[^\d+]/g, '')}`} style={{ color: 'var(--blue)' }}>{m.phone}</a>)}
      {m.telegram && line('Telegram', <a href={`https://t.me/${m.telegram}`} target="_blank" rel="noreferrer" style={{ color: 'var(--blue)' }}>@{m.telegram}</a>)}
      {m.email && line('Почта', <a href={`mailto:${m.email}`} style={{ color: 'var(--blue)' }}>{m.email}</a>)}
    </div>
  )
}

export default function ManagerCard() {
  const [m, setM] = useState<ClientManager | null>(null)
  useEffect(() => {
    fetch('/api/partner/manager').then(r => r.ok ? r.json() : null).then(d => setM(d?.manager ?? null)).catch(() => {})
  }, [])
  if (!m) return null
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="card-h"><h3>Ваш менеджер</h3></div>
      <ManagerContacts m={m} />
    </div>
  )
}
