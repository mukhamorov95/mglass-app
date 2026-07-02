'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { B2BClient } from '@/lib/types'
import { usePaginatedQuery } from '@/lib/hooks/use-paginated-query'
import Pagination from '@/components/Pagination'

const EMPTY: Omit<B2BClient, 'id' | 'created_at'> = {
  name: '', contact: null, phone: null, discount_percent: 0, active: true, notes: null,
}

const MONTHS = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек']

type MonthStats = { [clientId: number]: { [month: number]: number } }

const PAGE_SIZE = 50

export default function B2BClientsPage() {
  const [tab, setTab] = useState<'clients' | 'stats'>('clients')
  const [form, setForm] = useState(EMPTY)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const formRef = useRef<HTMLDivElement>(null)

  const { data: clients, total: clientsTotal, page, goToPage, loading } = usePaginatedQuery<B2BClient>(
    async (from, to) => {
      const { data, count } = await createClient()
        .from('b2b_clients')
        .select('*', { count: 'exact' })
        .order('name')
        .range(from, to)
      return { data: data as B2BClient[] | null, count }
    },
    PAGE_SIZE,
    reloadKey,
  )

  const [statsYear, setStatsYear] = useState(new Date().getFullYear())
  const [stats, setStats] = useState<MonthStats>({})
  const [statsLoading, setStatsLoading] = useState(false)
  const [clientNames, setClientNames] = useState<Record<number, string>>({})

  useEffect(() => {
    const names: Record<number, string> = {}
    clients.forEach(c => { names[c.id] = c.name })
    setClientNames(prev => ({ ...prev, ...names }))
  }, [clients])

  useEffect(() => { if (tab === 'stats') loadStats() }, [tab, statsYear])

  async function loadStats() {
    setStatsLoading(true)
    const supabase = createClient()
    const from = `${statsYear}-01-01`
    const to   = `${statsYear}-12-31`
    const { data } = await supabase
      .from('b2b_orders')
      .select('client_id, client_name, total_after_discount, created_at')
      .gte('created_at', from)
      .lte('created_at', to + 'T23:59:59')
      .order('created_at')

    const result: MonthStats = {}
    const extraNames: Record<number, string> = { ...clientNames }
    ;(data ?? []).forEach((row: { client_id: number; client_name: string; total_after_discount: number; created_at: string }) => {
      const month = new Date(row.created_at).getMonth() // 0-11
      if (!result[row.client_id]) result[row.client_id] = {}
      result[row.client_id][month] = (result[row.client_id][month] ?? 0) + (row.total_after_discount ?? 0)
      extraNames[row.client_id] = row.client_name
    })
    setStats(result)
    setClientNames(prev => ({ ...prev, ...extraNames }))
    setStatsLoading(false)
  }

  async function handleSave() {
    if (!form.name.trim()) return
    setSaving(true)
    setError(null)
    const supabase = createClient()
    const payload = { ...form, discount_percent: Number(form.discount_percent) }
    if (editingId !== null) {
      const { error } = await supabase.from('b2b_clients').update(payload).eq('id', editingId)
      if (error) { setError(error.message); setSaving(false); return }
      setEditingId(null)
    } else {
      const { error } = await supabase.from('b2b_clients').insert(payload)
      if (error) { setError(error.message); setSaving(false); return }
    }
    setForm(EMPTY)
    setReloadKey(k => k + 1)
    setSaving(false)
  }

  async function toggleActive(id: number, active: boolean) {
    const supabase = createClient()
    await supabase.from('b2b_clients').update({ active: !active }).eq('id', id)
    setReloadKey(k => k + 1)
  }

  function startEdit(c: B2BClient) {
    setEditingId(c.id)
    setForm({ name: c.name, contact: c.contact, phone: c.phone, discount_percent: c.discount_percent, active: c.active, notes: c.notes })
    setError(null)
    setTab('clients')
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  const statsClientIds = Object.keys(stats).map(Number)
  const allStatClientIds = [...new Set([...clients.map(c => c.id), ...statsClientIds])]
    .filter(id => stats[id] && Object.values(stats[id]).some(v => v > 0))

  return (
    <div className="max-w-[1100px] mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[20px] font-semibold text-ink tracking-tight">B2B Клиенты</h1>
          <p className="text-[13px] text-muted mt-0.5">{clientsTotal} клиентов · {clients.filter(c => c.active).length} на странице активных</p>
        </div>
        <div className="flex bg-line-soft rounded-lg p-0.5">
          <button onClick={() => setTab('clients')}
            className={`px-4 py-1.5 rounded-md text-[13px] font-medium transition-all ${tab === 'clients' ? 'bg-surface text-ink shadow-sm' : 'text-ink-soft'}`}>
            Справочник
          </button>
          <button onClick={() => setTab('stats')}
            className={`px-4 py-1.5 rounded-md text-[13px] font-medium transition-all ${tab === 'stats' ? 'bg-surface text-ink shadow-sm' : 'text-ink-soft'}`}>
            Статистика
          </button>
        </div>
      </div>

      {/* ══ СПРАВОЧНИК ══ */}
      {tab === 'clients' && (
        <>
          <div ref={formRef} className={`rounded-xl border p-5 mb-8 transition-all ${editingId !== null ? 'bg-blue-50 border-blue-200' : 'bg-surface border-line'}`}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted">
                {editingId !== null ? `Редактировать — ID ${editingId}` : 'Добавить клиента'}
              </h2>
              {editingId !== null && (
                <span className="text-[11px] font-semibold text-blue-600 bg-blue-100 px-2 py-0.5 rounded-md">Режим редактирования</span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-[11px] font-semibold text-muted uppercase tracking-widest mb-1.5">Название / ИП / ООО</label>
                <input
                  className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-[14px] text-ink outline-none focus:border-ink transition-all"
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="ООО «Стекло плюс»"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-muted uppercase tracking-widest mb-1.5">Контактное лицо</label>
                <input
                  className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-[14px] text-ink outline-none focus:border-ink transition-all"
                  value={form.contact ?? ''}
                  onChange={e => setForm({ ...form, contact: e.target.value || null })}
                  placeholder="Иван Петров"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-muted uppercase tracking-widest mb-1.5">Телефон</label>
                <input
                  className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-[14px] text-ink outline-none focus:border-ink transition-all"
                  value={form.phone ?? ''}
                  onChange={e => setForm({ ...form, phone: e.target.value || null })}
                  placeholder="+7 900 000-00-00"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-muted uppercase tracking-widest mb-1.5">Скидка (%)</label>
                <input type="number" min="0" max="100" step="0.5"
                  className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-[14px] font-mono text-ink outline-none focus:border-ink transition-all"
                  value={form.discount_percent}
                  onChange={e => setForm({ ...form, discount_percent: Number(e.target.value) })}
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-muted uppercase tracking-widest mb-1.5">Примечание</label>
                <input
                  className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-[14px] text-ink outline-none focus:border-ink transition-all"
                  value={form.notes ?? ''}
                  onChange={e => setForm({ ...form, notes: e.target.value || null })}
                  placeholder="Необязательно"
                />
              </div>
            </div>

            {error && <p className="mt-3 text-[13px] text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

            <div className="flex gap-2 mt-4">
              <button onClick={handleSave} disabled={saving || !form.name.trim()}
                className="bg-ink text-white text-[13px] font-medium px-4 py-2 rounded-lg hover:bg-[#2a2a28] disabled:opacity-40 transition-colors">
                {saving ? 'Сохранение...' : editingId !== null ? 'Сохранить' : 'Добавить'}
              </button>
              {editingId !== null && (
                <button onClick={() => { setEditingId(null); setForm(EMPTY); setError(null) }}
                  className="bg-line-soft text-ink text-[13px] font-medium px-4 py-2 rounded-lg hover:bg-[#e8e8e4] transition-colors">
                  Отмена
                </button>
              )}
            </div>
          </div>

          <div className="bg-surface border border-line rounded-xl overflow-hidden">
            {loading ? (
              <div className="p-8 text-center text-[13px] text-muted">Загрузка...</div>
            ) : clients.length === 0 ? (
              <div className="p-8 text-center text-[13px] text-muted">Нет клиентов — добавьте первого</div>
            ) : (
              <>
              <div className="px-4 py-2 border-b border-line-soft">
                <Pagination page={page} total={clientsTotal} pageSize={PAGE_SIZE} onPageChange={goToPage} />
              </div>
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-line-soft">
                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-muted uppercase tracking-widest">Клиент</th>
                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-muted uppercase tracking-widest">Телефон</th>
                    <th className="text-center px-4 py-2.5 text-[11px] font-semibold text-muted uppercase tracking-widest w-24">Скидка</th>
                    <th className="w-36 px-4 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {clients.map(c => (
                    <tr key={c.id}
                      className={`border-b border-canvas last:border-0 transition-colors ${editingId === c.id ? 'bg-blue-50' : 'hover:bg-subtle'} ${!c.active ? 'opacity-35' : ''}`}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-ink">{c.name}</p>
                        {c.contact && <p className="text-[12px] text-muted mt-0.5">{c.contact}</p>}
                        {c.notes && <p className="text-[12px] text-faint mt-0.5">{c.notes}</p>}
                      </td>
                      <td className="px-4 py-3 text-ink-soft">{c.phone ?? '—'}</td>
                      <td className="px-4 py-3 text-center">
                        {c.discount_percent > 0
                          ? <span className="font-mono font-semibold text-emerald-600">{c.discount_percent}%</span>
                          : <span className="text-faint">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3 justify-end">
                          <button onClick={() => startEdit(c)} className="text-[12px] font-semibold text-blue-600 hover:text-blue-800 transition-colors">Изменить</button>
                          <button onClick={() => toggleActive(c.id, c.active)} className="text-[12px] text-muted hover:text-ink-soft transition-colors">
                            {c.active ? 'Скрыть' : 'Показать'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-4 py-3 border-t border-line-soft">
                <Pagination page={page} total={clientsTotal} pageSize={PAGE_SIZE} onPageChange={goToPage} />
              </div>
              </>
            )}
          </div>
        </>
      )}

      {/* ══ СТАТИСТИКА ══ */}
      {tab === 'stats' && (
        <div>
          <div className="flex items-center gap-3 mb-5">
            <label className="text-[13px] font-medium text-ink-soft">Год:</label>
            <select
              className="bg-surface border border-line rounded-lg px-3 py-1.5 text-[14px] text-ink outline-none focus:border-ink"
              value={statsYear}
              onChange={e => setStatsYear(Number(e.target.value))}>
              {Array.from({ length: 4 }, (_, i) => new Date().getFullYear() - i).map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>

          {statsLoading ? (
            <div className="p-8 text-center text-[13px] text-muted">Загрузка...</div>
          ) : allStatClientIds.length === 0 ? (
            <div className="p-12 text-center text-[13px] text-muted bg-surface border border-line rounded-xl">
              Нет заказов за {statsYear} год
            </div>
          ) : (
            <div className="bg-surface border border-line rounded-xl overflow-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-line-soft">
                    <th className="text-left px-4 py-3 text-[11px] font-semibold text-muted uppercase tracking-widest sticky left-0 bg-surface">Клиент</th>
                    {MONTHS.map((m, i) => (
                      <th key={i} className="text-right px-3 py-3 text-[11px] font-semibold text-muted uppercase tracking-widest whitespace-nowrap">{m}</th>
                    ))}
                    <th className="text-right px-4 py-3 text-[11px] font-semibold text-ink uppercase tracking-widest whitespace-nowrap">Год</th>
                  </tr>
                </thead>
                <tbody>
                  {allStatClientIds.map(clientId => {
                    const monthData = stats[clientId] ?? {}
                    const yearTotal = Object.values(monthData).reduce((s, v) => s + v, 0)
                    return (
                      <tr key={clientId} className="border-b border-canvas last:border-0 hover:bg-subtle">
                        <td className="px-4 py-3 font-medium text-ink sticky left-0 bg-surface whitespace-nowrap">
                          {clientNames[clientId] ?? `Клиент #${clientId}`}
                        </td>
                        {Array.from({ length: 12 }, (_, m) => (
                          <td key={m} className="px-3 py-3 text-right font-mono text-ink-soft whitespace-nowrap">
                            {monthData[m] ? monthData[m].toLocaleString('ru-RU') : '—'}
                          </td>
                        ))}
                        <td className="px-4 py-3 text-right font-mono font-semibold text-ink whitespace-nowrap">
                          {yearTotal.toLocaleString('ru-RU')} ₽
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-line bg-canvas">
                    <td className="px-4 py-3 text-[11px] font-semibold text-muted uppercase tracking-widest sticky left-0 bg-canvas">Итого</td>
                    {Array.from({ length: 12 }, (_, m) => {
                      const total = allStatClientIds.reduce((s, id) => s + (stats[id]?.[m] ?? 0), 0)
                      return (
                        <td key={m} className="px-3 py-3 text-right font-mono font-semibold text-ink whitespace-nowrap">
                          {total > 0 ? total.toLocaleString('ru-RU') : '—'}
                        </td>
                      )
                    })}
                    <td className="px-4 py-3 text-right font-mono font-semibold text-ink whitespace-nowrap">
                      {allStatClientIds
                        .reduce((s, id) => s + Object.values(stats[id] ?? {}).reduce((a, b) => a + b, 0), 0)
                        .toLocaleString('ru-RU')} ₽
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
