'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { PageHeader } from '@/components/ds'

type StaleInfo = { id: number; name: string; daysStale: number; stageName: string }

type DealData = {
  user: { id: number; name: string; email: string }
  today: { newLeads: number; callsMade: number; messagesSent: number; cardsMoved: number }
  activeLeads: number
  zone1: number; zone2: number; zone3: number
  staleZone1: StaleInfo[]; staleZone2: StaleInfo[]
  staleZone3: StaleInfo[]; invoiceStale: StaleInfo[]
  domain: string
}

function ZoneBadge({ zone, count }: { zone: 1 | 2 | 3; count: number }) {
  const cfg = {
    1: { color: 'bg-blue-50 text-blue-700 border-blue-200',   label: 'Квалификация' },
    2: { color: 'bg-orange-50 text-orange-700 border-orange-200', label: 'Продажа' },
    3: { color: 'bg-green-50 text-green-700 border-green-200',  label: 'Производство' },
  }[zone]
  return (
    <div className={`rounded-xl border px-5 py-4 ${cfg.color}`}>
      <p className="text-[11px] font-semibold uppercase tracking-widest opacity-60 mb-1">{cfg.label}</p>
      <p className="text-[32px] font-semibold leading-none font-mono tabular-nums">{count}</p>
      <p className="text-[11px] mt-1 opacity-60">сделок</p>
    </div>
  )
}

function StaleList({ title, items, domain, color }: {
  title: string; items: StaleInfo[]; domain: string; color: string
}) {
  if (items.length === 0) return null
  return (
    <div className="bg-surface border border-line rounded-xl overflow-hidden">
      <div className={`px-5 py-3 border-b border-line-soft flex items-center justify-between`}>
        <span className="text-[11px] font-semibold uppercase tracking-widest text-muted">{title}</span>
        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full tabular-nums ${color}`}>{items.length}</span>
      </div>
      <div className="divide-y divide-canvas">
        {items.map(s => (
          <a key={s.id} href={`https://${domain}/leads/detail/${s.id}`} target="_blank" rel="noreferrer"
            className="px-5 py-3 flex items-center justify-between hover:bg-subtle transition-colors">
            <div>
              <p className="text-[13px] font-medium text-ink">{s.name}</p>
              <p className="text-[11px] text-muted mt-0.5">{s.stageName}</p>
            </div>
            <span className="text-[12px] font-semibold text-red-600 shrink-0 ml-3 tabular-nums">{s.daysStale}д</span>
          </a>
        ))}
      </div>
    </div>
  )
}

export default function ManagerPage() {
  const [data, setData]     = useState<DealData | null>(null)
  const [error, setError]   = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/manager/deals')
      .then(r => r.json())
      .then(d => {
        if (d.error === 'amo_not_configured') {
          setError('amo_not_configured')
        } else if (d.error) {
          setError(d.error)
        } else {
          setData(d)
        }
      })
      .catch(() => setError('network'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center text-[13px] text-muted">
      Загружаю данные из AmoCRM…
    </div>
  )

  if (error === 'amo_not_configured') return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="max-w-md text-center px-6">
        <div className="text-4xl mb-4">🔗</div>
        <h2 className="text-[16px] font-semibold text-ink mb-2">AmoCRM не привязан</h2>
        <p className="text-[13px] text-ink-soft leading-relaxed mb-4">
          Попросите администратора привязать ваш аккаунт к AmoCRM в разделе
          <strong> Пользователи → ваш профиль → AmoCRM User ID</strong>.
        </p>
        <Link href="/manager-dashboard"
          className="inline-flex items-center gap-2 px-4 py-2 bg-ink text-white rounded-lg text-[13px] font-medium hover:bg-[#2a2a28] transition-colors">
          B2B Дашборд →
        </Link>
      </div>
    </div>
  )

  if (error || !data) return (
    <div className="min-h-screen flex items-center justify-center text-[13px] text-red-500">
      Ошибка загрузки данных. Попробуйте обновить страницу.
    </div>
  )

  const firstName = data.user.name.split(' ')[0]
  const hasStale  = data.staleZone1.length + data.staleZone2.length + data.invoiceStale.length

  return (
    <div className="min-h-screen bg-canvas">
      <div className="max-w-[1100px] mx-auto px-4 py-5">

        {/* Header */}
        <PageHeader
          title={`Мои сделки — ${firstName}`}
          subtitle={new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}
          actions={
            <a href={`https://${data.domain}/leads/`} target="_blank" rel="noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 border border-line rounded-lg text-[12px] text-ink-soft hover:bg-surface hover:text-ink transition-colors">
              Открыть AmoCRM ↗
            </a>
          }
        />

        {/* Активность сегодня */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          {[
            { label: 'Новых лидов',    value: data.today.newLeads,     icon: '📥' },
            { label: 'Звонков',        value: data.today.callsMade,    icon: '📞' },
            { label: 'Сообщений',      value: data.today.messagesSent, icon: '💬' },
            { label: 'Перемещений',    value: data.today.cardsMoved,   icon: '🔀' },
          ].map(k => (
            <div key={k.label} className="bg-surface border border-line rounded-xl px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-1">
                {k.icon} {k.label}
              </p>
              <p className="text-[28px] font-semibold font-mono leading-none text-ink tabular-nums">{k.value}</p>
              <p className="text-[10px] text-faint mt-1">за сегодня</p>
            </div>
          ))}
        </div>

        {/* Зоны */}
        <div className="mb-5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-3">
            Всего активных: <span className="text-ink text-[13px] tabular-nums">{data.activeLeads}</span>
          </p>
          <div className="grid grid-cols-3 gap-3">
            <ZoneBadge zone={1} count={data.zone1} />
            <ZoneBadge zone={2} count={data.zone2} />
            <ZoneBadge zone={3} count={data.zone3} />
          </div>
        </div>

        {/* Требуют внимания */}
        {hasStale > 0 && (
          <div className="mb-5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-3">
              Требуют внимания сегодня
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <StaleList
                title={`Зона 1 — зависшие >2д (${data.staleZone1.length})`}
                items={data.staleZone1} domain={data.domain}
                color="bg-red-50 text-red-600" />
              <StaleList
                title={`Счёт без оплаты >5д (${data.invoiceStale.length})`}
                items={data.invoiceStale} domain={data.domain}
                color="bg-red-50 text-red-600" />
              <StaleList
                title={`Зона 2 — без движения >3д (${data.staleZone2.length})`}
                items={data.staleZone2} domain={data.domain}
                color="bg-orange-50 text-orange-600" />
              <StaleList
                title={`Зона 3 — производство >3д (${data.staleZone3.length})`}
                items={data.staleZone3} domain={data.domain}
                color="bg-yellow-50 text-yellow-700" />
            </div>
          </div>
        )}

        {hasStale === 0 && (
          <div className="bg-green-50 border border-green-200 rounded-xl px-5 py-4 text-center text-[13px] text-green-700 font-medium mb-5">
            ✅ Зависших сделок нет — все в норме
          </div>
        )}

        {/* Быстрые действия */}
        <div className="bg-surface border border-line rounded-xl p-5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-3">Быстрые действия</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { href: '/calculator/mirror', icon: '🪞', label: 'Зеркало' },
              { href: '/calculator/shower', icon: '🚿', label: 'Душевая' },
              { href: '/calculator/loft',   icon: '🏗️', label: 'Лофт' },
              { href: '/calculations',      icon: '📋', label: 'История КП' },
            ].map(l => (
              <Link key={l.href} href={l.href}
                className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-line text-[13px] text-ink hover:bg-canvas transition-colors">
                <span>{l.icon}</span> {l.label}
              </Link>
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}
