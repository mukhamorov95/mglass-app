'use client'

import { useState } from 'react'
import { toast } from '@/lib/toast'
import { CLIENT_NO_MAX } from '@/lib/partner/orderSearch'

// Номер заказа клиента рядом с нашим: показать, поставить, поправить. Сохраняется сразу.
export default function ClientNoEditor({ orderId, value, canEdit, onSaved }: {
  orderId: number; value: string | null; canEdit: boolean; onSaved: (v: string | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      const r = await fetch(`/api/partner/order/${orderId}/client-number`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientOrderNumber: draft }),
      })
      const d = await r.json().catch(() => ({})) as { clientOrderNumber?: string | null; error?: string }
      if (!r.ok) { toast.error('Номер не сохранён', { detail: d.error ?? `Ошибка ${r.status}` }); return }
      onSaved(d.clientOrderNumber ?? null); setEditing(false)
      toast.success(d.clientOrderNumber ? `Ваш № ${d.clientOrderNumber} сохранён` : 'Ваш номер убран', { detail: 'По нему можно искать в заказах, документах и отгрузках.' })
    } catch { toast.error('Номер не сохранён', { detail: 'Сеть недоступна' }) }
    finally { setSaving(false) }
  }

  if (editing) return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', fontSize: 14, fontWeight: 400 }}>
      <input autoFocus value={draft} maxLength={CLIENT_NO_MAX} onChange={e => setDraft(e.target.value)} placeholder="Ваш номер заказа"
        onKeyDown={e => { if (e.key === 'Enter') void save(); if (e.key === 'Escape') setEditing(false) }}
        style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 9, padding: '6px 10px', fontSize: 14, color: 'var(--ink)', fontFamily: 'inherit', width: 180 }} />
      <button className="primary" onClick={save} disabled={saving}>{saving ? '…' : 'Сохранить'}</button>
      <button className="ghost" onClick={() => { setEditing(false); setDraft(value ?? '') }}>Отмена</button>
    </span>
  )
  return (
    <span style={{ color: 'var(--muted)', fontWeight: 400 }}>
      {' · '}{value ? <>ваш № {value}</> : 'ваш № не указан'}
      {canEdit && (
        <button onClick={() => { setDraft(value ?? ''); setEditing(true) }} title={value ? 'Изменить ваш номер' : 'Указать ваш номер заказа'}
          style={{ marginLeft: 6, background: 'none', border: 0, color: 'var(--blue)', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>
          {value ? '✎' : '＋ указать'}
        </button>
      )}
    </span>
  )
}
