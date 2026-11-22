'use client'

// ФП Ф3: деньги на счетах и сверка с банком. Опора — остаток из выписки
// (сохраняется при загрузке) или введённый вручную (касса, наличка). Расчёт —
// lib/accountRecon.ts.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { reconcileAccount, flowsFrom, accountLabel, type BalanceRow } from '@/lib/accountRecon'

type Entry = { account: string | null; entry_date: string; kind: string; amount: number }
type Transfer = { id: number; op_date: string; from_account: string; to_account: string; amount: number; comment: string | null }
type Unposted = { account: string | null; op_date: string; direction: string; amount: number }

const RUB = (n: number) => n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₽'
const DD = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(2, 4)}`
const num = (v: string) => Number(v.replace(/\s/g, '').replace(',', '.'))

export function AccountsRecon({ unit, isFin, myName, today }: { unit: 'ip' | 'ooo'; isFin: boolean; myName: string; today: string }) {
  const sb = createClient()
  const [balances, setBalances] = useState<BalanceRow[]>([])
  const [entries, setEntries] = useState<Entry[]>([])
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [unposted, setUnposted] = useState<Unposted[]>([])
  const [accountNames, setAccountNames] = useState<string[]>([])
  const [form, setForm] = useState<null | 'balance' | 'transfer'>(null)
  const [f, setF] = useState({ account: '', to: '', date: '', amount: '', comment: '' })
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    const b = await sb.from('cashflow_account_balances').select('account,as_of,balance,source').eq('unit', unit).order('as_of')
    const bal = ((b.data ?? []) as BalanceRow[]).map(x => ({ ...x, balance: Number(x.balance) }))
    const from = bal[0]?.as_of ?? today
    const [e, t, u, a] = await Promise.all([
      sb.from('cashflow_entries').select('account,entry_date,kind,amount').eq('unit', unit).gt('entry_date', from).range(0, 19999),
      sb.from('cashflow_transfers').select('id,op_date,from_account,to_account,amount,comment').eq('unit', unit).order('op_date', { ascending: false }),
      sb.from('bank_statement_rows').select('account,op_date,direction,amount').eq('unit', unit).eq('status', 'new').range(0, 4999),
      sb.from('cashflow_accounts').select('name').eq('unit', unit).eq('active', true).order('sort'),
    ])
    setBalances(bal)
    setEntries((e.data ?? []) as Entry[])
    setTransfers((t.data ?? []) as Transfer[])
    setUnposted((u.data ?? []) as Unposted[])
    setAccountNames(((a.data ?? []) as { name: string }[]).map(x => x.name))
  }, [sb, unit, today])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (today) load() }, [load, today])

  const flows = useMemo(() => flowsFrom(entries, transfers), [entries, transfers])
  const unpostedFlows = useMemo(() => unposted.filter(u => u.account).map(u => ({
    account: u.account as string, date: u.op_date, delta: u.direction === 'in' ? Number(u.amount) : -Number(u.amount),
  })), [unposted])
  const accounts = useMemo(() => {
    const set = new Set<string>([...balances.map(b => b.account), ...flows.map(x => x.account)])
    return [...set].sort()
  }, [balances, flows])
  const recons = useMemo(() => accounts.map(a => reconcileAccount(a, balances, flows, unpostedFlows, today)), [accounts, balances, flows, unpostedFlows, today])
  const total = recons.reduce((s, r) => s + (r.current ?? 0), 0)
  const noAnchor = recons.filter(r => !r.anchor)
  const choices = useMemo(() => [...new Set([...accounts, ...accountNames])], [accounts, accountNames])
  const unpostedSum = unpostedFlows.reduce((s, u) => s + u.delta, 0)

  async function submit() {
    const amount = num(f.amount)
    const date = f.date || today
    if (!f.account) { setMsg('Выбери счёт'); return }
    if (form === 'balance') {
      if (!Number.isFinite(amount)) { setMsg('Остаток — число'); return }
      const { data, error } = await sb.from('cashflow_account_balances').upsert(
        { unit, account: f.account, as_of: date, balance: amount, source: 'manual', entered_by: myName },
        { onConflict: 'unit,account,as_of,source' },
      ).select('id')
      if (error || !data?.length) { setMsg('Не сохранилось' + (error ? ': ' + error.message : ' — нет прав')); return }
    } else {
      if (!(amount > 0)) { setMsg('Сумма перевода — больше нуля'); return }
      if (!f.to || f.to === f.account) { setMsg('Счета перевода должны различаться'); return }
      const { data, error } = await sb.from('cashflow_transfers').insert(
        { unit, op_date: date, from_account: f.account, to_account: f.to, amount, comment: f.comment.trim() || null, created_by_name: myName },
      ).select('id')
      if (error || !data?.length) { setMsg('Не сохранилось' + (error ? ': ' + error.message : ' — нет прав')); return }
    }
    setForm(null)
    setF({ account: '', to: '', date: '', amount: '', comment: '' })
    setMsg('Сохранено ✓')
    await load()
  }

  return (
    <div className="bg-white rounded-xl border border-[#e4e4e0] p-4">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <p className="text-[14px] font-semibold text-[#111110]">Деньги на счетах</p>
        <p className="text-[12px] text-[#9a9a95]">по проведённым операциям на {DD(today)}</p>
      </div>
      {recons.length === 0 && <p className="text-[13px] text-[#9a9a95] mt-2">Остатков пока нет — появятся с ближайшей загрузкой выписки или после ввода вручную.</p>}
      {recons.map(r => {
        const last = r.checks[r.checks.length - 1]
        return (
          <div key={r.account} className="py-2 border-b border-[#f0f0ee] last:border-b-0">
            <div className="flex justify-between gap-3 text-[13px]">
              <span className="text-[#111110]">{accountLabel(r.account)}</span>
              <span className="font-mono font-semibold text-[#111110]">{r.current == null ? '—' : RUB(r.current)}</span>
            </div>
            {!r.anchor && <p className="text-[11px] text-amber-700">нет опорного остатка — {r.flowsWithoutAnchor} операций ждут; введи остаток на дату или загрузи выписку</p>}
            {r.anchor && <p className="text-[11px] text-[#9a9a95]">от остатка {RUB(r.anchor.balance)} на {DD(r.anchor.as_of)} ({r.anchor.source === 'bank' ? 'выписка' : 'вручную'})</p>}
            {last && (
              <p className={`text-[11px] ${Math.abs(last.diff) < 0.005 ? 'text-emerald-700' : last.unexplained === 0 ? 'text-amber-700' : 'text-red-600'}`}>
                {Math.abs(last.diff) < 0.005
                  ? `сверка на ${DD(last.as_of)}: сошлось с ${last.source === 'bank' ? 'банком' : 'введённым остатком'}`
                  : `сверка на ${DD(last.as_of)}: ${last.source === 'bank' ? 'банк' : 'введено'} ${RUB(last.actual)}, по ДДС ${RUB(last.computed)}, разница ${RUB(last.diff)}`
                    + (last.unposted ? `; не проведено строк выписки на ${RUB(last.unposted)}` : '')
                    + (Math.abs(last.unexplained) >= 0.005 ? `; без объяснения ${RUB(last.unexplained)}` : '')}
              </p>
            )}
          </div>
        )
      })}
      {recons.length > 0 && (
        <div className="flex justify-between gap-3 pt-2 mt-1 text-[13px]">
          <span className="font-semibold text-[#111110]">Всего{noAnchor.length ? ` (без ${noAnchor.length} сч. без остатка)` : ''}</span>
          <span className="font-mono font-semibold text-[#111110]">{RUB(total)}</span>
        </div>
      )}
      {unposted.length > 0 && (
        <p className="text-[11px] text-amber-700 mt-1">В выписке не проведено {unposted.length} строк ({unpostedSum >= 0 ? '+' : '−'}{RUB(Math.abs(unpostedSum))}) — остаток по ДДС отстаёт от банка.</p>
      )}
      {transfers.length > 0 && (
        <div className="mt-2">
          <p className="text-[11px] uppercase tracking-widest text-[#9a9a95]">Переводы между своими</p>
          {transfers.slice(0, 5).map(t => (
            <p key={t.id} className="text-[12px] text-[#4b4b47]">{DD(t.op_date)} · {accountLabel(t.from_account)} → {accountLabel(t.to_account)} · {RUB(Number(t.amount))}{t.comment ? ` · ${t.comment}` : ''}</p>
          ))}
        </div>
      )}
      {isFin && !form && (
        <div className="flex gap-2 mt-3 flex-wrap">
          <button onClick={() => { setForm('balance'); setMsg(null) }} className="px-3 py-1.5 rounded-lg border border-[#e4e4e0] text-[12px] text-[#4b4b47]">Остаток на дату</button>
          <button onClick={() => { setForm('transfer'); setMsg(null) }} className="px-3 py-1.5 rounded-lg border border-[#e4e4e0] text-[12px] text-[#4b4b47]">Перевод между своими</button>
        </div>
      )}
      {form && (
        <div className="mt-3 space-y-2">
          <div className="flex gap-2 flex-wrap">
            <select value={f.account} onChange={e => setF({ ...f, account: e.target.value })} className="border border-[#e4e4e0] rounded-lg px-2 py-1 text-[13px]">
              <option value="">{form === 'transfer' ? 'откуда' : 'счёт'}</option>
              {choices.map(c => <option key={c} value={c}>{accountLabel(c)}</option>)}
            </select>
            {form === 'transfer' && (
              <select value={f.to} onChange={e => setF({ ...f, to: e.target.value })} className="border border-[#e4e4e0] rounded-lg px-2 py-1 text-[13px]">
                <option value="">куда</option>
                {choices.map(c => <option key={c} value={c}>{accountLabel(c)}</option>)}
              </select>
            )}
            <input type="date" value={f.date || today} onChange={e => setF({ ...f, date: e.target.value })} className="border border-[#e4e4e0] rounded-lg px-2 py-1 text-[13px]" />
            <input value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} inputMode="decimal"
              placeholder={form === 'balance' ? 'остаток на конец дня' : 'сумма'}
              className="w-[150px] border border-[#e4e4e0] rounded-lg px-2 py-1 text-[13px] font-mono" />
          </div>
          {form === 'transfer' && (
            <input value={f.comment} onChange={e => setF({ ...f, comment: e.target.value })} placeholder="комментарий"
              className="w-full border border-[#e4e4e0] rounded-lg px-2 py-1 text-[13px]" />
          )}
          <div className="flex gap-2">
            <button onClick={submit} className="px-3 py-1.5 rounded-lg bg-[#111110] text-white text-[12px] font-semibold">Сохранить</button>
            <button onClick={() => setForm(null)} className="px-2 py-1.5 text-[12px] text-[#9a9a95]">отмена</button>
          </div>
        </div>
      )}
      {msg && <p className="text-[12px] text-[#4b4b47] mt-2">{msg}</p>}
      <p className="text-[11px] text-[#9a9a95] mt-2">Перевод между своими меняет остатки двух счетов, но не общий остаток и не оборот ДДС.</p>
    </div>
  )
}
