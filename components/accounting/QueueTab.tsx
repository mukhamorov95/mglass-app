'use client'

// «Ждут действия» — стартовая вкладка бухгалтерии: что ждёт сейчас и куда идти.
// Числа — из /api/accounting/queue; источник не загрузился — так и написано.

import Link from 'next/link'
import { queueCounts, type Count, type QueueKey, type QueueSnapshot } from '@/lib/accounting/queue'

const RUB = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'

type Card = { key: QueueKey; title: string; hint: string; tab?: string; href?: string; action: string; sub?: string | null }

export function QueueTab({ data, error, loading, onGo, onReload }: {
  data: QueueSnapshot | null
  error: string | null
  loading: boolean
  onGo: (tab: 'bank' | 'audit' | 'unposted' | 'docs') => void
  onReload: () => void
}) {
  if (loading && !data) return <p className="text-[13px] text-[#9a9a95] py-6 text-center">Собираю очередь…</p>
  if (error && !data) {
    return (
      <div className="px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-[13px] text-red-700">
        Очередь не загрузилась: {error}
        <button onClick={onReload} className="ml-2 underline">повторить</button>
      </div>
    )
  }
  if (!data) return null

  const c = queueCounts(data)
  const bank = data.bank.ok ? data.bank.value : null
  const upd = data.upd.ok ? data.upd.value : null
  const inv = data.invoices.ok ? data.invoices.value : null

  const cards: Card[] = [
    {
      key: 'bank', title: 'Выписка — к разнесению', tab: 'bank', action: 'Разнести',
      hint: 'Новые строки банковской выписки: приход по счёту закрывает счёт, расход — заявку.',
      sub: bank && bank.total ? `ИП ${bank.ip} · ООО ${bank.ooo}` : null,
    },
    {
      key: 'audit', title: 'Проверка', tab: 'audit', action: 'Смотреть',
      hint: 'Срочное и «к работе»: задвоения, непроведённое, налоги, зарплата.',
      sub: data.audit.ok ? data.audit.value.filter(f => f.severity === 'high').map(f => f.title).slice(0, 2).join(' · ') || null : null,
    },
    {
      key: 'unposted', title: 'К проведению', tab: 'unposted', action: 'Провести',
      hint: 'Оплаты из платежей, которых ещё нет в ОДДС (за полгода).',
    },
    {
      key: 'upd', title: 'Ждут УПД', href: '/accounting/upd', action: 'Выдать',
      hint: 'Отгружено после перехода на приложение, а УПД не выдан.',
      sub: upd?.state === 'pending_sql' ? 'Реестр УПД появится после SQL владельца'
        : upd?.state === 'no_series' ? `Серия номеров ${upd.year} года не задана — задайте на странице УПД`
        : upd?.state === 'ok' ? [upd.sum ? RUB(upd.sum) : '', upd.noInn ? `без ИНН ${upd.noInn}` : '', upd.undated ? `без даты отгрузки ${upd.undated}` : ''].filter(Boolean).join(' · ') || null
        : null,
    },
    {
      key: 'invoices', title: 'Счета ждут оплаты', tab: 'docs', action: 'Открыть',
      hint: 'Не оплачены по платежам — остаток к получению.',
      sub: inv && inv.count ? `остаток ${RUB(inv.sum)}` : null,
    },
  ]

  const show = (v: Count) => typeof v === 'number' ? String(v) : v === null ? '—' : '?'

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-[#6b6b66]">Что ждёт вашего действия на {data.today.slice(8, 10)}.{data.today.slice(5, 7)}.</p>
        <button onClick={onReload} disabled={loading} className="text-[12px] text-[#9a9a95] underline disabled:opacity-50">{loading ? 'обновляю…' : 'обновить'}</button>
      </div>
      {cards.map(card => {
        const v = c[card.key]
        const failed = v !== null && typeof v === 'object'
        const busy = typeof v === 'number' && v > 0
        return (
          <div key={card.key} className={`rounded-xl border px-4 py-3 flex items-center gap-4 ${failed ? 'border-red-200 bg-red-50' : busy ? 'border-amber-200 bg-white' : 'border-[#e4e4e0] bg-white'}`}>
            <span className={`text-[24px] font-bold font-mono w-14 text-center flex-shrink-0 ${failed ? 'text-red-600' : busy ? 'text-[#111110]' : 'text-[#c9c9c4]'}`}>{show(v)}</span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-medium text-[#111110]">{card.title}</p>
              <p className="text-[12px] text-[#9a9a95] mt-0.5">
                {failed ? `Не загрузилось: ${(v as { error: string }).error}` : card.hint}
              </p>
              {!failed && card.sub && <p className="text-[12px] text-[#6b6b66] mt-0.5">{card.sub}</p>}
            </div>
            {card.href ? (
              <Link href={card.href} className="px-3 py-1.5 rounded-lg border border-[#111110] text-[12px] font-medium text-[#111110] flex-shrink-0">{card.action} →</Link>
            ) : (
              <button onClick={() => onGo(card.tab as 'bank' | 'audit' | 'unposted' | 'docs')}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-medium flex-shrink-0 ${busy ? 'bg-[#111110] text-white' : 'border border-[#e4e4e0] text-[#6b6b66]'}`}>
                {card.action} →
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
