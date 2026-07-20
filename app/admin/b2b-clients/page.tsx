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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setClientNames(prev => ({ ...prev, ...names }))
  }, [clients])

  // eslint-disable-next-line react-hooks/immutability
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
          <h1 className="text-[20px] font-semibold text-[#111110] tracking-tight">B2B Клиенты</h1>
          <p className="text-[13px] text-[#8a8a85] mt-0.5">{clientsTotal} клиентов · {clients.filter(c => c.active).length} на странице активных</p>
        </div>
        <div className="flex bg-[#f0f0ec] rounded-lg p-0.5">
          <button onClick={() => setTab('clients')}
            className={`px-4 py-1.5 rounded-md text-[13px] font-medium transition-all ${tab === 'clients' ? 'bg-white text-[#111110] shadow-sm' : 'text-[#6b6b66]'}`}>
            Справочник
          </button>
          <button onClick={() => setTab('stats')}
            className={`px-4 py-1.5 rounded-md text-[13px] font-medium transition-all ${tab === 'stats' ? 'bg-white text-[#111110] shadow-sm' : 'text-[#6b6b66]'}`}>
            Статистика
          </button>
        </div>
      </div>

      {/* ══ СПРАВОЧНИК ══ */}
      {tab === 'clients' && (
        <>
          <div ref={formRef} className={`rounded-xl border p-5 mb-8 transition-all ${editingId !== null ? 'bg-blue-50 border-blue-200' : 'bg-white border-[#e4e4e0]'}`}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[11px] font-semibold uppercase tracking-widest text-[#8a8a85]">
                {editingId !== null ? `Редактировать — ID ${editingId}` : 'Добавить клиента'}
              </h2>
              {editingId !== null && (
                <span className="text-[11px] font-semibold text-blue-600 bg-blue-100 px-2 py-0.5 rounded-md">Режим редактирования</span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-1.5">Название / ИП / ООО</label>
                <input
                  className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[14px] text-[#111110] outline-none focus:border-[#111110] transition-all"
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="ООО «Стекло плюс»"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-1.5">Контактное лицо</label>
                <input
                  className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[14px] text-[#111110] outline-none focus:border-[#111110] transition-all"
                  value={form.contact ?? ''}
                  onChange={e => setForm({ ...form, contact: e.target.value || null })}
                  placeholder="Иван Петров"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-1.5">Телефон</label>
                <input
                  className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[14px] text-[#111110] outline-none focus:border-[#111110] transition-all"
                  value={form.phone ?? ''}
                  onChange={e => setForm({ ...form, phone: e.target.value || null })}
                  placeholder="+7 900 000-00-00"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-1.5">Скидка (%)</label>
                <input type="number" min="0" max="100" step="0.5"
                  className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[14px] font-mono text-[#111110] outline-none focus:border-[#111110] transition-all"
                  value={form.discount_percent}
                  onChange={e => setForm({ ...form, discount_percent: Number(e.target.value) })}
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-1.5">Примечание</label>
                <input
                  className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[14px] text-[#111110] outline-none focus:border-[#111110] transition-all"
                  value={form.notes ?? ''}
                  onChange={e => setForm({ ...form, notes: e.target.value || null })}
                  placeholder="Необязательно"
                />
              </div>
            </div>

            {error && <p className="mt-3 text-[13px] text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

            <div className="flex gap-2 mt-4">
              <button onClick={handleSave} disabled={saving || !form.name.trim()}
                className="bg-[#111110] text-white text-[13px] font-medium px-4 py-2 rounded-lg hover:bg-[#2a2a28] disabled:opacity-40 transition-colors">
                {saving ? 'Сохранение...' : editingId !== null ? 'Сохранить' : 'Добавить'}
              </button>
              {editingId !== null && (
                <button onClick={() => { setEditingId(null); setForm(EMPTY); setError(null) }}
                  className="bg-[#f0f0ec] text-[#111110] text-[13px] font-medium px-4 py-2 rounded-lg hover:bg-[#e8e8e4] transition-colors">
                  Отмена
                </button>
              )}
            </div>
          </div>

          <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
            {loading ? (
              <div className="p-8 text-center text-[13px] text-[#8a8a85]">Загрузка...</div>
            ) : clients.length === 0 ? (
              <div className="p-8 text-center text-[13px] text-[#8a8a85]">Нет клиентов — добавьте первого</div>
            ) : (
              <>
              <div className="px-4 py-2 border-b border-[#f0f0ec]">
                <Pagination page={page} total={clientsTotal} pageSize={PAGE_SIZE} onPageChange={goToPage} />
              </div>
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-[#f0f0ec]">
                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-[#9a9a95] uppercase tracking-widest">Клиент</th>
                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-[#9a9a95] uppercase tracking-widest">Телефон</th>
                    <th className="text-center px-4 py-2.5 text-[11px] font-semibold text-[#9a9a95] uppercase tracking-widest w-24">Скидка</th>
                    <th className="w-36 px-4 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {clients.map(c => (
                    <tr key={c.id}
                      className={`border-b border-[#f8f8f7] last:border-0 transition-colors ${editingId === c.id ? 'bg-blue-50' : 'hover:bg-[#fafaf9]'} ${!c.active ? 'opacity-35' : ''}`}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-[#111110]">{c.name}</p>
                        {c.contact && <p className="text-[12px] text-[#9a9a95] mt-0.5">{c.contact}</p>}
                        {c.notes && <p className="text-[12px] text-[#c4c4be] mt-0.5">{c.notes}</p>}
                      </td>
                      <td className="px-4 py-3 text-[#6b6b66]">{c.phone ?? '—'}</td>
                      <td className="px-4 py-3 text-center">
                        {c.discount_percent > 0
                          ? <span className="font-mono font-semibold text-emerald-600">{c.discount_percent}%</span>
                          : <span className="text-[#c4c4be]">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3 justify-end">
                          <button onClick={() => startEdit(c)} className="text-[12px] font-semibold text-blue-600 hover:text-blue-800 transition-colors">Изменить</button>
                          <button onClick={() => toggleActive(c.id, c.active)} className="text-[12px] text-[#9a9a95] hover:text-[#6b6b66] transition-colors">
                            {c.active ? 'Скрыть' : 'Показать'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-4 py-3 border-t border-[#f0f0ec]">
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
            <label className="text-[13px] font-medium text-[#6b6b66]">Год:</label>
            <select
              className="bg-white border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[14px] text-[#111110] outline-none focus:border-[#111110]"
              value={statsYear}
              onChange={e => setStatsYear(Number(e.target.value))}>
              {Array.from({ length: 4 }, (_, i) => new Date().getFullYear() - i).map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>

          {statsLoading ? (
            <div className="p-8 text-center text-[13px] text-[#8a8a85]">Загрузка...</div>
          ) : allStatClientIds.length === 0 ? (
            <div className="p-12 text-center text-[13px] text-[#8a8a85] bg-white border border-[#e4e4e0] rounded-xl">
              Нет заказов за {statsYear} год
            </div>
          ) : (
            <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-[#f0f0ec]">
                    <th className="text-left px-4 py-3 text-[11px] font-semibold text-[#9a9a95] uppercase tracking-widest sticky left-0 bg-white">Клиент</th>
                    {MONTHS.map((m, i) => (
                      <th key={i} className="text-right px-3 py-3 text-[11px] font-semibold text-[#9a9a95] uppercase tracking-widest whitespace-nowrap">{m}</th>
                    ))}
                    <th className="text-right px-4 py-3 text-[11px] font-semibold text-[#111110] uppercase tracking-widest whitespace-nowrap">Год</th>
                  </tr>
                </thead>
                <tbody>
                  {allStatClientIds.map(clientId => {
                    const monthData = stats[clientId] ?? {}
                    const yearTotal = Object.values(monthData).reduce((s, v) => s + v, 0)
                    return (
                      <tr key={clientId} className="border-b border-[#f8f8f7] last:border-0 hover:bg-[#fafaf9]">
                        <td className="px-4 py-3 font-medium text-[#111110] sticky left-0 bg-white whitespace-nowrap">
                          {clientNames[clientId] ?? `Клиент #${clientId}`}
                        </td>
                        {Array.from({ length: 12 }, (_, m) => (
                          <td key={m} className="px-3 py-3 text-right font-mono text-[#6b6b66] whitespace-nowrap">
                            {monthData[m] ? monthData[m].toLocaleString('ru-RU') : '—'}
                          </td>
                        ))}
                        <td className="px-4 py-3 text-right font-mono font-bold text-[#111110] whitespace-nowrap">
                          {yearTotal.toLocaleString('ru-RU')} ₽
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-[#e4e4e0] bg-[#f8f8f7]">
                    <td className="px-4 py-3 text-[11px] font-semibold text-[#9a9a95] uppercase tracking-widest sticky left-0 bg-[#f8f8f7]">Итого</td>
                    {Array.from({ length: 12 }, (_, m) => {
                      const total = allStatClientIds.reduce((s, id) => s + (stats[id]?.[m] ?? 0), 0)
                      return (
                        <td key={m} className="px-3 py-3 text-right font-mono font-semibold text-[#111110] whitespace-nowrap">
                          {total > 0 ? total.toLocaleString('ru-RU') : '—'}
                        </td>
                      )
                    })}
                    <td className="px-4 py-3 text-right font-mono font-bold text-[#111110] whitespace-nowrap">
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
