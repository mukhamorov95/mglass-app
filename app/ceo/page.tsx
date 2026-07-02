'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { PageHeader, SectionHeader } from '@/components/ds'

type ManagerStat = {
  id: number; name: string
  newLeads: number; callsMade: number; messagesSent: number; cardsMoved: number
  activeLeads: number; zone1: number; zone2: number; zone3: number
  staleZone1: number; staleZone2: number; invoiceStale: number
}

export default function CeoPage() {
  const [stats, setStats]   = useState<ManagerStat[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState(false)

  useEffect(() => {
    fetch('/api/commercial/stats?period=today')
      .then(r => r.json())
      .then(d => setStats(d.managers ?? []))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  const totals = stats.reduce((a, m) => ({
    active:   a.active   + m.activeLeads,
    zone1:    a.zone1    + m.zone1,
    zone2:    a.zone2    + m.zone2,
    zone3:    a.zone3    + m.zone3,
    calls:    a.calls    + m.callsMade,
    messages: a.messages + m.messagesSent,
    stale:    a.stale    + m.staleZone1 + m.staleZone2,
    invoice:  a.invoice  + m.invoiceStale,
  }), { active: 0, zone1: 0, zone2: 0, zone3: 0, calls: 0, messages: 0, stale: 0, invoice: 0 })

  const inactive = stats.filter(m => m.callsMade === 0 && m.messagesSent === 0)
  const sorted   = [...stats].sort((a, b) => b.activeLeads - a.activeLeads)

  return (
    <div className="min-h-screen bg-canvas">
      <div className="max-w-[1100px] mx-auto px-4 py-5">

        {/* Header */}
        <PageHeader
          title="CEO — Обзор бизнеса"
          subtitle={new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          actions={
            <Link href="/commercial"
              className="px-3 py-1.5 border border-line rounded-lg text-[12px] text-ink-soft hover:bg-surface hover:text-ink transition-colors">
              Детальная аналитика →
            </Link>
          }
        />

        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            {[1,2,3,4].map(i => <div key={i} className="bg-surface border border-line rounded-xl h-24 animate-pulse" />)}
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-[13px] text-red-600 mb-5">
            Не удалось загрузить данные из AmoCRM. Проверьте переменные окружения.
          </div>
        ) : (
          <>
            {/* KPI Row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
              {[
                { label: 'Активных сделок', value: totals.active, icon: '📊', sub: `К${totals.zone1} / П${totals.zone2} / Пр${totals.zone3}` },
                { label: 'Звонков сегодня', value: totals.calls,  icon: '📞', sub: 'вся команда' },
                { label: 'Сообщений',        value: totals.messages, icon: '💬', sub: 'вся команда' },
                { label: 'Зависших лидов',  value: totals.stale,  icon: '⚠️', sub: `счетов просроч: ${totals.invoice}`, alert: totals.stale > 5 },
              ].map(k => (
                <div key={k.label} className={`bg-surface border rounded-xl px-4 py-3 ${k.alert ? 'border-red-300' : 'border-line'}`}>
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-muted mb-1">{k.icon} {k.label}</p>
                  <p className={`text-[28px] font-semibold font-mono leading-none tabular-nums ${k.alert ? 'text-red-500' : 'text-ink'}`}>{k.value}</p>
                  <p className="text-[11px] text-faint mt-1">{k.sub}</p>
                </div>
              ))}
            </div>

            {/* Alerts */}
            {inactive.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-3 mb-4 flex items-start gap-3">
                <span className="text-[18px] mt-0.5">🔴</span>
                <div>
                  <p className="text-[13px] font-semibold text-red-700">Нулевая активность</p>
                  <p className="text-[12px] text-red-600 mt-0.5">
                    {inactive.map(m => m.name.split(' ')[0]).join(', ')} — ни звонков, ни сообщений за сегодня
                  </p>
                </div>
              </div>
            )}

            {totals.invoice > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 mb-4 flex items-start gap-3">
                <span className="text-[18px] mt-0.5">🟡</span>
                <div>
                  <p className="text-[13px] font-semibold text-amber-700">Счета без оплаты &gt;5 дней</p>
                  <p className="text-[12px] text-amber-600 mt-0.5">{totals.invoice} счёт(ов) ожидают оплаты более 5 дней</p>
                </div>
              </div>
            )}

            {/* Manager table */}
            <div className="bg-surface border border-line rounded-xl overflow-hidden mb-5">
              <div className="px-5 py-3 border-b border-line-soft">
                <SectionHeader title="Менеджеры — сегодня" />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-line-soft text-[11px] font-semibold uppercase tracking-widest text-muted">
                      <th className="px-5 py-2.5 text-left">Менеджер</th>
                      <th className="px-3 py-2.5 text-center">Лидов</th>
                      <th className="px-3 py-2.5 text-center">Звонков</th>
                      <th className="px-3 py-2.5 text-center">Сообщ</th>
                      <th className="px-3 py-2.5 text-center">Перем</th>
                      <th className="px-3 py-2.5 text-center">Активных</th>
                      <th className="px-3 py-2.5 text-center">Зависших</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-subtle">
                    {sorted.map(m => {
                      const isInactive = m.callsMade === 0 && m.messagesSent === 0
                      const staleTotal = m.staleZone1 + m.staleZone2
                      return (
                        <tr key={m.id} className={`hover:bg-subtle transition-colors ${isInactive ? 'bg-red-50/30' : ''}`}>
                          <td className="px-5 py-3 font-medium text-ink">
                            {m.name.split(' ')[0]}
                            {isInactive && <span className="ml-2 text-[11px] text-red-500 bg-red-50 px-1.5 py-0.5 rounded">0 активности</span>}
                          </td>
                          <td className="px-3 py-3 text-center font-mono tabular-nums">{m.newLeads}</td>
                          <td className={`px-3 py-3 text-center font-mono font-semibold tabular-nums ${m.callsMade === 0 ? 'text-red-400' : 'text-green-600'}`}>{m.callsMade}</td>
                          <td className={`px-3 py-3 text-center font-mono font-semibold tabular-nums ${m.messagesSent === 0 ? 'text-orange-400' : 'text-green-600'}`}>{m.messagesSent}</td>
                          <td className="px-3 py-3 text-center font-mono tabular-nums">{m.cardsMoved}</td>
                          <td className="px-3 py-3 text-center font-mono font-semibold text-ink tabular-nums">{m.activeLeads}</td>
                          <td className={`px-3 py-3 text-center font-mono font-semibold tabular-nums ${staleTotal > 3 ? 'text-red-500' : staleTotal > 0 ? 'text-orange-400' : 'text-faint'}`}>
                            {staleTotal || '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Quick links */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { href: '/commercial',          label: '📈 Коммерческий' },
                { href: '/admin/health-check',  label: '🔧 Health Check' },
                { href: '/admin/users',         label: '👥 Пользователи' },
                { href: '/admin/sales-center',  label: '📣 Sales Center' },
              ].map(l => (
                <Link key={l.href} href={l.href}
                  className="flex items-center gap-2 px-4 py-3 bg-surface border border-line rounded-xl text-[13px] text-ink hover:bg-canvas transition-colors">
                  {l.label}
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
