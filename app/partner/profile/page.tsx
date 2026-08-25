import Link from 'next/link'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { resolvePartnerClient } from '@/lib/partnerClient'
import LegalEntities from './LegalEntities'

// Профиль партнёра: контакты/скидка (read-only) + свои юрлица (партнёр ведёт сам, A7).
// Доступ гейтит app/partner/layout.

export const dynamic = 'force-dynamic'

export default async function PartnerProfilePage() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return <div className="wrap"><div className="note"><div className="s">Не авторизован</div></div></div>

  const svc = createServiceClient()
  const client = await resolvePartnerClient<{ id: number; name: string; contact: string | null; phone: string | null; discount_percent: number | null }>(
    svc, user.id, 'id, name, contact, phone, discount_percent')
  if (!client) return (
    <div className="wrap"><div className="note">
      <div className="t">Аккаунт не привязан</div>
      <Link href="/partner" className="s" style={{ display: 'inline-block', marginTop: 10, color: 'var(--blue)' }}>← На главную</Link>
    </div></div>
  )

  const discount = Number(client.discount_percent) || 0

  const row = (label: string, value: string | null) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '9px 0', borderBottom: '1px solid var(--border)' }}>
      <span className="cap" style={{ flexShrink: 0 }}>{label}</span>
      <span style={{ textAlign: 'right', fontWeight: 500 }}>{value || '—'}</span>
    </div>
  )

  return (
    <div className="wrap">
      <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-.02em', marginBottom: 4 }}>Профиль</div>
      <div className="cap" style={{ marginBottom: 16 }}>Ваши данные. Контакты и скидку меняет менеджер; юрлица для счёта вы ведёте сами.</div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-h"><h3>Контакты</h3></div>
        <div style={{ padding: '0 2px' }}>
          {row('Компания', client.name)}
          {row('Контактное лицо', client.contact)}
          {row('Телефон', client.phone)}
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '9px 0' }}>
            <span className="cap">Ваша скидка</span>
            <span style={{ fontWeight: 700, color: discount > 0 ? 'var(--blue)' : 'var(--ink)' }}>{discount > 0 ? `${discount}%` : 'нет'}</span>
          </div>
        </div>
      </div>

      <LegalEntities />
    </div>
  )
}
