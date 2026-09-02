'use client'

// Панель платных сервисов: что подключено, что даёт, во сколько обходится и когда
// платить. Заведена после 02.09.2026, когда у OpenAI кончились кредиты и это
// выяснилось только по отказу функции: никто не знал ни про баланс, ни сколько
// сервисов вообще подключено.
//
// Стоимости и даты вводит владелец — у большинства провайдеров биллинг закрыт
// для API-ключа, взять их автоматически неоткуда. Живая проверка ключей — рядом,
// но она отвечает на «работает ли», а не на «есть ли деньги»: у OpenAI ключ
// отвечает и с нулевым балансом.

import { useCallback, useEffect, useMemo, useState } from 'react'

type Service = {
  id: number; key: string; name: string; gives: string; breaks_if_off: string | null
  monthly_cost: number | null; currency: string; billing: string | null
  next_payment: string | null; balance_note: string | null; critical: boolean
  status: 'ok' | 'warn' | 'down' | 'unknown' | 'off'; checked_at: string | null; notes: string | null
}

const STATUS: Record<Service['status'], { label: string; cls: string }> = {
  ok:      { label: 'работает',    cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  warn:    { label: 'внимание',    cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  down:    { label: 'не отвечает', cls: 'bg-red-50 text-red-700 border-red-200' },
  off:     { label: 'не подключен',cls: 'bg-[#f0f0ec] text-[#9a9a95] border-[#e4e4e0]' },
  unknown: { label: 'не проверен', cls: 'bg-[#f0f0ec] text-[#9a9a95] border-[#e4e4e0]' },
}
const BILLING: Record<string, string> = {
  subscription: 'подписка', prepaid: 'предоплата', usage: 'по расходу', free: 'бесплатно',
}
const RUB = (n: number) => Math.round(n).toLocaleString('ru-RU')

export default function ServicesPage() {
  const [items, setItems] = useState<Service[]>([])
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(false)
  const [edit, setEdit] = useState<number | null>(null)
  // Момент «сейчас» берём один раз при монтировании: Date.now() в расчёте
  // считается нечистым вызовом при рендере и ломает предсказуемость.
  const [now, setNow] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const r = await fetch('/api/admin/services').then(x => x.json()).catch(() => null)
    setItems(r?.services ?? [])
    setLoading(false)
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setNow(Date.now()); load().catch(() => setLoading(false)) }, [load])

  async function check() {
    setChecking(true)
    await fetch('/api/admin/services', { method: 'POST' }).catch(() => {})
    await load()
    setChecking(false)
  }

  async function save(id: number, patch: Partial<Service>) {
    setItems(prev => prev.map(s => (s.id === id ? { ...s, ...patch } : s)))
    await fetch('/api/admin/services', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...patch }),
    }).catch(() => {})
  }

  const totals = useMemo(() => {
    const known = items.filter(s => s.monthly_cost != null && s.monthly_cost > 0)
    const sum = known.reduce((a, s) => a + Number(s.monthly_cost), 0)
    const critNoPrice = items.filter(s => s.critical && (s.monthly_cost == null))
    const problems = items.filter(s => s.status === 'down' || s.status === 'warn')
    const soon = now == null ? [] : items.filter(s => s.next_payment && new Date(s.next_payment).getTime() - now < 14 * 86400000)
    return { sum, known: known.length, critNoPrice, problems, soon }
  }, [items, now])

  return (
    <div className="min-h-screen bg-[#f8f8f7] p-6">
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-[22px] font-bold text-[#111110] tracking-tight">Платные сервисы</h1>
            <p className="text-[13px] text-[#9a9a95] mt-0.5">Что подключено, что даёт, сколько стоит и когда платить</p>
          </div>
          <button onClick={check} disabled={checking}
            className="px-4 py-2 rounded-lg bg-[#111110] text-white text-[13px] font-semibold hover:bg-black disabled:opacity-40">
            {checking ? 'Проверяю…' : '⟳ Проверить все'}
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-[#e4e4e0] border border-[#e4e4e0] rounded-xl overflow-hidden">
          <div className="bg-white p-4">
            <p className="text-[24px] font-bold text-[#111110] tabular-nums">{RUB(totals.sum)} ₽</p>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#9a9a95] mt-1.5">в месяц · известно по {totals.known}</p>
          </div>
          <div className="bg-white p-4">
            <p className={`text-[24px] font-bold tabular-nums ${totals.critNoPrice.length ? 'text-amber-600' : 'text-[#111110]'}`}>{totals.critNoPrice.length}</p>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#9a9a95] mt-1.5">критичных без цены</p>
          </div>
          <div className="bg-white p-4">
            <p className={`text-[24px] font-bold tabular-nums ${totals.problems.length ? 'text-red-600' : 'text-emerald-600'}`}>{totals.problems.length}</p>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#9a9a95] mt-1.5">требуют внимания</p>
          </div>
          <div className="bg-white p-4">
            <p className={`text-[24px] font-bold tabular-nums ${totals.soon.length ? 'text-amber-600' : 'text-[#111110]'}`}>{totals.soon.length}</p>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#9a9a95] mt-1.5">платить в 2 недели</p>
          </div>
        </div>

        {totals.critNoPrice.length > 0 && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
            <p className="text-[13px] text-amber-900">
              <span className="font-semibold">Сумма неполная.</span> У {totals.critNoPrice.length} критичных сервисов цена не указана:{' '}
              {totals.critNoPrice.map(s => s.name).join(', ')}. Пока их нет в расчёте, «сколько нужно в месяц» — не ответ, а половина ответа.
            </p>
          </div>
        )}

        {loading ? <p className="text-[13px] text-[#9a9a95]">Загрузка…</p> : (
          <div className="space-y-2">
            {items.map(s => {
              const st = STATUS[s.status] ?? STATUS.unknown
              const open = edit === s.id
              return (
                <div key={s.id} className={`bg-white rounded-xl border px-4 py-3 ${s.critical ? 'border-[#d4d4cf]' : 'border-[#eceff1]'}`}>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-[15px] font-bold text-[#111110]">{s.name}</p>
                        {s.critical && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#111110] text-white">без него встанет работа</span>}
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${st.cls}`}>{st.label}</span>
                        {s.billing && <span className="text-[11px] text-[#9a9a95]">{BILLING[s.billing] ?? s.billing}</span>}
                      </div>
                      <p className="text-[13px] text-[#6b6b66] mt-1">{s.gives}</p>
                      {s.breaks_if_off && <p className="text-[12px] text-[#9a9a95] mt-0.5">Без него: {s.breaks_if_off}</p>}
                      {s.balance_note && <p className="text-[11px] text-[#9a9a95] mt-1 font-mono">{s.balance_note}</p>}
                      {s.notes && <p className="text-[11px] text-[#c4c4be] mt-1">{s.notes}</p>}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-[17px] font-bold text-[#111110] tabular-nums">
                        {s.monthly_cost != null ? `${RUB(Number(s.monthly_cost))} ${s.currency === 'USD' ? '$' : '₽'}` : <span className="text-[#c4c4be] text-[13px] font-normal">цена не указана</span>}
                      </p>
                      {s.next_payment && <p className="text-[11px] text-[#9a9a95]">платёж {new Date(s.next_payment).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })}</p>}
                      <button onClick={() => setEdit(open ? null : s.id)}
                        className="text-[11px] text-[#9a9a95] hover:text-[#111110] underline underline-offset-2 mt-1">
                        {open ? 'свернуть' : 'указать'}
                      </button>
                    </div>
                  </div>

                  {open && (
                    <div className="mt-3 pt-3 border-t border-[#f0f0ec] grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <label className="text-[11px] text-[#9a9a95]">₽ в месяц
                        <input type="number" defaultValue={s.monthly_cost ?? ''} onBlur={e => save(s.id, { monthly_cost: e.target.value === '' ? null : Number(e.target.value) })}
                          className="mt-1 w-full border border-[#e4e4e0] rounded-lg px-2 min-h-[40px] text-[13px] text-[#111110] outline-none focus:border-[#111110]" />
                      </label>
                      <label className="text-[11px] text-[#9a9a95]">Следующий платёж
                        <input type="date" defaultValue={s.next_payment ?? ''} onBlur={e => save(s.id, { next_payment: e.target.value || null })}
                          className="mt-1 w-full border border-[#e4e4e0] rounded-lg px-2 min-h-[40px] text-[13px] text-[#111110] outline-none focus:border-[#111110]" />
                      </label>
                      <label className="text-[11px] text-[#9a9a95]">Тип оплаты
                        <select defaultValue={s.billing ?? ''} onChange={e => save(s.id, { billing: e.target.value || null })}
                          className="mt-1 w-full border border-[#e4e4e0] rounded-lg px-2 min-h-[40px] text-[13px] text-[#111110] outline-none focus:border-[#111110]">
                          <option value="">—</option>
                          {Object.entries(BILLING).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                      </label>
                      <label className="text-[11px] text-[#9a9a95]">Критичный
                        <select defaultValue={s.critical ? '1' : '0'} onChange={e => save(s.id, { critical: e.target.value === '1' })}
                          className="mt-1 w-full border border-[#e4e4e0] rounded-lg px-2 min-h-[40px] text-[13px] text-[#111110] outline-none focus:border-[#111110]">
                          <option value="1">да — без него встанет</option>
                          <option value="0">нет — неудобство</option>
                        </select>
                      </label>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
