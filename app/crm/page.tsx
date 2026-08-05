'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import { CRM_ZONES, CRM_STAGES } from '@/lib/crmStages'

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
  heat: 'cold' | 'warm' | 'hot' | null
  readiness: number | null
  manager: string | null
  note: string | null
  status: 'active' | 'won' | 'lost'
  lost_reason: string | null
  avito_chat_id: string | null
  created_at: string
  updated_at: string
}

type ActEvent = { id: number; lead_id: number; kind: string; text: string; author: string | null; created_at: string; crm_leads?: { name: string | null; phone: string | null; manager: string | null; stage: string; source: string } | null }
type Task = { id: number; lead_id: number; title: string; kind: string; due_at: string; done: boolean; assignee: string | null; crm_leads?: { name: string | null; phone: string | null; stage: string; status: string } | null }

// Полная воронка CRM (3 зоны, канон SYSTEM.md) — из lib/crmStages.
// Лиды с этапами вне списка (напр. из amo) показываются в блоке «Прочие этапы».
const ZONES = CRM_ZONES
const ALL_STAGES = CRM_STAGES

const SOURCE_LABEL: Record<Lead['source'], string> = {
  avito: 'Авито', call: 'Звонок', whatsapp: 'WhatsApp', site: 'Сайт', referral: 'Рекомендация', manual: 'Вручную',
}

const RUB = (n: number) => Math.round(n).toLocaleString('ru-RU')
const fmtDT = (s: string) => new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const fmtTime = (s: string) => new Date(s).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
const ACT_KIND_META: Record<string, { icon: string; label: string }> = {
  call: { icon: '📞', label: 'Звонки' }, message: { icon: '💬', label: 'Сообщения' },
  stage: { icon: '➡️', label: 'Этапы' }, note: { icon: '📝', label: 'Заметки' }, system: { icon: '⚙️', label: 'Система' },
}
const TASK_ICON: Record<string, string> = { call: '📞', meeting: '🤝', measure: '📐', followup: '🔔', other: '•' }
// «Светофор» готовности заявки (см. lib/avito/scoreLead). Горячие — наверх колонки.
const HEAT_META: Record<'hot' | 'warm' | 'cold', { dot: string; label: string; rank: number }> = {
  hot: { dot: '🟢', label: 'Готов менеджеру', rank: 2 },
  warm: { dot: '🟡', label: 'В работе бота', rank: 1 },
  cold: { dot: '🔵', label: 'Холодный', rank: 0 },
}
const heatRank = (h: Lead['heat']) => HEAT_META[(h ?? 'cold') as 'hot' | 'warm' | 'cold']?.rank ?? 0

const EMPTY = {
  source: 'manual' as Lead['source'], name: '', phone: '', city: '', product: '', sizes: '',
  budget: '', est_amount: '', est_profit: '', manager: '', note: '',
}

function agoRu(ms: number) {
  const m = Math.max(0, Math.round(ms / 60000))
  if (m < 60) return `${m} мин назад`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} ч назад`
  return `${Math.round(h / 24)} дн назад`
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
  const [heatFilter, setHeatFilter] = useState<'all' | 'hot' | 'warm' | 'cold'>('all')
  const [periodFilter, setPeriodFilter] = useState<'month' | 'prev' | 'all'>('month')
  const [mgrFilter, setMgrFilter] = useState('all')
  const [showClosed, setShowClosed] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [scoped, setScoped] = useState(false)   // менеджер видит только свои лиды
  const [isOwner, setIsOwner] = useState(false)
  const [ingestMode, setIngestMode] = useState<'avito_only' | 'all'>('avito_only')
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')
  const [activity, setActivity] = useState<ActEvent[]>([])
  const [actFilter, setActFilter] = useState('all')
  const [actOpen, setActOpen] = useState(true)
  const [tasks, setTasks] = useState<Task[]>([])
  const [botStatus, setBotStatus] = useState<{ botEnabled: boolean; lastAvitoAt: string | null; avito24h: number } | null>(null)
  const [now, setNow] = useState(0)   // «сейчас» из эффекта (правило чистоты рендера)
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
        setIsOwner(['admin', 'ceo'].includes(prof?.role ?? ''))
      }
      setScoped(!canAll)
      let query = sb.from('crm_leads').select('*').order('updated_at', { ascending: false }).limit(500)
      if (!canAll) query = query.eq('manager', myName)
      const { data } = await query
      setLeads((data ?? []) as Lead[])
      fetch('/api/crm/ingest').then(r => r.ok ? r.json() : null).then(d => { if (d?.mode) setIngestMode(d.mode) }).catch(() => {})
      fetch('/api/crm/activity?days=1').then(r => r.ok ? r.json() : null).then(d => { if (d) setActivity((d.events ?? []) as ActEvent[]) }).catch(() => {})
      fetch('/api/crm/tasks').then(r => r.ok ? r.json() : null).then(d => { if (d) setTasks((d.tasks ?? []) as Task[]) }).catch(() => {})
      fetch('/api/crm/bot-status').then(r => r.ok ? r.json() : null).then(d => { if (d) setBotStatus(d) }).catch(() => {})
    } finally { setLoading(false) }
  }, [sb])

  async function setIngest(mode: 'avito_only' | 'all') {
    const r = await fetch('/api/crm/ingest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }) })
    if (r.ok) { setIngestMode(mode); flash(mode === 'all' ? 'Приём: все каналы (AmoCRM)' : 'Приём: только Авито') }
    else flash('Не удалось изменить режим')
  }

  async function syncAmo() {
    setSyncing(true); setSyncMsg('')
    try {
      const r = await fetch('/api/crm/sync-amo', { method: 'POST' })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Ошибка')
      setSyncMsg(`Синхронизировано: ${d.total} (новых ${d.new}, обновлено ${d.updated})`)
      load()
    } catch (e) { setSyncMsg('Ошибка: ' + (e as Error).message) }
    finally { setSyncing(false) }
  }
  useEffect(() => { void load() }, [load])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setNow(Date.now()); const t = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(t) }, [])

  async function addEvent(leadId: number, kind: string, text: string) {
    await sb.from('crm_lead_events').insert({ lead_id: leadId, kind, text, author: me || null })
  }

  async function completeTask(tid: number) {
    const r = await fetch('/api/crm/tasks', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: tid, done: true }) })
    if (r.ok) setTasks(ts => ts.filter(t => t.id !== tid))
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
  // Границы периода берём из `now` (проставляется в эффекте) — не дёргаем Date в
  // рендере. По умолчанию показываем только текущий месяц: доска не забита старьём.
  const nowD = now ? new Date(now) : null
  const monthStart = nowD ? new Date(nowD.getFullYear(), nowD.getMonth(), 1).getTime() : 0
  const prevMonthStart = nowD ? new Date(nowD.getFullYear(), nowD.getMonth() - 1, 1).getTime() : 0
  const inPeriod = (l: Lead) => {
    if (periodFilter === 'all' || !now) return true
    const t = new Date(l.created_at).getTime()
    if (periodFilter === 'month') return t >= monthStart
    return t >= prevMonthStart && t < monthStart   // 'prev'
  }
  // База периода + менеджера — от неё считаем счётчики, чтобы цифры совпадали с доской.
  const periodLeads = leads.filter(l => inPeriod(l) && (mgrFilter === 'all' || (l.manager ?? '') === mgrFilter))
  const managers = [...new Set(leads.map(l => l.manager).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'ru'))
  const visible = periodLeads.filter(l =>
    (showClosed ? true : l.status === 'active') &&
    (srcFilter === 'all' || l.source === srcFilter) &&
    (heatFilter === 'all' || (l.heat ?? 'cold') === heatFilter) &&
    (!q || (l.name ?? '').toLowerCase().includes(q) || (l.phone ?? '').includes(q) || (l.product ?? '').toLowerCase().includes(q))
  )
  const byStage = new Map<string, Lead[]>()
  for (const l of visible) byStage.set(l.stage, [...(byStage.get(l.stage) ?? []), l])
  // Внутри колонки — горячие наверх (🟢 → 🟡 → 🔵), затем по свежести.
  for (const [st, list] of byStage) byStage.set(st, list.sort((a, b) =>
    heatRank(b.heat) - heatRank(a.heat) || new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()))

  const keyLeads = visible.filter(l => l.qualified && l.status === 'active')
  const hotLeads = periodLeads.filter(l => l.heat === 'hot' && l.status === 'active')

  // Задачи (amoCRM): открытые, отсортированы по сроку; «на сегодня и просроченные»
  // — верхняя панель; просроченные подсвечивают карточку.
  const todayEndTs = new Date(now).setHours(23, 59, 59, 999)
  const openTasks = [...tasks].filter(t => !t.done).sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime())
  const dueTasks = openTasks.filter(t => new Date(t.due_at).getTime() <= todayEndTs)
  const overdueLeadIds = new Set(openTasks.filter(t => new Date(t.due_at).getTime() < now).map(t => t.lead_id))
  const actFiltered = activity.filter(a => actFilter === 'all' || a.kind === actFilter)

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
              Активных: {periodLeads.filter(l => l.status === 'active').length} · ⭐ ключевой этап: {keyLeads.length}
              {' · '}<button onClick={() => setHeatFilter(h => h === 'hot' ? 'all' : 'hot')}
                className={`font-semibold ${heatFilter === 'hot' ? 'text-emerald-700 underline' : 'text-emerald-600'}`}>🟢 готовы менеджеру: {hotLeads.length}</button>
            </p>
            {botStatus && (
              <a href="/vladislav" title="Настройки AI-бота"
                className={`inline-flex items-center gap-1.5 mt-1.5 text-[12px] rounded-full border px-2.5 py-0.5 no-underline ${
                  botStatus.botEnabled ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'
                }`}>
                🤖 Иван · {botStatus.botEnabled ? 'работает' : 'выключен'}
                <span className="opacity-70">
                  · Авито 24ч: {botStatus.avito24h}
                  {botStatus.lastAvitoAt && now > 0 ? `, посл. ${agoRu(now - new Date(botStatus.lastAvitoAt).getTime())}` : ''}
                </span>
              </a>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск: имя / телефон"
              className="border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] bg-white w-48 outline-none focus:border-[#111110]" />
            <select value={srcFilter} onChange={e => setSrcFilter(e.target.value as typeof srcFilter)}
              className="border border-[#e4e4e0] rounded-lg px-2.5 py-2 text-[13px] bg-white">
              <option value="all">Все источники</option>
              {(Object.keys(SOURCE_LABEL) as Lead['source'][]).map(s => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
            </select>
            <select value={heatFilter} onChange={e => setHeatFilter(e.target.value as typeof heatFilter)}
              className="border border-[#e4e4e0] rounded-lg px-2.5 py-2 text-[13px] bg-white">
              <option value="all">Вся готовность</option>
              <option value="hot">🟢 Готов менеджеру</option>
              <option value="warm">🟡 В работе бота</option>
              <option value="cold">🔵 Холодный</option>
            </select>
            <select value={periodFilter} onChange={e => setPeriodFilter(e.target.value as typeof periodFilter)}
              className="border border-[#e4e4e0] rounded-lg px-2.5 py-2 text-[13px] bg-white">
              <option value="month">Текущий месяц</option>
              <option value="prev">Прошлый месяц</option>
              <option value="all">Всё время</option>
            </select>
            {!scoped && managers.length > 0 && (
              <select value={mgrFilter} onChange={e => setMgrFilter(e.target.value)}
                className="border border-[#e4e4e0] rounded-lg px-2.5 py-2 text-[13px] bg-white">
                <option value="all">Все менеджеры</option>
                {managers.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            )}
            <label className="flex items-center gap-1.5 text-[12px] text-[#6b6b66]">
              <input type="checkbox" checked={showClosed} onChange={e => setShowClosed(e.target.checked)} className="accent-[#111110]" />
              закрытые
            </label>
            <Link href="/crm/import" className="px-4 py-2.5 rounded-xl border border-[#e4e4e0] bg-white text-[#111110] text-[13px] font-semibold hover:bg-[#f5f5f3]">⬇ Импорт с Авито</Link>
            <button onClick={() => setFormOpen(true)} className="px-4 py-2.5 rounded-xl bg-[#111110] text-white text-[13px] font-semibold hover:opacity-90">＋ Лид</button>
          </div>
        </div>
      </div>

      {/* Приём лидов (только владельцу): режим + синхронизация с AmoCRM */}
      {isOwner && (
        <div className="mx-5 mt-4 bg-white border border-[#e4e4e0] rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap">
          <span className="text-[12px] font-semibold text-[#111110]">Приём лидов:</span>
          <div className="inline-flex bg-[#f0f0ec] rounded-lg p-0.5">
            <button onClick={() => setIngest('avito_only')}
              className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-all ${ingestMode === 'avito_only' ? 'bg-white text-[#111110] shadow-sm' : 'text-[#6b6b66]'}`}>Только Авито</button>
            <button onClick={() => setIngest('all')}
              className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-all ${ingestMode === 'all' ? 'bg-white text-[#111110] shadow-sm' : 'text-[#6b6b66]'}`}>Все каналы (AmoCRM)</button>
          </div>
          <button onClick={syncAmo} disabled={syncing}
            className="px-3 py-1.5 rounded-lg border border-[#e4e4e0] text-[12px] font-medium text-[#111110] hover:bg-[#f5f5f3] disabled:opacity-50">
            {syncing ? 'Синхронизирую…' : '↻ Синхронизировать с AmoCRM'}
          </button>
          {syncMsg && <span className="text-[12px] text-[#6b6b66]">{syncMsg}</span>}
          <span className="text-[11px] text-[#c4c4be] ml-auto">AmoCRM — только чтение. Заливает активные сделки воронки «Продажи».</span>
        </div>
      )}

      {/* Задачи на сегодня и просроченные (amoCRM-стиль) */}
      {dueTasks.length > 0 && (
        <div className="mx-5 mt-4 bg-white border border-[#e4e4e0] rounded-xl px-4 py-3">
          <p className="text-[12px] font-semibold text-[#111110] mb-2">🗓 Задачи на сегодня и просроченные · {dueTasks.length}</p>
          <div className="space-y-1.5 max-h-56 overflow-y-auto">
            {dueTasks.map(t => {
              const overdue = new Date(t.due_at).getTime() < now
              return (
                <div key={t.id} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] ${overdue ? 'bg-red-50' : 'bg-[#f6f8ff]'}`}>
                  <button onClick={() => completeTask(t.id)} title="Выполнено" className="w-5 h-5 rounded-full border border-[#c4c4be] hover:bg-emerald-500 hover:border-emerald-500 shrink-0" />
                  <button onClick={() => router.push(`/crm/${t.lead_id}`)} className="flex-1 min-w-0 text-left">
                    <p className="text-[#111110] truncate">{TASK_ICON[t.kind] ?? '•'} {t.title} <span className="text-[#9a9a95]">— {t.crm_leads?.name || t.crm_leads?.phone || `Лид #${t.lead_id}`}</span></p>
                    <p className={`text-[10px] ${overdue ? 'text-red-600 font-semibold' : 'text-[#9a9a95]'}`}>{overdue ? 'просрочено · ' : 'сегодня · '}{fmtDT(t.due_at)}{t.assignee ? ` · ${t.assignee}` : ''}</p>
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Лента активности (владельцу/РОП — по всем; менеджеру — по своим лидам) */}
      {!scoped && (
        <div className="mx-5 mt-4 bg-white border border-[#e4e4e0] rounded-xl px-4 py-3">
          <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
            <button onClick={() => setActOpen(o => !o)} className="text-[12px] font-semibold text-[#111110]">{actOpen ? '▾' : '▸'} 🕒 Активность сегодня · {activity.length}</button>
            {actOpen && (
              <div className="flex gap-1 flex-wrap">
                {(['all', 'call', 'message', 'stage', 'note', 'system'] as const).map(k => (
                  <button key={k} onClick={() => setActFilter(k)}
                    className={`px-2 py-1 rounded-md text-[11px] ${actFilter === k ? 'bg-[#111110] text-white' : 'bg-[#f0f0ec] text-[#6b6b66]'}`}>
                    {k === 'all' ? 'Все' : ACT_KIND_META[k]?.icon ?? k}
                  </button>
                ))}
              </div>
            )}
          </div>
          {actOpen && (
            <div className="space-y-0.5 max-h-72 overflow-y-auto">
              {actFiltered.length === 0 && <p className="text-[12px] text-[#c4c4be]">Сегодня событий нет.</p>}
              {actFiltered.map(ev => {
                const meta = ACT_KIND_META[ev.kind] ?? { icon: '•', label: ev.kind }
                const who = ev.crm_leads?.name || ev.crm_leads?.phone || `Лид #${ev.lead_id}`
                return (
                  <button key={ev.id} onClick={() => router.push(`/crm/${ev.lead_id}`)} className="w-full text-left flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-[#f8f8f7]">
                    <span className="text-[13px] shrink-0">{meta.icon}</span>
                    <span className="flex-1 min-w-0">
                      <span className="text-[12px] text-[#111110]"><b>{who}</b> <span className="text-[#6b6b66]">{ev.text.length > 90 ? ev.text.slice(0, 90) + '…' : ev.text}</span></span>
                      <span className="block text-[10px] text-[#9a9a95]">{fmtTime(ev.created_at)}{ev.author ? ` · ${ev.author}` : ''}{ev.crm_leads?.manager ? ` · ${ev.crm_leads.manager}` : ''}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

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
                            className={`w-full text-left rounded-lg border p-2.5 hover:border-[#111110] transition-colors ${l.heat === 'hot' ? 'border-emerald-400 bg-emerald-50/50' : l.qualified ? 'border-amber-300 bg-amber-50/50' : 'border-[#eceff1]'}`}>
                            <p className="text-[12px] font-bold text-[#111110] truncate">
                              {l.heat && l.heat !== 'cold' && <span title={HEAT_META[l.heat].label}>{HEAT_META[l.heat].dot} </span>}
                              {l.qualified && '⭐ '}{l.name || l.phone || `Лид #${l.id}`}
                              {l.status === 'won' && ' ✅'}{l.status === 'lost' && ' ✖'}
                              {overdueLeadIds.has(l.id) && <span title="Просроченная задача"> 🔴</span>}
                            </p>
                            <p className="text-[11px] text-[#6b6b66] truncate">{[l.product, l.sizes].filter(Boolean).join(' · ')}</p>
                            <p className="text-[10px] text-[#9a9a95] mt-0.5">
                              {SOURCE_LABEL[l.source]}{l.manager ? ` · ${l.manager}` : ''}{l.est_amount != null ? ` · ${RUB(Number(l.est_amount))} ₽` : ''}
                              {l.source === 'avito' && l.readiness != null && l.readiness > 0 ? ` · ${l.readiness}%` : ''}
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
