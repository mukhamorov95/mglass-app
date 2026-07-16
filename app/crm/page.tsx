'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'

// Собственная CRM (контур MGlass), фаза 1: воронка «Продажи» с каноническими
// этапами из SYSTEM.md (те же, что в AmoCRM — менеджерам ничего не переучивать).
// Лиды заводятся вручную и из Авито-бота (фаза 2); AmoCRM остаётся read-only
// архивом. «Ключевой этап» = квалифицирован: наш клиент, с ним работаем.

type Lead = {
  id: number
  source: 'avito' | 'call' | 'whatsapp' | 'site' | 'referral' | 'manual'
  name: string | null
  phone: string | null
  city: string | null
  product: string | null
  sizes: string | null
  budget: string | null
  est_amount: number | null
  est_profit: number | null
  stage: string
  qualified: boolean
  score: number | null
  score_reason: string | null
  manager: string | null
  note: string | null
  status: 'active' | 'won' | 'lost'
  lost_reason: string | null
  avito_chat_id: string | null
  created_at: string
  updated_at: string
}

// Воронка CRM = только ПРОДАЖА (решение владельца 15.07): квалификация и
// производство убраны — производство живёт в своих экранах. «Получена новая
// заявка» оставлена входом: сюда падают лиды Авито-бота и ручные.
// Имена этапов — канон SYSTEM.md; лиды с другими этапами (например, после
// переноса из amo) показываются в блоке «Прочие этапы».
const ZONES: { zone: string; tone: string; stages: string[] }[] = [
  { zone: 'Продажа', tone: 'text-amber-700', stages: [
    'Получена новая заявка',
    'Замер назначен', 'Замер проведён', 'Согласование после замера', 'Чертежи в работу',
    'Согласование после отправки чертежей', 'КП отправлено', 'Счёт выставлен — ждём оплату',
  ]},
]
const ALL_STAGES = ZONES.flatMap(z => z.stages)

const SOURCE_LABEL: Record<Lead['source'], string> = {
  avito: 'Авито', call: 'Звонок', whatsapp: 'WhatsApp', site: 'Сайт', referral: 'Рекомендация', manual: 'Вручную',
}

const RUB = (n: number) => Math.round(n).toLocaleString('ru-RU')

const EMPTY = {
  source: 'manual' as Lead['source'], name: '', phone: '', city: '', product: '', sizes: '',
  budget: '', est_amount: '', est_profit: '', manager: '', note: '',
}

export default function CrmPage() {
  const sb = createClient()
  const router = useRouter()
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [me, setMe] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState({ ...EMPTY })
  const [search, setSearch] = useState('')
  const [srcFilter, setSrcFilter] = useState<'all' | Lead['source']>('all')
  const [showClosed, setShowClosed] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [scoped, setScoped] = useState(false)   // менеджер видит только свои лиды
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 1800) }

  const load = useCallback(async () => {
    try {
      const { data: { user } } = await sb.auth.getUser()
      let myName = ''
      let canAll = false
      if (user) {
        const { data: p } = await sb.from('users').select('name,role,can_view_all_deals').eq('id', user.id).maybeSingle()
        const prof = p as { name: string | null; role: string | null; can_view_all_deals: boolean | null } | null
        myName = prof?.name ?? user.email ?? ''
        setMe(myName)
        // Владелец/CEO/РОП и менеджер с флагом «видит все» — вся воронка; остальные — только свои назначенные.
        canAll = ['admin', 'ceo', 'commercial'].includes(prof?.role ?? '') || !!prof?.can_view_all_deals
      }
      setScoped(!canAll)
      let query = sb.from('crm_leads').select('*').order('updated_at', { ascending: false }).limit(500)
      if (!canAll) query = query.eq('manager', myName)
      const { data } = await query
      setLeads((data ?? []) as Lead[])
    } finally { setLoading(false) }
  }, [sb])
  useEffect(() => { void load() }, [load])

  async function addEvent(leadId: number, kind: string, text: string) {
    await sb.from('crm_lead_events').insert({ lead_id: leadId, kind, text, author: me || null })
  }

  async function createLead() {
    if (!form.phone.trim() && !form.name.trim()) { flash('Имя или телефон обязательны'); return }
    const { data, error } = await sb.from('crm_leads').insert({
      source: form.source,
      name: form.name.trim() || null, phone: form.phone.trim() || null, city: form.city.trim() || null,
      product: form.product.trim() || null, sizes: form.sizes.trim() || null, budget: form.budget.trim() || null,
      est_amount: form.est_amount !== '' ? Number(form.est_amount) : null,
      est_profit: form.est_profit !== '' ? Number(form.est_profit) : null,
      manager: form.manager.trim() || me || null, note: form.note.trim() || null,
    }).select('id').single()
    if (error) { flash('Ошибка: ' + error.message); return }
    await addEvent((data as { id: number }).id, 'system', `Лид создан (${SOURCE_LABEL[form.source]})`)
    setFormOpen(false); setForm({ ...EMPTY }); flash('Лид создан'); load()
  }

  const q = search.trim().toLowerCase()
  const visible = leads.filter(l =>
    (showClosed ? true : l.status === 'active') &&
    (srcFilter === 'all' || l.source === srcFilter) &&
    (!q || (l.name ?? '').toLowerCase().includes(q) || (l.phone ?? '').includes(q) || (l.product ?? '').toLowerCase().includes(q))
  )
  const byStage = new Map<string, Lead[]>()
  for (const l of visible) byStage.set(l.stage, [...(byStage.get(l.stage) ?? []), l])

  const keyLeads = visible.filter(l => l.qualified && l.status === 'active')

  if (loading) return <div className="min-h-screen bg-[#f5f5f3] flex items-center justify-center text-[13px] text-[#9a9a95]">Загрузка…</div>

  const inputCls = 'w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] bg-white outline-none focus:border-[#111110]'
  const lbl = 'text-[11px] font-medium text-[#6b6b66] mb-1 block'

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      {toast && <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 rounded-xl shadow-lg text-[13px] font-semibold bg-[#111110] text-white">{toast}</div>}

      <div className="bg-white border-b border-[#e4e4e0] px-5 pt-6 pb-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">📊 CRM · Продажи
              {scoped && <span className="ml-2 text-[11px] font-medium align-middle px-2 py-0.5 rounded-full bg-[#f0f0ec] text-[#6b6b66]">только мои</span>}
            </h1>
            <p className="text-[13px] text-[#9a9a95] mt-0.5">
              Активных: {leads.filter(l => l.status === 'active').length} · ⭐ ключевой этап: {keyLeads.length}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск: имя / телефон"
              className="border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] bg-white w-48 outline-none focus:border-[#111110]" />
            <select value={srcFilter} onChange={e => setSrcFilter(e.target.value as typeof srcFilter)}
              className="border border-[#e4e4e0] rounded-lg px-2.5 py-2 text-[13px] bg-white">
              <option value="all">Все источники</option>
              {(Object.keys(SOURCE_LABEL) as Lead['source'][]).map(s => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
            </select>
            <label className="flex items-center gap-1.5 text-[12px] text-[#6b6b66]">
              <input type="checkbox" checked={showClosed} onChange={e => setShowClosed(e.target.checked)} className="accent-[#111110]" />
              закрытые
            </label>
            <Link href="/crm/import" className="px-4 py-2.5 rounded-xl border border-[#e4e4e0] bg-white text-[#111110] text-[13px] font-semibold hover:bg-[#f5f5f3]">⬇ Импорт с Авито</Link>
            <button onClick={() => setFormOpen(true)} className="px-4 py-2.5 rounded-xl bg-[#111110] text-white text-[13px] font-semibold hover:opacity-90">＋ Лид</button>
          </div>
        </div>
      </div>

      {/* Форма нового лида */}
      {formOpen && (
        <div className="mx-5 mt-4 bg-white rounded-xl border border-[#111110] p-4 space-y-3 max-w-[900px]">
          <p className="text-[13px] font-bold text-[#111110]">Новый лид</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div>
              <span className={lbl}>Источник</span>
              <select className={inputCls} value={form.source} onChange={e => setForm({ ...form, source: e.target.value as Lead['source'] })}>
                {(Object.keys(SOURCE_LABEL) as Lead['source'][]).map(s => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
              </select>
            </div>
            <div><span className={lbl}>Имя</span><input className={inputCls} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div><span className={lbl}>Телефон</span><input className={inputCls} value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
            <div><span className={lbl}>Город</span><input className={inputCls} value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div><span className={lbl}>Продукт</span><input className={inputCls} value={form.product} onChange={e => setForm({ ...form, product: e.target.value })} placeholder="душевая / зеркало / лофт" /></div>
            <div><span className={lbl}>Размеры</span><input className={inputCls} value={form.sizes} onChange={e => setForm({ ...form, sizes: e.target.value })} /></div>
            <div><span className={lbl}>Предв. цена, ₽</span><input type="number" className={inputCls} value={form.est_amount} onChange={e => setForm({ ...form, est_amount: e.target.value })} /></div>
            <div><span className={lbl}>Менеджер</span><input className={inputCls} value={form.manager} onChange={e => setForm({ ...form, manager: e.target.value })} placeholder={me} /></div>
          </div>
          <div><span className={lbl}>Заметка</span><input className={inputCls} value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></div>
          <div className="flex gap-2">
            <button onClick={createLead} className="px-5 py-2.5 rounded-xl bg-[#111110] text-white text-[13px] font-semibold">Создать</button>
            <button onClick={() => setFormOpen(false)} className="px-4 py-2.5 rounded-xl border border-[#e4e4e0] text-[13px] text-[#6b6b66]">Отмена</button>
          </div>
        </div>
      )}

      {/* Воронка: зоны → этапы → карточки */}
      <div className="px-5 pt-4 space-y-5">
        {/* Этапы вне канона (например, «отложенный спрос» из AmoCRM после переноса) */}
        {(() => {
          const extra = [...byStage.keys()].filter(s => !ALL_STAGES.includes(s))
          if (!extra.length) return null
          return (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest mb-2 text-[#9a9a95]">Прочие этапы · {extra.reduce((n, s) => n + (byStage.get(s)?.length ?? 0), 0)}</p>
              <div className="flex gap-3 overflow-x-auto pb-2">
                {extra.map(st => {
                  const list = byStage.get(st) ?? []
                  return (
                    <div key={st} className="flex-shrink-0 w-60 rounded-xl border bg-white border-[#e4e4e0]">
                      <p className="px-3 py-2 text-[11px] font-semibold text-[#6b6b66] border-b border-[#f8f8f7]">{st} · {list.length}</p>
                      <div className="p-2 space-y-2">
                        {list.map(l => (
                          <button key={l.id} onClick={() => router.push(`/crm/${l.id}`)}
                            className="w-full text-left rounded-lg border border-[#eceff1] p-2.5 hover:border-[#111110]">
                            <p className="text-[12px] font-bold text-[#111110] truncate">{l.name || l.phone || `Лид #${l.id}`}</p>
                            <p className="text-[10px] text-[#9a9a95] mt-0.5">{l.manager ?? ''}{l.est_amount != null ? ` · ${RUB(Number(l.est_amount))} ₽` : ''}</p>
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })()}

        {ZONES.map(z => {
          const zoneLeads = z.stages.reduce((s, st) => s + (byStage.get(st)?.length ?? 0), 0)
          return (
            <div key={z.zone}>
              <p className={`text-[11px] font-bold uppercase tracking-widest mb-2 ${z.tone}`}>{z.zone} · {zoneLeads}</p>
              <div className="flex gap-3 overflow-x-auto pb-2">
                {z.stages.map(st => {
                  const list = byStage.get(st) ?? []
                  return (
                    <div key={st} className={`flex-shrink-0 w-60 rounded-xl border bg-white ${list.length ? 'border-[#e4e4e0]' : 'border-[#f0f0ec] opacity-60'}`}>
                      <p className="px-3 py-2 text-[11px] font-semibold text-[#6b6b66] border-b border-[#f8f8f7]">{st} · {list.length}</p>
                      <div className="p-2 space-y-2 min-h-[40px]">
                        {list.map(l => (
                          <button key={l.id} onClick={() => router.push(`/crm/${l.id}`)}
                            className={`w-full text-left rounded-lg border p-2.5 hover:border-[#111110] transition-colors ${l.qualified ? 'border-amber-300 bg-amber-50/50' : 'border-[#eceff1]'}`}>
                            <p className="text-[12px] font-bold text-[#111110] truncate">
                              {l.qualified && '⭐ '}{l.name || l.phone || `Лид #${l.id}`}
                              {l.status === 'won' && ' ✅'}{l.status === 'lost' && ' ✖'}
                            </p>
                            <p className="text-[11px] text-[#6b6b66] truncate">{[l.product, l.sizes].filter(Boolean).join(' · ')}</p>
                            <p className="text-[10px] text-[#9a9a95] mt-0.5">
                              {SOURCE_LABEL[l.source]}{l.manager ? ` · ${l.manager}` : ''}{l.est_amount != null ? ` · ${RUB(Number(l.est_amount))} ₽` : ''}
                            </p>
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

    </div>
  )
}
