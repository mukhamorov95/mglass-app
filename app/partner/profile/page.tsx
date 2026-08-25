import Link from 'next/link'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'

// Профиль партнёра (read-only): контакты, скидка, юрлица. Правки — через менеджера
// (партнёр не редактирует реквизиты сам). Доступ гейтит app/partner/layout.

export const dynamic = 'force-dynamic'

type Entity = {
  id: number; full_name: string | null; inn: string | null; kpp: string | null
  legal_address: string | null; is_default: boolean
}

export default async function PartnerProfilePage() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return <div className="wrap"><div className="note"><div className="s">Не авторизован</div></div></div>

  const svc = createServiceClient()
  const { data: client } = await svc.from('b2b_clients')
    .select('id, name, contact, phone, discount_percent')
    .eq('user_id', user.id).maybeSingle()
  if (!client) return (
    <div className="wrap"><div className="note">
      <div className="t">Аккаунт не привязан</div>
      <Link href="/partner" className="s" style={{ display: 'inline-block', marginTop: 10, color: 'var(--blue)' }}>← На главную</Link>
    </div></div>
  )

  const { data: ent } = await svc.from('b2b_client_legal_entities')
    .select('id, full_name, inn, kpp, legal_address, is_default')
    .eq('client_id', client.id).eq('active', true)
    .order('is_default', { ascending: false })
  const entities = (ent ?? []) as Entity[]
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
      <div className="cap" style={{ marginBottom: 16 }}>Ваши данные. Изменить контакты или реквизиты — напишите вашему менеджеру.</div>

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

      <div className="card">
        <div className="card-h"><h3>Юридические лица</h3><span className="mut">{entities.length}</span></div>
        {entities.length === 0 ? (
          <div className="cap" style={{ padding: '4px 2px' }}>Реквизиты не заданы. Для счёта/договора передайте их менеджеру.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {entities.map(e => (
              <div key={e.id} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 600 }}>{e.full_name || 'Без названия'}</span>
                  {e.is_default && <span className="pill p-quote" style={{ fontSize: 11, padding: '2px 8px' }}>основное</span>}
                </div>
                <div className="cap" style={{ marginTop: 4 }}>
                  {[e.inn ? `ИНН ${e.inn}` : '', e.kpp ? `КПП ${e.kpp}` : ''].filter(Boolean).join(' · ')}
                </div>
                {e.legal_address && <div className="cap" style={{ marginTop: 2 }}>{e.legal_address}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
