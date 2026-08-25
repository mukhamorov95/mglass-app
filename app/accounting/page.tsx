'use client'

// Бухгалтерия (Б1): ОДДС по фондам владельца + ввод операций.
// Структура = Google-листы «ИП ДДС»/«ООО ДДС»: фонд (жёлтая строка) → подфонды,
// свёрнуты, клик раскрывает. Классы: переменные → маржа → постоянные → фонды.
// Вносят Алёна и Екатерина (роль accountant); видят также cfo/admin/ceo.

import { useEffect, useState, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { RequestsTab, CommitteeTab } from '@/components/accounting/RequestsTabs'
import { FinweekTab } from '@/components/accounting/FinweekTab'
import { NotesTab } from '@/components/accounting/NotesTab'
import { UnpostedTab } from '@/components/accounting/UnpostedTab'
import { DocumentsTab } from '@/components/accounting/DocumentsTab'
import { BankTab } from '@/components/accounting/BankTab'
import { PayrollTab } from '@/components/accounting/PayrollTab'
import { TaxesTab } from '@/components/accounting/TaxesTab'

type Fund = { id: number; unit: string; flow: string; fund_class: string; name: string; percent: number | null; sort: number; active: boolean }
type Subfund = { id: number; fund_id: number; name: string; sort: number; active: boolean }
type Account = { id: number; unit: string; name: string; sort: number }
type Entry = { id: number; entry_date: string; unit: string; kind: string; fund_id: number; subfund_id: number | null; amount: number; account: string | null; counterparty: string | null; comment: string | null; entered_by_name: string | null; attachment_path: string | null }

const RUB = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'
const CLASS_LABEL: Record<string, string> = { variable: 'Переменные расходы', fixed: 'Постоянные расходы', fund: 'Фонды' }
const monthLabel = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  return ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'][m - 1] + ' ' + y
}
const shiftMonth = (ym: string, d: number) => {
  const [y, m] = ym.split('-').map(Number)
  const t = y * 12 + (m - 1) + d
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
}

export default function AccountingPage() {
  const sb = createClient()
  const [tab, setTab] = useState<'odds' | 'finweek' | 'entry' | 'unposted' | 'bank' | 'payroll' | 'taxes' | 'docs' | 'requests' | 'committee' | 'notes'>('odds')
  const [unposted, setUnposted] = useState(0)
  const [locked, setLocked] = useState(false)
  const [log, setLog] = useState<{ id: number; entry_id: number; action: string; entry_date: string; actor: string | null; at: string; amount: number }[]>([])
  const [myRole, setMyRole] = useState('')
  const [myName, setMyName] = useState('')
  const [unit, setUnit] = useState<'ip' | 'ooo'>('ip')
  const [month, setMonth] = useState('')
  const [funds, setFunds] = useState<Fund[]>([])
  const [subfunds, setSubfunds] = useState<Subfund[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [entries, setEntries] = useState<Entry[]>([])
  const [open, setOpen] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<string | null>(null)

  // форма ввода
  const [fDate, setFDate] = useState('')
  const [fKind, setFKind] = useState<'in' | 'out'>('out')
  const [fFund, setFFund] = useState<number | 0>(0)
  const [fSub, setFSub] = useState<number | 0>(0)
  const [fAmount, setFAmount] = useState('')
  const [fAccount, setFAccount] = useState('')
  const [fCp, setFCp] = useState('')
  const [fComment, setFComment] = useState('')
  const [saving, setSaving] = useState(false)

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2800) }

  useEffect(() => {
    const d = new Date()
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    setFDate(d.toISOString().slice(0, 10))
    const savedUnit = localStorage.getItem('acc_unit')
    if (savedUnit === 'ooo') setUnit('ooo')
    sb.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      sb.from('users').select('role,name').eq('id', user.id).maybeSingle().then(({ data }) => {
        const u = data as { role?: string; name?: string } | null
        setMyRole(u?.role ?? '')
        setMyName(u?.name ?? user.email ?? '')
        if (u?.role === 'buyer') setTab('requests')
      })
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const load = useCallback(async () => {
    if (!month) return
    const from = `${month}-01`
    const to = `${shiftMonth(month, 1)}-01`
    const [f, s, a, e] = await Promise.all([
      sb.from('cashflow_funds').select('*').eq('active', true).order('sort'),
      sb.from('cashflow_subfunds').select('*').eq('active', true).order('sort'),
      sb.from('cashflow_accounts').select('*').eq('active', true).order('sort'),
      sb.from('cashflow_entries').select('*').gte('entry_date', from).lt('entry_date', to).order('id', { ascending: false }),
    ])
    setFunds((f.data ?? []) as Fund[])
    setSubfunds((s.data ?? []) as Subfund[])
    setAccounts((a.data ?? []) as Account[])
    setEntries((e.data ?? []) as Entry[])
    setLoading(false)
  }, [sb, month])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load().catch(() => setLoading(false)) }, [load])

  const loadPeriod = useCallback(async () => {
    if (!month) return
    const r = await fetch(`/api/accounting/period?unit=${unit}&month=${month}`)
    if (!r.ok) return
    const j = await r.json()
    setLocked(!!j.locked)
    setLog(j.log ?? [])
  }, [unit, month])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadPeriod().catch(() => {}) }, [loadPeriod])

  async function togglePeriod() {
    const action = locked ? 'unlock' : 'lock'
    if (!confirm(locked
      ? 'Открыть месяц заново? Правки снова станут возможны.'
      : 'Закрыть месяц? После этого операции этого месяца нельзя будет ни добавить, ни изменить.')) return
    const r = await fetch('/api/accounting/period', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unit, month, action }),
    })
    const j = await r.json().catch(() => ({}))
    flash(r.ok ? (j.locked ? 'Месяц закрыт' : 'Месяц открыт') : (j.error ?? 'Не получилось'))
    await loadPeriod()
  }

  const loadUnposted = useCallback(async () => {
    if (!month) return
    const [y, m] = month.split('-').map(Number)
    const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
    const r = await fetch(`/api/accounting/unposted?from=${month}-01&to=${to}`)
    if (!r.ok) return
    const j = await r.json()
    setUnposted((j.items as { skipped: boolean }[]).filter(i => !i.skipped).length)
  }, [month])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadUnposted().catch(() => {}) }, [loadUnposted])

  const isFin = ['accountant', 'cfo', 'admin', 'ceo'].includes(myRole)
  const isBuyer = myRole === 'buyer'
  const unitFunds = useMemo(() => funds.filter(f => f.unit === unit), [funds, unit])
  const unitEntries = useMemo(() => entries.filter(e => e.unit === unit), [entries, unit])
  const sumFund = useCallback((fundId: number) => unitEntries.filter(e => e.fund_id === fundId).reduce((s, e) => s + Number(e.amount), 0), [unitEntries])
  const sumSub = useCallback((subId: number) => unitEntries.filter(e => e.subfund_id === subId).reduce((s, e) => s + Number(e.amount), 0), [unitEntries])

  const income = unitFunds.filter(f => f.fund_class === 'income').reduce((s, f) => s + sumFund(f.id), 0)
  const variable = unitFunds.filter(f => f.fund_class === 'variable').reduce((s, f) => s + sumFund(f.id), 0)
  const margin = income - variable
  const fixedAndFunds = unitFunds.filter(f => ['fixed', 'fund'].includes(f.fund_class)).reduce((s, f) => s + sumFund(f.id), 0)

  // Автоподстановка фонда/подфонда по контрагенту (последняя операция)
  async function onCpBlur() {
    if (!fCp.trim() || fFund) return
    const { data } = await sb.from('cashflow_entries')
      .select('fund_id, subfund_id, account')
      .eq('unit', unit).ilike('counterparty', fCp.trim())
      .order('id', { ascending: false }).limit(1).maybeSingle()
    const last = data as { fund_id: number; subfund_id: number | null; account: string | null } | null
    if (last) {
      setFFund(last.fund_id)
      setFSub(last.subfund_id ?? 0)
      if (last.account) setFAccount(last.account)
      flash('Фонд подставлен по контрагенту')
    }
  }

  async function addSubfund(fundId: number) {
    const name = prompt('Название нового подфонда:')?.trim()
    if (!name) return
    const { error } = await sb.from('cashflow_subfunds').insert({ fund_id: fundId, name, sort: 99 })
    if (error) { flash('Не добавилось: ' + error.message); return }
    await load()
  }

  async function addFund() {
    const name = prompt('Название нового фонда:')?.trim()
    if (!name) return
    const cls = prompt('Класс: 1 — переменные, 2 — постоянные, 3 — фонды', '2')?.trim()
    const fund_class = cls === '1' ? 'variable' : cls === '3' ? 'fund' : 'fixed'
    const { error } = await sb.from('cashflow_funds').insert({ unit, flow: 'out', fund_class, name, sort: 98 })
    if (error) { flash('Не добавилось: ' + error.message); return }
    await load()
  }

  async function attach(entryId: number, file: File) {
    const body = new FormData()
    body.append('entry_id', String(entryId))
    body.append('file', file)
    const r = await fetch('/api/accounting/entry-attachment', { method: 'POST', body })
    const j = await r.json().catch(() => ({}))
    flash(r.ok ? 'Вложение сохранено ✓' : (j.error ?? 'Не загрузилось'))
    if (r.ok) await load()
  }

  async function saveEntry() {
    const amount = Number(fAmount.replace(/\s/g, '').replace(',', '.'))
    if (!fFund || !(amount > 0)) { flash('Выбери фонд и сумму'); return }
    setSaving(true)
    const { data: { user } } = await sb.auth.getUser()
    let name: string | null = null
    if (user) {
      const { data: u } = await sb.from('users').select('name').eq('id', user.id).maybeSingle()
      name = (u as { name?: string } | null)?.name ?? user.email ?? null
    }
    const { error } = await sb.from('cashflow_entries').insert({
      entry_date: fDate, unit, kind: fKind, fund_id: fFund,
      subfund_id: fSub || null, amount, account: fAccount || null,
      counterparty: fCp.trim() || null, comment: fComment.trim() || null,
      entered_by: user?.id ?? null, entered_by_name: name,
    })
    setSaving(false)
    if (error) { flash('Ошибка: ' + error.message); return }
    localStorage.setItem('acc_unit', unit)
    setFAmount(''); setFCp(''); setFComment(''); setFFund(0); setFSub(0)
    flash('Операция записана ✓')
    await load()
  }

  if (loading) return <div className="min-h-screen bg-[#f5f5f3] flex items-center justify-center text-[13px] text-[#9a9a95]">Загрузка…</div>

  const fundRow = (f: Fund) => {
    const total = sumFund(f.id)
    const subs = subfunds.filter(s => s.fund_id === f.id)
    const isOpen = open.has(f.id)
    const isVar = f.fund_class === 'variable'
    const bg = f.fund_class === 'income' ? 'bg-emerald-50 border-emerald-200' : isVar ? 'bg-amber-50 border-amber-200' : 'bg-white border-[#e4e4e0]'
    return (
      <div key={f.id}>
        <button onClick={() => setOpen(prev => { const n = new Set(prev); if (n.has(f.id)) n.delete(f.id); else n.add(f.id); return n })}
          className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border ${bg} mb-1`}>
          <span className="text-[13px] font-semibold text-[#111110]">{isOpen ? '▾' : '▸'} {f.name}</span>
          <span className="text-[13px] font-mono text-[#4b4b47]">
            {f.percent != null && <span className="text-[#9a9a95] mr-2">{f.percent}%</span>}
            {RUB(total)}
          </span>
        </button>
        {isOpen && (
          <div className="pl-6 pr-2 pb-2">
            {subs.map(s => (
              <div key={s.id} className="flex justify-between py-1 text-[13px] text-[#4b4b47]">
                <span>{s.name}</span>
                <span className="font-mono">{RUB(sumSub(s.id))}</span>
              </div>
            ))}
            <button onClick={() => addSubfund(f.id)} className="text-[12px] text-blue-600 py-1">＋ добавить подфонд</button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-16">
      {toast && <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 rounded-xl shadow-lg text-[13px] font-semibold bg-[#111110] text-white">{toast}</div>}

      <div className="bg-white border-b border-[#e4e4e0] px-4 pt-6 pb-0 sticky top-0 z-40">
        <div className="max-w-[760px] mx-auto">
          <div className="flex items-center justify-between">
            <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">🧾 Бухгалтерия</h1>
            <div className="flex bg-[#f0f0ec] rounded-[10px] p-[3px]">
              {(['ip', 'ooo'] as const).map(u => (
                <button key={u} onClick={() => setUnit(u)}
                  className={`px-4 py-1.5 rounded-lg text-[13px] font-medium ${unit === u ? 'bg-white shadow-sm text-[#111110]' : 'text-[#6b6b66]'}`}>
                  {u === 'ip' ? 'ИП' : 'ООО'}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-1 mt-3 -mb-px overflow-x-auto no-scrollbar">
            {(isBuyer
              ? ([['requests', 'Заявки на оплату']] as const)
              : ([['odds', 'ОДДС'], ['finweek', 'Финнеделя'], ['entry', 'Ввод операций'], ['unposted', 'К проведению'], ['bank', 'Выписка'], ['payroll', 'Зарплата'], ['taxes', 'Налоги'], ['docs', 'Документы'], ['requests', 'Заявки'], ['committee', 'Комитет'], ['notes', '🎙 Предложения']] as const)
            ).map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)}
                className={`px-3.5 py-2 text-[13px] font-medium border-b-2 whitespace-nowrap flex-shrink-0 ${tab === k ? 'border-[#111110] text-[#111110]' : 'border-transparent text-[#9a9a95]'}`}>
                {label}
                {k === 'unposted' && unposted > 0 && (
                  <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[11px] font-semibold">{unposted}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-[760px] mx-auto px-4 pt-4">
        {tab === 'odds' && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <button onClick={() => setMonth(shiftMonth(month, -1))} className="px-2.5 py-1 rounded-md border border-[#e4e4e0] text-[13px]">←</button>
                <span className="text-[14px] font-semibold text-[#111110] capitalize min-w-[120px] text-center">{month && monthLabel(month)}</span>
                <button onClick={() => setMonth(shiftMonth(month, 1))} className="px-2.5 py-1 rounded-md border border-[#e4e4e0] text-[13px]">→</button>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={togglePeriod}
                  className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border ${
                    locked ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-[#e4e4e0] text-[#6b6b66]'}`}>
                  {locked ? '🔒 месяц закрыт' : 'Закрыть месяц'}
                </button>
                {!locked && <button onClick={addFund} className="px-3 py-1.5 rounded-lg bg-[#111110] text-white text-[12px] font-medium">＋ Фонд</button>}
              </div>
            </div>

            {unitFunds.filter(f => f.fund_class === 'income').map(fundRow)}

            <p className="text-[11px] uppercase tracking-widest text-[#9a9a95] mt-4 mb-1.5">{CLASS_LABEL.variable}</p>
            {unitFunds.filter(f => f.fund_class === 'variable').map(fundRow)}

            <div className="flex justify-between px-3 py-2.5 my-2 border-y border-[#d8d8d3] text-[13px]">
              <span className="font-semibold text-blue-700">Маржа после переменных</span>
              <span className="font-mono font-semibold text-blue-700">{RUB(margin)}{income > 0 && ` · ${Math.round(margin / income * 100)}%`}</span>
            </div>

            <p className="text-[11px] uppercase tracking-widest text-[#9a9a95] mt-4 mb-1.5">{CLASS_LABEL.fixed}</p>
            {unitFunds.filter(f => f.fund_class === 'fixed').map(fundRow)}

            <p className="text-[11px] uppercase tracking-widest text-[#9a9a95] mt-4 mb-1.5">{CLASS_LABEL.fund}</p>
            {unitFunds.filter(f => f.fund_class === 'fund').map(fundRow)}

            <div className="flex justify-between px-3 py-2.5 mt-3 rounded-lg bg-[#111110] text-white text-[13px]">
              <span className="font-semibold">Остаток за месяц</span>
              <span className="font-mono font-semibold">{RUB(income - variable - fixedAndFunds)}</span>
            </div>

            {log.length > 0 && (
              <details className="mt-4 bg-white rounded-xl border border-[#e4e4e0] px-4 py-3">
                <summary className="text-[13px] text-[#6b6b66] cursor-pointer">Журнал правок · {log.length}</summary>
                <div className="mt-2 space-y-1">
                  {log.slice(0, 40).map(l => (
                    <div key={l.id} className="flex justify-between text-[12px] text-[#6b6b66]">
                      <span>
                        {l.at.slice(8, 10)}.{l.at.slice(5, 7)} {l.at.slice(11, 16)} · {l.actor ?? '—'} ·{' '}
                        {l.action === 'insert' ? 'добавил' : l.action === 'update' ? 'изменил' : 'удалил'} операцию от {l.entry_date.slice(8, 10)}.{l.entry_date.slice(5, 7)}
                      </span>
                      <span className="font-mono">{RUB(l.amount)}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}

        {tab === 'entry' && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-[#e4e4e0] p-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-[12px] text-[#9a9a95]">Дата</label>
                  <input type="date" value={fDate} onChange={e => setFDate(e.target.value)}
                    className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[14px] outline-none focus:border-[#111110]" />
                </div>
                <div>
                  <label className="text-[12px] text-[#9a9a95]">Тип</label>
                  <select value={fKind} onChange={e => { setFKind(e.target.value as 'in' | 'out'); setFFund(0); setFSub(0) }}
                    className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[14px] outline-none bg-white">
                    <option value="out">Расход</option>
                    <option value="in">Приход</option>
                  </select>
                </div>
                <div>
                  <label className="text-[12px] text-[#9a9a95]">Счёт / касса</label>
                  <select value={fAccount} onChange={e => setFAccount(e.target.value)}
                    className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[14px] outline-none bg-white">
                    <option value="">—</option>
                    {accounts.filter(a => a.unit === unit).map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3">
                <div>
                  <label className="text-[12px] text-[#9a9a95]">Контрагент</label>
                  <input value={fCp} onChange={e => setFCp(e.target.value)} onBlur={onCpBlur} placeholder="Вандер, аренда…"
                    className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[14px] outline-none focus:border-[#111110]" />
                </div>
                <div>
                  <label className="text-[12px] text-[#9a9a95]">Фонд</label>
                  <select value={fFund} onChange={e => { setFFund(Number(e.target.value)); setFSub(0) }}
                    className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[14px] outline-none bg-white">
                    <option value={0}>—</option>
                    {unitFunds.filter(f => (fKind === 'in' ? f.fund_class === 'income' : f.fund_class !== 'income')).map(f =>
                      <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[12px] text-[#9a9a95]">Подфонд</label>
                  <select value={fSub} onChange={e => setFSub(Number(e.target.value))}
                    className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[14px] outline-none bg-white">
                    <option value={0}>—</option>
                    {subfunds.filter(s => s.fund_id === fFund).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex items-end gap-3 mt-3">
                <div className="flex-1">
                  <label className="text-[12px] text-[#9a9a95]">Сумма, ₽</label>
                  <input value={fAmount} onChange={e => setFAmount(e.target.value)} inputMode="decimal" placeholder="53 245"
                    className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[16px] font-mono outline-none focus:border-[#111110]" />
                </div>
                <div className="flex-1">
                  <label className="text-[12px] text-[#9a9a95]">Комментарий</label>
                  <input value={fComment} onChange={e => setFComment(e.target.value)}
                    className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[14px] outline-none focus:border-[#111110]" />
                </div>
                <button onClick={saveEntry} disabled={saving}
                  className="px-5 py-2.5 rounded-lg bg-[#111110] text-white text-[14px] font-semibold disabled:opacity-50">
                  {saving ? '…' : 'Записать'}
                </button>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-[#e4e4e0] overflow-hidden">
              <p className="px-4 pt-3 pb-2 text-[13px] font-semibold text-[#111110]">Последние операции · {month && monthLabel(month)}</p>
              {unitEntries.length === 0 && <p className="px-4 pb-4 text-[13px] text-[#9a9a95]">Пока пусто</p>}
              {unitEntries.slice(0, 25).map(e => {
                const fund = funds.find(f => f.id === e.fund_id)
                const sub = subfunds.find(s => s.id === e.subfund_id)
                return (
                  <div key={e.id} className="flex items-center justify-between px-4 py-2 border-t border-[#f0f0ee] text-[13px]">
                    <div className="min-w-0">
                      <span className="text-[#9a9a95] mr-2">{e.entry_date.slice(8, 10)}.{e.entry_date.slice(5, 7)}</span>
                      <span className="text-[#111110]">{fund?.name}{sub ? ` → ${sub.name}` : ''}</span>
                      {e.counterparty && <span className="text-[#9a9a95]"> · {e.counterparty}</span>}
                    </div>
                    <span className="flex items-center gap-2 flex-shrink-0 ml-3">
                      {e.attachment_path ? (
                        <a href={`/api/accounting/entry-attachment?id=${e.id}`} target="_blank" rel="noreferrer"
                          className="text-[13px] text-blue-600" title="Открыть вложение">📎</a>
                      ) : (
                        <label className="text-[13px] text-[#c9c9c4] cursor-pointer" title="Приложить скан">
                          📎
                          <input type="file" className="hidden" onChange={ev => {
                            const f = ev.target.files?.[0]
                            if (f) attach(e.id, f)
                          }} />
                        </label>
                      )}
                      <span className={`font-mono ${e.kind === 'in' ? 'text-emerald-700' : 'text-[#111110]'}`}>
                        {e.kind === 'in' ? '+' : '−'}{RUB(Number(e.amount))}
                      </span>
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {tab === 'unposted' && !isBuyer && (
          <UnpostedTab unit={unit} funds={funds} subfunds={subfunds} month={month}
            onPosted={() => { load(); loadUnposted() }} />
        )}
        {tab === 'bank' && !isBuyer && (
          <BankTab unit={unit} funds={funds} subfunds={subfunds} onPosted={() => load()} />
        )}
        {tab === 'payroll' && !isBuyer && (
          <PayrollTab unit={unit} month={month} onChanged={() => load()} />
        )}
        {tab === 'taxes' && !isBuyer && (
          <TaxesTab unit={unit} subfunds={subfunds} today={fDate} onPaid={() => load()} />
        )}
        {tab === 'docs' && !isBuyer && <DocumentsTab />}
        {tab === 'finweek' && !isBuyer && <FinweekTab unit={unit} funds={funds} isFin={isFin} myName={myName} showBreakevenLink={['cfo', 'admin', 'ceo'].includes(myRole)} />}
        {tab === 'requests' && <RequestsTab unit={unit} funds={funds} subfunds={subfunds} isFin={isFin} myName={myName} />}
        {tab === 'committee' && !isBuyer && <CommitteeTab unit={unit} funds={funds} subfunds={subfunds} isFin={isFin} myName={myName} />}
        {tab === 'notes' && !isBuyer && <NotesTab unit={unit} />}
      </div>
    </div>
  )
}
