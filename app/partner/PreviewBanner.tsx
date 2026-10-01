'use client'

import { useEffect, useState } from 'react'

// Плашка режима «Смотреть как партнёр»: владелец всегда видит, чьими глазами смотрит и
// что от имени партнёра ничего не сохранится. Партнёру не показывается (у него preview: null).

type Preview = { id: number; name: string; is_test: boolean } | null

export default function PreviewBanner() {
  const [p, setP] = useState<Preview>(null)
  useEffect(() => {
    fetch('/api/partner/preview').then(r => r.json()).then(d => setP(d.preview ?? null)).catch(() => setP(null))
  }, [])
  if (!p) return null

  async function exit() {
    await fetch('/api/partner/preview', { method: 'DELETE' }).catch(() => {})
    window.location.href = '/admin/b2b-access'
  }

  return (
    <div style={{
      position: 'sticky', top: 0, zIndex: 50, gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      padding: '8px 16px', background: '#fff4d6', borderBottom: '1px solid #f0d58a', color: '#5c4400', fontSize: 13,
    }}>
      <b>Режим просмотра</b>
      <span>кабинет глазами «{p.name}»{p.is_test ? ' (тестовый)' : ''} · {p.is_test ? 'сохраняются только настройки прилавка' : 'ничего не сохраняется'}</span>
      <button onClick={exit} style={{ marginLeft: 'auto', border: '1px solid #d9b85a', background: '#fff', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontSize: 12.5, color: '#5c4400' }}>Выйти</button>
    </div>
  )
}
