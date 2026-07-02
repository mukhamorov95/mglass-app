'use client'

import { useEffect, useRef, useState } from 'react'

// ─── Types ─────────────────────────────────────────────────────────────────

type Lead = {
  id: number
  company_name: string
  segment: string
  contact_name: string | null
  phone: string | null
  email: string | null
  instagram: string | null
  website: string | null
  city: string
  status: string
  source: string
  score: string | null
  size_category: string | null
  notes: string | null
  ai_summary: string | null
  potential_monthly: number | null
  last_contact_date: string | null
  created_at: string
}

type Activity = {
  id: number
  lead_id: number
  type: string
  note: string
  outcome: string | null
  next_action: string | null
  next_action_date: string | null
  created_at: string
}

type OutreachTemplate = {
  id: number
  segment: string
  channel: string
  stage: string
  title: string
  body: string
  cta: string | null
  active: boolean
}

// ─── Constants ──────────────────────────────────────────────────────────────

const SEGMENTS = [
  { value: 'designer',     label: 'Дизайнеры',   icon: '🎨' },
  { value: 'glass_company',label: 'Стекольные',  icon: '🪟' },
  { value: 'furniture',    label: 'Мебельные',    icon: '🪑' },
  { value: 'construction', label: 'Строители',    icon: '🏗️' },
  { value: 'office',       label: 'Офисы',        icon: '🏢' },
  { value: 'renovation',   label: 'Ремонт',       icon: '🔨' },
  { value: 'aluminum',     label: 'Алюминий',     icon: '⚙️' },
  { value: 'studio',       label: 'Студии',       icon: '✏️' },
]

const STATUSES = [
  { value: 'new',               label: 'Новый',              color: 'bg-slate-100 text-slate-600' },
  { value: 'researched',        label: 'Исследован',         color: 'bg-blue-100 text-blue-700' },
  { value: 'contacted',         label: 'Написали',           color: 'bg-indigo-100 text-indigo-700' },
  { value: 'call_done',         label: 'Созвон',             color: 'bg-violet-100 text-violet-700' },
  { value: 'presentation_sent', label: 'Презентация отправлена', color: 'bg-purple-100 text-purple-700' },
  { value: 'proposal_sent',     label: 'КП отправлено',      color: 'bg-amber-100 text-amber-700' },
  { value: 'negotiating',       label: 'Переговоры',         color: 'bg-orange-100 text-orange-700' },
  { value: 'test_order',        label: 'Тестовый заказ',     color: 'bg-lime-100 text-lime-700' },
  { value: 'regular',           label: 'Постоянный',         color: 'bg-emerald-100 text-emerald-700' },
  { value: 'lost',              label: 'Потерян',            color: 'bg-red-100 text-red-700' },
]

const SCORES = [
  { value: 'A', label: 'A', color: 'bg-emerald-500 text-white', desc: 'Высокий потенциал' },
  { value: 'B', label: 'B', color: 'bg-amber-400 text-white',   desc: 'Средний потенциал' },
  { value: 'C', label: 'C', color: 'bg-slate-400 text-white',   desc: 'Низкий потенциал' },
]

const SOURCES = [
  { value: 'manual',    label: 'Вручную' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'referral',  label: 'Рекомендация' },
  { value: '2gis',      label: '2ГИС' },
  { value: 'avito',     label: 'Авито' },
  { value: 'website',   label: 'Сайт / SEO' },
  { value: 'cold_call', label: 'Холодный звонок' },
]

const SIZES = [
  { value: 'small',  label: 'Малый' },
  { value: 'medium', label: 'Средний' },
  { value: 'large',  label: 'Крупный' },
]

const ACTIVITY_TYPES = [
  { value: 'call',     label: 'Звонок',   icon: '📞' },
  { value: 'whatsapp', label: 'WhatsApp', icon: '💬' },
  { value: 'email',    label: 'Email',    icon: '📧' },
  { value: 'meeting',  label: 'Встреча',  icon: '🤝' },
  { value: 'proposal', label: 'КП',       icon: '📄' },
  { value: 'note',     label: 'Заметка',  icon: '📝' },
]

const OUTCOMES = [
  { value: 'interested',     label: 'Заинтересован' },
  { value: 'not_interested', label: 'Не заинтересован' },
  { value: 'callback',       label: 'Перезвонить' },
  { value: 'sent_info',      label: 'Отправил инфо' },
  { value: 'no_answer',      label: 'Не ответил' },
]

const STAGES = [
  { value: 'cold',         label: 'Холодный' },
  { value: 'follow1',      label: 'Follow-up 1' },
  { value: 'follow2',      label: 'Follow-up 2' },
  { value: 'reactivation', label: 'Реактивация' },
]

const statusInfo  = (v: string) => STATUSES.find(s => s.value === v) ?? { label: v, color: 'bg-slate-100 text-slate-600' }
const segmentInfo = (v: string) => SEGMENTS.find(s => s.value === v) ?? { label: v, icon: '🏢' }
const activityIcon = (t: string) => ACTIVITY_TYPES.find(x => x.value === t)?.icon ?? '📝'

type Tab = 'pipeline' | 'list' | 'intake' | 'outreach' | 'analytics' | 'strategy'

const EMPTY_LEAD: Omit<Lead, 'id' | 'created_at'> = {
  company_name: '', segment: 'designer', contact_name: '', phone: '', email: '',
  instagram: '', website: '', city: 'Москва', status: 'new', source: 'manual',
  score: 'C', size_category: 'small', notes: '', ai_summary: null, potential_monthly: null, last_contact_date: null,
}

const EMPTY_ACT: Omit<Activity, 'id' | 'lead_id' | 'created_at'> = {
  type: 'call', note: '', outcome: '', next_action: '', next_action_date: '',
}

// ─── Main page ──────────────────────────────────────────────────────────────

export default function B2BDevelopmentPage() {
  const [tab, setTab]             = useState<Tab>('pipeline')
  const [leads, setLeads]         = useState<Lead[]>([])
  const [loading, setLoading]     = useState(true)
  const [segFilter, setSegFilter] = useState('')
  const [scoreFilter, setScoreFilter] = useState('')

  // Lead CRUD
  const [showLeadForm, setShowLeadForm] = useState(false)
  const [leadForm, setLeadForm]         = useState<Omit<Lead, 'id' | 'created_at'>>(EMPTY_LEAD)
  const [editLeadId, setEditLeadId]     = useState<number | null>(null)
  const [savingLead, setSavingLead]     = useState(false)

  // Activity panel
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [activities, setActivities]     = useState<Activity[]>([])
  const [loadingAct, setLoadingAct]     = useState(false)
  const [showActForm, setShowActForm]   = useState(false)
  const [actForm, setActForm]           = useState<Omit<Activity, 'id' | 'lead_id' | 'created_at'>>(EMPTY_ACT)
  const [savingAct, setSavingAct]       = useState(false)

  // AI
  const [aiMessage, setAiMessage]       = useState('')
  const [generating, setGenerating]     = useState(false)
  const [scoring, setScoring]           = useState(false)

  useEffect(() => { load() }, [segFilter, scoreFilter])

  async function load() {
    setLoading(true)
    const params = new URLSearchParams()
    if (segFilter)   params.set('segment', segFilter)
    if (scoreFilter) params.set('score', scoreFilter) // pass to API
    const q = params.toString() ? `?${params}` : ''
    const res = await fetch(`/api/admin/b2b-leads${q}`)
    const data: Lead[] = res.ok ? await res.json() : []
    setLeads(scoreFilter ? data.filter(l => l.score === scoreFilter) : data)
    setLoading(false)
  }

  async function openLead(lead: Lead) {
    setSelectedLead(lead)
    setActivities([])
    setAiMessage('')
    setLoadingAct(true)
    const res = await fetch(`/api/admin/b2b-leads?type=activity&lead_id=${lead.id}`)
    setActivities(res.ok ? await res.json() : [])
    setLoadingAct(false)
  }

  async function saveLead() {
    if (!leadForm.company_name.trim()) return
    setSavingLead(true)
    const method = editLeadId ? 'PUT' : 'POST'
    const body   = editLeadId ? { id: editLeadId, ...leadForm } : leadForm
    const res = await fetch('/api/admin/b2b-leads', {
      method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    setSavingLead(false)
    if (res.ok) { setShowLeadForm(false); load() }
  }

  async function updateLeadStatus(lead: Lead, status: string) {
    await fetch('/api/admin/b2b-leads', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: lead.id, status }),
    })
    setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, status } : l))
    if (selectedLead?.id === lead.id) setSelectedLead(prev => prev ? { ...prev, status } : prev)
  }

  async function deleteLead(id: number) {
    if (!confirm('Удалить лид?')) return
    await fetch('/api/admin/b2b-leads', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    setLeads(prev => prev.filter(l => l.id !== id))
    if (selectedLead?.id === id) setSelectedLead(null)
  }

  async function saveActivity() {
    if (!selectedLead || !actForm.note.trim()) return
    setSavingAct(true)
    await fetch('/api/admin/b2b-leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _type: 'activity', lead_id: selectedLead.id, ...actForm }),
    })
    setSavingAct(false)
    setShowActForm(false)
    setActForm(EMPTY_ACT)
    openLead(selectedLead)
  }

  async function generateAIMessage() {
    if (!selectedLead) return
    setGenerating(true)
    setAiMessage('')
    const res = await fetch('/api/ai/b2b-message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company_name: selectedLead.company_name,
        segment: selectedLead.segment,
        contact_name: selectedLead.contact_name,
        status: selectedLead.status,
        last_activity: activities[0]?.note,
      }),
    })
    const data = await res.json()
    setAiMessage(data.message || '')
    setGenerating(false)
  }

  async function scoreLeadWithAI(lead: Lead) {
    setScoring(true)
    const res = await fetch('/api/ai/b2b-score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lead }),
    })
    const result = await res.json()
    setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, score: result.score, ai_summary: result.reason } : l))
    if (selectedLead?.id === lead.id) setSelectedLead(prev => prev ? { ...prev, score: result.score, ai_summary: result.reason } : prev)
    setScoring(false)
  }

  // ─── Render ─────────────────────────────────────────────────────────────

  const pipelineGroups = STATUSES.map(s => ({
    ...s, leads: leads.filter(l => l.status === s.value),
  })).filter(g => g.leads.length > 0)

  const aLeads = leads.filter(l => l.score === 'A')
  const totalPotential = leads.reduce((s, l) => s + (l.potential_monthly ?? 0), 0)

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[11px] font-semibold text-muted uppercase tracking-wider mb-1">Только для владельца</p>
          <h1 className="text-[22px] font-semibold text-ink tracking-tight">B2B Development</h1>
          <p className="text-[13px] text-ink-soft mt-1">B2B Growth System — поиск, скоринг, outreach, аналитика</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setTab('intake')}
            className="px-4 py-2 bg-amber-500 text-white rounded-xl text-[13px] font-medium hover:bg-amber-600 transition-colors"
          >⚡ Пополнить базу</button>
          <button
            onClick={() => { setLeadForm(EMPTY_LEAD); setEditLeadId(null); setShowLeadForm(true) }}
            className="px-4 py-2 bg-ink text-white rounded-xl text-[13px] font-medium hover:bg-[#333] transition-colors"
          >+ Лид</button>
        </div>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Всего лидов', value: leads.length, color: 'text-ink' },
          { label: 'Score A',     value: aLeads.length, color: 'text-emerald-700' },
          { label: 'Клиентов',    value: leads.filter(l => l.status === 'regular' || l.status === 'test_order').length, color: 'text-blue-700' },
          { label: 'Потенциал',   value: `${Math.round(totalPotential / 1000)}k`, color: 'text-purple-700' },
        ].map(s => (
          <div key={s.label} className="bg-surface border border-line rounded-xl px-4 py-3">
            <p className="text-[11px] text-muted">{s.label}</p>
            <p className={`text-[20px] font-semibold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 bg-[#f5f5f0] rounded-xl p-1 w-fit flex-wrap">
        {([['pipeline', 'Pipeline'], ['list', 'Список'], ['intake', '⚡ Пополнение'], ['outreach', 'Outreach'], ['analytics', 'Аналитика'], ['strategy', 'Стратегия']] as [Tab, string][]).map(([t, l]) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${tab === t ? 'bg-surface text-ink shadow-sm' : 'text-ink-soft hover:text-ink'}`}>
            {l}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap mb-5">
        <button onClick={() => setSegFilter('')} className={`px-2.5 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${!segFilter ? 'bg-ink text-white' : 'bg-[#f5f5f0] text-ink-soft'}`}>Все</button>
        {SEGMENTS.map(s => (
          <button key={s.value} onClick={() => setSegFilter(segFilter === s.value ? '' : s.value)}
            className={`px-2.5 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${segFilter === s.value ? 'bg-ink text-white' : 'bg-[#f5f5f0] text-ink-soft'}`}>
            {s.icon} {s.label}
          </button>
        ))}
        <div className="w-px bg-line self-stretch mx-1" />
        {SCORES.map(s => (
          <button key={s.value} onClick={() => setScoreFilter(scoreFilter === s.value ? '' : s.value)}
            className={`px-2.5 py-1.5 rounded-lg text-[12px] font-semibold transition-colors ${scoreFilter === s.value ? s.color : 'bg-[#f5f5f0] text-ink-soft'}`}>
            {s.value}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-16 text-center text-[13px] text-muted">Загрузка...</div>
      ) : (
        <div className="flex gap-6">
          <div className="flex-1 min-w-0">

            {/* PIPELINE */}
            {tab === 'pipeline' && (
              <div className="space-y-6">
                {pipelineGroups.length === 0 && <div className="text-center py-16 text-[13px] text-muted">Нет лидов. Нажмите «+ Лид».</div>}
                {pipelineGroups.map(group => (
                  <div key={group.value}>
                    <div className="flex items-center gap-3 mb-3">
                      <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${group.color}`}>{group.label}</span>
                      <span className="text-[11px] text-muted">{group.leads.length}</span>
                      <div className="flex-1 h-px bg-line" />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                      {group.leads.map(lead => (
                        <LeadCard
                          key={lead.id}
                          lead={lead}
                          selected={selectedLead?.id === lead.id}
                          onClick={() => openLead(lead)}
                          onStatusChange={s => updateLeadStatus(lead, s)}
                          onEdit={() => {
                            setLeadForm({ company_name: lead.company_name, segment: lead.segment, contact_name: lead.contact_name ?? '', phone: lead.phone ?? '', email: lead.email ?? '', instagram: lead.instagram ?? '', website: lead.website ?? '', city: lead.city, status: lead.status, source: lead.source, score: lead.score ?? 'C', size_category: lead.size_category ?? 'small', notes: lead.notes ?? '', ai_summary: lead.ai_summary, potential_monthly: lead.potential_monthly, last_contact_date: lead.last_contact_date })
                            setEditLeadId(lead.id)
                            setShowLeadForm(true)
                          }}
                          onDelete={() => deleteLead(lead.id)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* LIST */}
            {tab === 'list' && (
              <div className="bg-surface border border-line rounded-xl overflow-hidden">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-line bg-[#fafaf8]">
                      <th className="text-left px-4 py-3 text-[11px] font-semibold text-muted uppercase tracking-wider">Компания</th>
                      <th className="text-left px-4 py-3 text-[11px] font-semibold text-muted uppercase tracking-wider">Сегмент</th>
                      <th className="text-left px-4 py-3 text-[11px] font-semibold text-muted uppercase tracking-wider">Статус</th>
                      <th className="text-left px-4 py-3 text-[11px] font-semibold text-muted uppercase tracking-wider">Score</th>
                      <th className="text-left px-4 py-3 text-[11px] font-semibold text-muted uppercase tracking-wider">Потенциал</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {leads.length === 0 && <tr><td colSpan={6} className="text-center py-12 text-muted">Нет лидов</td></tr>}
                    {leads.map(lead => {
                      const st = statusInfo(lead.status)
                      const sc = SCORES.find(s => s.value === lead.score)
                      return (
                        <tr key={lead.id} className="border-b border-line-soft hover:bg-[#fafaf8] cursor-pointer" onClick={() => openLead(lead)}>
                          <td className="px-4 py-3">
                            <p className="font-medium text-ink">{lead.company_name}</p>
                            {lead.contact_name && <p className="text-[12px] text-muted">{lead.contact_name}</p>}
                          </td>
                          <td className="px-4 py-3 text-ink-soft">{segmentInfo(lead.segment).icon} {segmentInfo(lead.segment).label}</td>
                          <td className="px-4 py-3">
                            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${st.color}`}>{st.label}</span>
                          </td>
                          <td className="px-4 py-3">
                            {sc && <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${sc.color}`}>{sc.value}</span>}
                          </td>
                          <td className="px-4 py-3 text-ink-soft">
                            {lead.potential_monthly ? `${lead.potential_monthly.toLocaleString('ru-RU')} ₽/мес` : '—'}
                          </td>
                          <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                            <button onClick={() => deleteLead(lead.id)} className="text-[11px] text-red-400 hover:text-red-600 px-2 py-1">✕</button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* INTAKE */}
            {tab === 'intake' && <IntakeTab onAdded={load} />}

            {/* OUTREACH */}
            {tab === 'outreach' && <OutreachTab />}

            {/* ANALYTICS */}
            {tab === 'analytics' && <AnalyticsTab leads={leads} />}

            {/* STRATEGY */}
            {tab === 'strategy' && <StrategyTab leads={leads} />}
          </div>

          {/* Activity sidebar */}
          {selectedLead && (
            <div className="w-80 flex-shrink-0">
              <div className="bg-surface border border-line rounded-xl sticky top-6 max-h-[calc(100vh-6rem)] overflow-y-auto">
                <div className="p-4 border-b border-line">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="text-[14px] font-semibold text-ink">{selectedLead.company_name}</p>
                        {selectedLead.score && (
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${SCORES.find(s => s.value === selectedLead.score)?.color ?? ''}`}>
                            {selectedLead.score}
                          </span>
                        )}
                      </div>
                      <p className="text-[12px] text-muted">{segmentInfo(selectedLead.segment).icon} {segmentInfo(selectedLead.segment).label} · {selectedLead.city}</p>
                    </div>
                    <button onClick={() => setSelectedLead(null)} className="text-[#c0c0bb] hover:text-ink text-sm flex-shrink-0">✕</button>
                  </div>

                  {selectedLead.ai_summary && (
                    <p className="text-[11px] text-ink-soft italic mb-2 bg-[#fafaf8] px-2 py-1.5 rounded-lg">{selectedLead.ai_summary}</p>
                  )}

                  <select
                    value={selectedLead.status}
                    onChange={e => updateLeadStatus(selectedLead, e.target.value)}
                    className="w-full border border-line rounded-lg px-2 py-1.5 text-[12px] bg-surface focus:outline-none mb-2"
                  >
                    {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>

                  <div className="space-y-1 text-[12px] text-ink-soft mb-3">
                    {selectedLead.phone     && <p>📞 {selectedLead.phone}</p>}
                    {selectedLead.email     && <p>📧 {selectedLead.email}</p>}
                    {selectedLead.instagram && <p>📸 {selectedLead.instagram}</p>}
                    {selectedLead.website   && <p>🌐 {selectedLead.website}</p>}
                    {selectedLead.potential_monthly && (
                      <p className="text-emerald-700 font-medium">💰 {selectedLead.potential_monthly.toLocaleString('ru-RU')} ₽/мес</p>
                    )}
                    {selectedLead.notes && <p className="italic text-muted">{selectedLead.notes}</p>}
                  </div>

                  <div className="flex gap-2">
                    <button onClick={generateAIMessage} disabled={generating}
                      className="flex-1 px-2 py-1.5 bg-[#f5f5f0] rounded-lg text-[12px] font-medium hover:bg-[#eeeeea] transition-colors disabled:opacity-50">
                      {generating ? '✨ ...' : '✨ Сообщение'}
                    </button>
                    <button onClick={() => scoreLeadWithAI(selectedLead)} disabled={scoring}
                      className="flex-1 px-2 py-1.5 bg-[#f5f5f0] rounded-lg text-[12px] font-medium hover:bg-[#eeeeea] transition-colors disabled:opacity-50">
                      {scoring ? '⚡ ...' : '⚡ AI Score'}
                    </button>
                  </div>

                  {aiMessage && (
                    <div className="mt-2 bg-[#fafaf8] border border-line rounded-lg p-3">
                      <p className="text-[12px] text-ink leading-relaxed whitespace-pre-wrap">{aiMessage}</p>
                      <button onClick={() => navigator.clipboard.writeText(aiMessage)}
                        className="mt-1.5 text-[11px] text-muted hover:text-ink">Копировать</button>
                    </div>
                  )}
                </div>

                <div className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[12px] font-semibold text-ink">История</p>
                    <button onClick={() => { setActForm(EMPTY_ACT); setShowActForm(true) }}
                      className="text-[11px] px-2.5 py-1 bg-ink text-white rounded-lg hover:bg-[#333] transition-colors">+ Контакт</button>
                  </div>
                  {loadingAct ? (
                    <div className="text-center py-4 text-[12px] text-muted">Загрузка...</div>
                  ) : activities.length === 0 ? (
                    <div className="text-center py-4 text-[12px] text-muted">Нет контактов</div>
                  ) : (
                    <div className="space-y-3">
                      {activities.map(act => (
                        <div key={act.id} className="flex gap-2.5">
                          <span className="flex-shrink-0 text-base mt-0.5">{activityIcon(act.type)}</span>
                          <div className="min-w-0">
                            <p className="text-[12px] text-ink leading-relaxed">{act.note}</p>
                            {act.outcome && <p className="text-[11px] text-ink-soft">{act.outcome}</p>}
                            {act.next_action && <p className="text-[11px] text-blue-600">→ {act.next_action}</p>}
                            <p className="text-[10px] text-[#c0c0bb] mt-0.5">
                              {new Date(act.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Lead form modal */}
      {showLeadForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-2xl shadow-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-[16px] font-semibold text-ink mb-5">{editLeadId ? 'Изменить лид' : 'Новый B2B лид'}</h2>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] font-medium text-ink-soft mb-1">Компания *</label>
                  <input type="text" value={leadForm.company_name} onChange={e => setLeadForm(f => ({ ...f, company_name: e.target.value }))}
                    className="w-full border border-line rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-300" />
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-ink-soft mb-1">Сегмент</label>
                  <select value={leadForm.segment} onChange={e => setLeadForm(f => ({ ...f, segment: e.target.value }))}
                    className="w-full border border-line rounded-lg px-3 py-2 text-[13px] bg-surface focus:outline-none">
                    {SEGMENTS.map(s => <option key={s.value} value={s.value}>{s.icon} {s.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] font-medium text-ink-soft mb-1">Контакт</label>
                  <input type="text" value={leadForm.contact_name ?? ''} onChange={e => setLeadForm(f => ({ ...f, contact_name: e.target.value }))}
                    className="w-full border border-line rounded-lg px-3 py-2 text-[13px] focus:outline-none" />
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-ink-soft mb-1">Телефон</label>
                  <input type="text" value={leadForm.phone ?? ''} onChange={e => setLeadForm(f => ({ ...f, phone: e.target.value }))}
                    className="w-full border border-line rounded-lg px-3 py-2 text-[13px] focus:outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[12px] font-medium text-ink-soft mb-1">Email</label>
                  <input type="email" value={leadForm.email ?? ''} onChange={e => setLeadForm(f => ({ ...f, email: e.target.value }))}
                    className="w-full border border-line rounded-lg px-3 py-2 text-[13px] focus:outline-none" />
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-ink-soft mb-1">Instagram</label>
                  <input type="text" value={leadForm.instagram ?? ''} onChange={e => setLeadForm(f => ({ ...f, instagram: e.target.value }))}
                    className="w-full border border-line rounded-lg px-3 py-2 text-[13px] focus:outline-none" />
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-ink-soft mb-1">Сайт</label>
                  <input type="text" value={leadForm.website ?? ''} onChange={e => setLeadForm(f => ({ ...f, website: e.target.value }))}
                    className="w-full border border-line rounded-lg px-3 py-2 text-[13px] focus:outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <label className="block text-[12px] font-medium text-ink-soft mb-1">Статус</label>
                  <select value={leadForm.status} onChange={e => setLeadForm(f => ({ ...f, status: e.target.value }))}
                    className="w-full border border-line rounded-lg px-3 py-2 text-[13px] bg-surface focus:outline-none">
                    {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-ink-soft mb-1">Score</label>
                  <select value={leadForm.score ?? 'C'} onChange={e => setLeadForm(f => ({ ...f, score: e.target.value }))}
                    className="w-full border border-line rounded-lg px-3 py-2 text-[13px] bg-surface focus:outline-none">
                    {SCORES.map(s => <option key={s.value} value={s.value}>{s.value} — {s.desc}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-ink-soft mb-1">Размер</label>
                  <select value={leadForm.size_category ?? 'small'} onChange={e => setLeadForm(f => ({ ...f, size_category: e.target.value }))}
                    className="w-full border border-line rounded-lg px-3 py-2 text-[13px] bg-surface focus:outline-none">
                    {SIZES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-ink-soft mb-1">Потенциал ₽/мес</label>
                  <input type="number" value={leadForm.potential_monthly ?? ''} onChange={e => setLeadForm(f => ({ ...f, potential_monthly: e.target.value ? +e.target.value : null }))}
                    className="w-full border border-line rounded-lg px-3 py-2 text-[13px] focus:outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-[12px] font-medium text-ink-soft mb-1">Заметки</label>
                <textarea value={leadForm.notes ?? ''} onChange={e => setLeadForm(f => ({ ...f, notes: e.target.value }))}
                  rows={3} className="w-full border border-line rounded-lg px-3 py-2 text-[13px] resize-none focus:outline-none" />
              </div>
            </div>
            <div className="mt-5 flex gap-3">
              <button onClick={saveLead} disabled={savingLead}
                className="px-5 py-2 bg-ink text-white rounded-xl text-[13px] font-medium hover:bg-[#333] disabled:opacity-50 transition-colors">
                {savingLead ? 'Сохранение...' : 'Сохранить'}
              </button>
              <button onClick={() => setShowLeadForm(false)}
                className="px-5 py-2 border border-line rounded-xl text-[13px] text-ink-soft hover:bg-[#f5f5f0] transition-colors">Отмена</button>
            </div>
          </div>
        </div>
      )}

      {/* Activity modal */}
      {showActForm && selectedLead && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-2xl shadow-xl w-full max-w-lg p-6">
            <h2 className="text-[16px] font-semibold text-ink mb-5">Добавить контакт — {selectedLead.company_name}</h2>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] font-medium text-ink-soft mb-1">Тип</label>
                  <select value={actForm.type} onChange={e => setActForm(f => ({ ...f, type: e.target.value }))}
                    className="w-full border border-line rounded-lg px-3 py-2 text-[13px] bg-surface focus:outline-none">
                    {ACTIVITY_TYPES.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-ink-soft mb-1">Результат</label>
                  <select value={actForm.outcome ?? ''} onChange={e => setActForm(f => ({ ...f, outcome: e.target.value }))}
                    className="w-full border border-line rounded-lg px-3 py-2 text-[13px] bg-surface focus:outline-none">
                    <option value="">— не выбрано —</option>
                    {OUTCOMES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[12px] font-medium text-ink-soft mb-1">Заметка *</label>
                <textarea value={actForm.note} onChange={e => setActForm(f => ({ ...f, note: e.target.value }))}
                  rows={3} className="w-full border border-line rounded-lg px-3 py-2 text-[13px] resize-none focus:outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] font-medium text-ink-soft mb-1">Следующий шаг</label>
                  <input type="text" value={actForm.next_action ?? ''} onChange={e => setActForm(f => ({ ...f, next_action: e.target.value }))}
                    className="w-full border border-line rounded-lg px-3 py-2 text-[13px] focus:outline-none" />
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-ink-soft mb-1">Дата</label>
                  <input type="date" value={actForm.next_action_date ?? ''} onChange={e => setActForm(f => ({ ...f, next_action_date: e.target.value }))}
                    className="w-full border border-line rounded-lg px-3 py-2 text-[13px] focus:outline-none" />
                </div>
              </div>
            </div>
            <div className="mt-5 flex gap-3">
              <button onClick={saveActivity} disabled={savingAct}
                className="px-5 py-2 bg-ink text-white rounded-xl text-[13px] font-medium hover:bg-[#333] disabled:opacity-50 transition-colors">
                {savingAct ? 'Сохранение...' : 'Сохранить'}
              </button>
              <button onClick={() => setShowActForm(false)}
                className="px-5 py-2 border border-line rounded-xl text-[13px] text-ink-soft hover:bg-[#f5f5f0] transition-colors">Отмена</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Lead Card ──────────────────────────────────────────────────────────────

function LeadCard({ lead, selected, onClick, onStatusChange, onEdit, onDelete }: {
  lead: Lead; selected: boolean; onClick: () => void
  onStatusChange: (s: string) => void; onEdit: () => void; onDelete: () => void
}) {
  const st = statusInfo(lead.status)
  const sc = SCORES.find(s => s.value === lead.score)
  const seg = segmentInfo(lead.segment)
  return (
    <div
      className={`bg-surface border rounded-xl p-4 cursor-pointer transition-all ${selected ? 'border-ink ring-1 ring-ink' : 'border-line hover:border-[#c0c0bb]'}`}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            {sc && <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded flex-shrink-0 ${sc.color}`}>{sc.value}</span>}
            <p className="text-[13px] font-semibold text-ink truncate">{lead.company_name}</p>
          </div>
          <p className="text-[11px] text-muted">{seg.icon} {seg.label}{lead.contact_name ? ` · ${lead.contact_name}` : ''}</p>
        </div>
        <div className="flex gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
          <button onClick={onEdit} className="text-[11px] text-muted hover:text-ink px-1">✎</button>
          <button onClick={onDelete} className="text-[11px] text-red-400 hover:text-red-600 px-1">✕</button>
        </div>
      </div>
      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${st.color}`}>{st.label}</span>
      {lead.potential_monthly && (
        <p className="text-[12px] text-emerald-700 font-medium mt-1.5">💰 {lead.potential_monthly.toLocaleString('ru-RU')} ₽/мес</p>
      )}
      {lead.phone && <p className="text-[12px] text-ink-soft mt-1">📞 {lead.phone}</p>}
      <div onClick={e => e.stopPropagation()} className="mt-2">
        <select value={lead.status} onChange={e => onStatusChange(e.target.value)}
          className="w-full border border-line rounded-lg px-2 py-1 text-[11px] bg-surface focus:outline-none">
          {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>
    </div>
  )
}

// ─── Intake Tab ─────────────────────────────────────────────────────────────

function IntakeTab({ onAdded }: { onAdded: () => void }) {
  const [mode, setMode]       = useState<'quick' | 'csv' | 'ai'>('ai')
  const [clearing, setClearing] = useState(false)

  async function clearAll() {
    if (!confirm('Удалить ВСЕ лиды из базы? Это действие необратимо.')) return
    setClearing(true)
    await fetch('/api/admin/b2b-seed', { method: 'DELETE' })
    setClearing(false)
    onAdded()
  }

  // Quick capture state
  const [qSeg, setQSeg]     = useState('designer')
  const [qName, setQName]   = useState('')
  const [qPhone, setQPhone] = useState('')
  const [qInsta, setQInsta] = useState('')
  const [qNote, setQNote]   = useState('')
  const [qSaving, setQSaving] = useState(false)
  const [qCount, setQCount]   = useState(0)
  const nameRef = useRef<HTMLInputElement>(null)

  async function quickSave() {
    if (!qName.trim()) return
    setQSaving(true)
    await fetch('/api/admin/b2b-leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company_name: qName.trim(),
        segment: qSeg,
        phone: qPhone.trim() || null,
        instagram: qInsta.trim() || null,
        notes: qNote.trim() || null,
        status: 'new',
        source: 'manual',
        city: 'Москва',
        score: 'C',
        size_category: 'small',
      }),
    })
    setQCount(c => c + 1)
    setQName(''); setQPhone(''); setQInsta(''); setQNote('')
    setQSaving(false)
    onAdded()
    setTimeout(() => nameRef.current?.focus(), 50)
  }

  // CSV state
  const [csvText, setCsvText]     = useState('')
  const [csvParsed, setCsvParsed] = useState<object[] | null>(null)
  const [csvImporting, setCsvImporting] = useState(false)
  const [csvMsg, setCsvMsg]       = useState('')

  function parseCSV() {
    const lines = csvText.trim().split('\n').filter(Boolean)
    if (lines.length < 2) { setCsvMsg('Нужен заголовок + хотя бы одна строка'); return }
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[" ]/g, ''))
    const rows = lines.slice(1).map(line => {
      const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''))
      const obj: Record<string, string | null> = {}
      headers.forEach((h, i) => { obj[h] = vals[i] || null })
      return obj
    })
    setCsvParsed(rows)
    setCsvMsg(`Распознано ${rows.length} строк. Проверь и нажми Импортировать.`)
  }

  async function importCSV() {
    if (!csvParsed) return
    setCsvImporting(true)
    const toInsert = csvParsed.map((row: object) => {
      const r = row as Record<string, string | null>
      return {
        company_name:     r['company_name'] || r['компания'] || r['название'] || 'Без названия',
        segment:          r['segment']      || r['сегмент']  || 'designer',
        contact_name:     r['contact_name'] || r['контакт']  || r['имя'] || null,
        phone:            r['phone']        || r['телефон']  || null,
        instagram:        r['instagram']    || null,
        website:          r['website']      || r['сайт']     || null,
        notes:            r['notes']        || r['заметки']  || null,
        city:             r['city']         || r['город']    || 'Москва',
        status:           'new',
        source:           'manual',
        score:            'C',
        size_category:    'small',
      }
    })
    const res = await fetch('/api/admin/b2b-leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _type: 'bulk', leads: toInsert }),
    })
    const data = await res.json()
    if (res.ok) {
      setCsvMsg(`✓ Импортировано ${toInsert.length} лидов`)
      setCsvText(''); setCsvParsed(null)
      onAdded()
    } else {
      setCsvMsg(data.error ?? 'Ошибка импорта')
    }
    setCsvImporting(false)
  }

  // AI Prospecting state
  const [aiSeg, setAiSeg]       = useState('designer')
  const [aiDesc, setAiDesc]     = useState('')
  const [aiCount, setAiCount]   = useState(10)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiResult, setAiResult] = useState('')

  async function runProspect() {
    setAiLoading(true)
    setAiResult('')
    const res = await fetch('/api/ai/b2b-prospect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ segment: aiSeg, description: aiDesc, count: aiCount }),
    })
    const data = await res.json()
    if (res.ok) {
      setAiResult(`✓ Добавлено ${data.count} лидов в базу со статусом «Новый»`)
      onAdded()
    } else {
      setAiResult(data.error ?? 'Ошибка')
    }
    setAiLoading(false)
  }

  return (
    <div className="space-y-5">
      {/* Mode selector + clear */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex gap-1 bg-[#f5f5f0] rounded-xl p-1">
          {([['ai', '🤖 AI Проспектинг'], ['quick', '⚡ Быстрый захват'], ['csv', '📋 CSV Импорт']] as const).map(([m, l]) => (
            <button key={m} onClick={() => setMode(m)}
              className={`px-4 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${mode === m ? 'bg-surface text-ink shadow-sm' : 'text-ink-soft hover:text-ink'}`}>
              {l}
            </button>
          ))}
        </div>
        <button
          onClick={clearAll}
          disabled={clearing}
          className="px-3 py-1.5 rounded-lg text-[12px] font-medium text-red-500 hover:bg-red-50 border border-red-200 hover:border-red-300 disabled:opacity-40 transition-colors"
        >
          {clearing ? 'Удаляю...' : '🗑 Очистить базу'}
        </button>
      </div>

      {/* ── AI PROSPECTING ── */}
      {mode === 'ai' && (
        <div className="bg-surface border border-line rounded-xl p-6">
          <div className="mb-5">
            <h3 className="text-[15px] font-semibold text-ink mb-1">AI Проспектинг</h3>
            <p className="text-[12px] text-muted">
              AI генерирует список компаний для прозвона по описанию сегмента. Лиды добавляются в базу со статусом «Новый» — дальше вы их исследуете и контактируете.
            </p>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[12px] font-medium text-ink-soft mb-1.5">Сегмент</label>
                <select value={aiSeg} onChange={e => setAiSeg(e.target.value)}
                  className="w-full border border-line rounded-lg px-3 py-2 text-[13px] bg-surface focus:outline-none focus:ring-2 focus:ring-amber-300">
                  {SEGMENTS.map(s => <option key={s.value} value={s.value}>{s.icon} {s.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[12px] font-medium text-ink-soft mb-1.5">Количество компаний</label>
                <select value={aiCount} onChange={e => setAiCount(+e.target.value)}
                  className="w-full border border-line rounded-lg px-3 py-2 text-[13px] bg-surface focus:outline-none">
                  {[5, 10, 15, 20].map(n => <option key={n} value={n}>{n} компаний</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[12px] font-medium text-ink-soft mb-1.5">
                Уточни задачу <span className="text-[#c0c0bb] font-normal">(необязательно)</span>
              </label>
              <textarea
                value={aiDesc}
                onChange={e => setAiDesc(e.target.value)}
                rows={3}
                placeholder="Например: дизайнеры с Instagram 5k+ подписчиков, которые показывают ванные комнаты. Или: мебельные фабрики в МО с собственным производством."
                className="w-full border border-line rounded-lg px-3 py-2 text-[13px] resize-none focus:outline-none focus:ring-2 focus:ring-amber-300 placeholder:text-[#c0c0bb]"
              />
            </div>

            <div className="flex items-center gap-4">
              <button onClick={runProspect} disabled={aiLoading}
                className="px-5 py-2.5 bg-amber-500 text-white rounded-xl text-[13px] font-semibold hover:bg-amber-600 disabled:opacity-50 transition-colors">
                {aiLoading ? '⏳ Генерирую...' : '🤖 Сгенерировать список'}
              </button>
              {aiResult && (
                <span className={`text-[13px] font-medium ${aiResult.startsWith('✓') ? 'text-emerald-700' : 'text-red-600'}`}>
                  {aiResult}
                </span>
              )}
            </div>

            {aiLoading && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-[13px] text-amber-800">
                AI подбирает компании для сегмента «{SEGMENTS.find(s => s.value === aiSeg)?.label}»... Обычно занимает 10–20 секунд.
              </div>
            )}
          </div>

          <div className="mt-5 pt-5 border-t border-line-soft">
            <p className="text-[11px] text-muted leading-relaxed">
              <strong className="text-ink-soft">Как использовать:</strong> AI создаёт правдоподобные профили компаний, которые стоит исследовать.
              Это не реальные данные — менеджер открывает каждый лид, ищет компанию в 2ГИС / Instagram / Google,
              находит контакт и переводит статус в «Исследован» → «Написали».
            </p>
          </div>
        </div>
      )}

      {/* ── QUICK CAPTURE ── */}
      {mode === 'quick' && (
        <div className="bg-surface border border-line rounded-xl p-6">
          <div className="mb-5">
            <h3 className="text-[15px] font-semibold text-ink mb-1">Быстрый захват лидов</h3>
            <p className="text-[12px] text-muted">
              Добавляй лиды один за другим без лишних кликов. Вводишь данные → Enter → поле очищается → следующий.
            </p>
          </div>

          {qCount > 0 && (
            <div className="mb-4 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg text-[12px] text-emerald-700 font-medium">
              ✓ Добавлено в этой сессии: {qCount}
            </div>
          )}

          <div className="space-y-3">
            <div>
              <label className="block text-[12px] font-medium text-ink-soft mb-1.5">Сегмент</label>
              <div className="flex gap-1.5 flex-wrap">
                {SEGMENTS.map(s => (
                  <button key={s.value} onClick={() => setQSeg(s.value)}
                    className={`px-2.5 py-1 rounded-lg text-[12px] font-medium transition-colors ${qSeg === s.value ? 'bg-ink text-white' : 'bg-[#f5f5f0] text-ink-soft hover:bg-[#eeeeea]'}`}>
                    {s.icon} {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-[12px] font-medium text-ink-soft mb-1.5">Название компании *</label>
              <input
                ref={nameRef}
                type="text"
                value={qName}
                onChange={e => setQName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') quickSave() }}
                placeholder="Студия Reroom..."
                className="w-full border border-line rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-ink placeholder:text-[#c0c0bb]"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[12px] font-medium text-ink-soft mb-1.5">Телефон / WhatsApp</label>
                <input type="text" value={qPhone} onChange={e => setQPhone(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') quickSave() }}
                  placeholder="+7 916 ..."
                  className="w-full border border-line rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-ink placeholder:text-[#c0c0bb]" />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-ink-soft mb-1.5">Instagram</label>
                <input type="text" value={qInsta} onChange={e => setQInsta(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') quickSave() }}
                  placeholder="@studio.name"
                  className="w-full border border-line rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-ink placeholder:text-[#c0c0bb]" />
              </div>
            </div>

            <div>
              <label className="block text-[12px] font-medium text-ink-soft mb-1.5">Заметка</label>
              <input type="text" value={qNote} onChange={e => setQNote(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') quickSave() }}
                placeholder="Откуда нашли, что интересно..."
                className="w-full border border-line rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-ink placeholder:text-[#c0c0bb]" />
            </div>

            <button onClick={quickSave} disabled={qSaving || !qName.trim()}
              className="w-full py-2.5 bg-ink text-white rounded-xl text-[13px] font-semibold hover:bg-[#333] disabled:opacity-40 transition-colors">
              {qSaving ? 'Сохраняю...' : '+ Добавить и следующий (Enter)'}
            </button>
          </div>
        </div>
      )}

      {/* ── CSV IMPORT ── */}
      {mode === 'csv' && (
        <div className="bg-surface border border-line rounded-xl p-6">
          <div className="mb-5">
            <h3 className="text-[15px] font-semibold text-ink mb-1">CSV Импорт</h3>
            <p className="text-[12px] text-muted">
              Вставь CSV из Excel / Google Sheets. Поддерживаемые колонки:
            </p>
            <div className="mt-2 bg-[#f5f5f0] rounded-lg px-3 py-2 font-mono text-[11px] text-ink-soft">
              company_name, segment, contact_name, phone, instagram, website, city, notes
            </div>
            <p className="mt-2 text-[11px] text-muted">
              Первая строка — заголовки. Остальные — данные. Разделитель — запятая.
            </p>
          </div>

          <div className="space-y-3">
            <div className="bg-[#fafaf8] border border-line rounded-xl p-3">
              <p className="text-[11px] font-semibold text-ink-soft mb-1.5">Пример формата:</p>
              <pre className="text-[11px] text-muted font-mono leading-relaxed">{`company_name,segment,phone,instagram
Студия Reroom,designer,+7 916 123-45-67,@reroom.studio
Artwood Interior,designer,+7 985 456-78-90,@artwood.interior
Кухни MARTA,furniture,+7 985 901-23-45,@kuhni.marta`}</pre>
            </div>

            <textarea
              value={csvText}
              onChange={e => { setCsvText(e.target.value); setCsvParsed(null); setCsvMsg('') }}
              rows={8}
              placeholder="Вставь CSV сюда..."
              className="w-full border border-line rounded-lg px-3 py-2 text-[12px] font-mono resize-none focus:outline-none focus:ring-2 focus:ring-ink placeholder:text-[#c0c0bb]"
            />

            {csvMsg && (
              <div className={`px-3 py-2 rounded-lg text-[12px] font-medium ${csvMsg.startsWith('✓') ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                {csvMsg}
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={parseCSV} disabled={!csvText.trim()}
                className="px-4 py-2 border border-line rounded-xl text-[13px] font-medium text-ink-soft hover:bg-[#f5f5f0] disabled:opacity-40 transition-colors">
                Проверить
              </button>
              <button onClick={importCSV} disabled={!csvParsed || csvImporting}
                className="px-5 py-2 bg-ink text-white rounded-xl text-[13px] font-semibold hover:bg-[#333] disabled:opacity-40 transition-colors">
                {csvImporting ? 'Импортирую...' : `Импортировать${csvParsed ? ` (${csvParsed.length})` : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Outreach Tab ───────────────────────────────────────────────────────────

function OutreachTab() {
  const [templates, setTemplates] = useState<OutreachTemplate[]>([])
  const [loading, setLoading]     = useState(true)
  const [segFilter, setSegFilter] = useState('')
  const [stageFilter, setStageFilter] = useState('')
  const [expanded, setExpanded]   = useState<number | null>(null)
  const [copied, setCopied]       = useState<number | null>(null)

  useEffect(() => { load() }, [segFilter, stageFilter])

  async function load() {
    setLoading(true)
    const params = new URLSearchParams()
    if (segFilter)   params.set('segment', segFilter)
    if (stageFilter) params.set('stage', stageFilter)
    const q = params.toString() ? `?${params}` : ''
    const res = await fetch(`/api/admin/b2b-outreach${q}`)
    setTemplates(res.ok ? await res.json() : [])
    setLoading(false)
  }

  function copy(t: OutreachTemplate) {
    navigator.clipboard.writeText(t.body)
    setCopied(t.id)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div>
      <div className="bg-[#fafaf8] border border-line rounded-xl p-4 mb-5 text-[13px] text-ink-soft">
        Готовые шаблоны outreach по сегментам. Подставь [Имя] и [Менеджер], адаптируй под конкретную компанию.
      </div>

      <div className="flex gap-2 flex-wrap mb-4">
        <button onClick={() => setSegFilter('')} className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${!segFilter ? 'bg-ink text-white' : 'bg-[#f5f5f0] text-ink-soft'}`}>Все</button>
        {SEGMENTS.map(s => (
          <button key={s.value} onClick={() => setSegFilter(segFilter === s.value ? '' : s.value)}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${segFilter === s.value ? 'bg-ink text-white' : 'bg-[#f5f5f0] text-ink-soft'}`}>
            {s.icon} {s.label}
          </button>
        ))}
        <div className="w-px bg-line self-stretch mx-1" />
        {STAGES.map(s => (
          <button key={s.value} onClick={() => setStageFilter(stageFilter === s.value ? '' : s.value)}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${stageFilter === s.value ? 'bg-ink text-white' : 'bg-[#f5f5f0] text-ink-soft'}`}>
            {s.label}
          </button>
        ))}
      </div>

      {loading ? <div className="py-8 text-center text-[13px] text-muted">Загрузка...</div> : (
        <div className="space-y-2">
          {templates.map(t => (
            <div key={t.id} className="bg-surface border border-line rounded-xl">
              <div className="flex items-center gap-3 p-4 cursor-pointer" onClick={() => setExpanded(expanded === t.id ? null : t.id)}>
                <span className="text-lg flex-shrink-0">{t.channel === 'whatsapp' ? '💬' : t.channel === 'email' ? '📧' : '✈️'}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-ink truncate">{t.title}</p>
                  <p className="text-[11px] text-muted">{segmentInfo(t.segment).label} · {STAGES.find(s => s.value === t.stage)?.label}</p>
                </div>
                <button onClick={e => { e.stopPropagation(); copy(t) }}
                  className="text-[11px] px-2.5 py-1 border border-line rounded-lg text-ink-soft hover:bg-[#f5f5f0] transition-colors flex-shrink-0">
                  {copied === t.id ? '✓' : 'Копировать'}
                </button>
                <span className="text-[#c0c0bb] text-sm flex-shrink-0">{expanded === t.id ? '▲' : '▼'}</span>
              </div>
              {expanded === t.id && (
                <div className="border-t border-line-soft px-4 pb-4 pt-3">
                  <pre className="text-[13px] text-ink leading-relaxed whitespace-pre-wrap font-sans bg-[#fafaf8] rounded-lg p-4">{t.body}</pre>
                  {t.cta && <p className="text-[12px] text-blue-700 mt-2 font-medium">CTA: {t.cta}</p>}
                </div>
              )}
            </div>
          ))}
          {templates.length === 0 && <div className="text-center py-12 text-[13px] text-muted">Нет шаблонов для выбранных фильтров</div>}
        </div>
      )}
    </div>
  )
}

// ─── Analytics Tab ──────────────────────────────────────────────────────────

function AnalyticsTab({ leads }: { leads: Lead[] }) {
  const total   = leads.length
  const byStatus = STATUSES.map(s => ({ ...s, count: leads.filter(l => l.status === s.value).length })).filter(s => s.count > 0)
  const bySeg    = SEGMENTS.map(s => ({ ...s, count: leads.filter(l => l.segment === s.value).length })).filter(s => s.count > 0).sort((a, b) => b.count - a.count)
  const byScore  = SCORES.map(s => ({ ...s, count: leads.filter(l => l.score === s.value).length }))
  const potential = leads.reduce((sum, l) => sum + (l.potential_monthly ?? 0), 0)
  const clients   = leads.filter(l => l.status === 'regular').length
  const testing   = leads.filter(l => l.status === 'test_order').length

  const funnelSteps = [
    { label: 'Всего лидов',       count: total },
    { label: 'Написали',          count: leads.filter(l => !['new', 'researched', 'lost'].includes(l.status)).length },
    { label: 'Созвон / презент.', count: leads.filter(l => ['call_done', 'presentation_sent', 'proposal_sent', 'negotiating', 'test_order', 'regular'].includes(l.status)).length },
    { label: 'КП / Переговоры',   count: leads.filter(l => ['proposal_sent', 'negotiating', 'test_order', 'regular'].includes(l.status)).length },
    { label: 'Тест / Постоянный', count: testing + clients },
  ]

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Лидов всего', value: total, color: 'text-ink' },
          { label: 'Score A', value: byScore.find(s => s.value === 'A')?.count ?? 0, color: 'text-emerald-700' },
          { label: 'Постоянных', value: clients, color: 'text-blue-700' },
          { label: 'Потенциал', value: `${Math.round(potential / 1000)}k ₽`, color: 'text-purple-700' },
        ].map(m => (
          <div key={m.label} className="bg-surface border border-line rounded-xl p-4">
            <p className="text-[11px] text-muted mb-1">{m.label}</p>
            <p className={`text-[22px] font-semibold ${m.color}`}>{m.value}</p>
          </div>
        ))}
      </div>

      {/* Funnel */}
      <div className="bg-surface border border-line rounded-xl p-5">
        <p className="text-[14px] font-semibold text-ink mb-4">Воронка B2B</p>
        <div className="space-y-2">
          {funnelSteps.map((step, i) => {
            const w = total > 0 ? Math.round((step.count / total) * 100) : 0
            return (
              <div key={i} className="flex items-center gap-3">
                <span className="text-[12px] text-ink-soft w-44 flex-shrink-0">{step.label}</span>
                <div className="flex-1 h-2 bg-line-soft rounded-full">
                  <div className="h-2 bg-ink rounded-full transition-all" style={{ width: `${w}%` }} />
                </div>
                <span className="text-[12px] font-medium text-ink w-12 text-right flex-shrink-0">{step.count}</span>
                <span className="text-[11px] text-muted w-8 text-right flex-shrink-0">{w}%</span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-5">
        <div className="bg-surface border border-line rounded-xl p-5">
          <p className="text-[13px] font-semibold text-ink mb-3">По сегментам</p>
          <div className="space-y-2">
            {bySeg.map(s => (
              <div key={s.value} className="flex items-center gap-2">
                <span className="text-[12px] text-ink-soft w-24 flex-shrink-0">{s.icon} {s.label}</span>
                <div className="flex-1 h-1.5 bg-line-soft rounded-full">
                  <div className="h-1.5 bg-ink rounded-full" style={{ width: `${total > 0 ? (s.count / total) * 100 : 0}%` }} />
                </div>
                <span className="text-[12px] font-medium text-ink w-6 text-right">{s.count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-surface border border-line rounded-xl p-5">
          <p className="text-[13px] font-semibold text-ink mb-3">Score распределение</p>
          <div className="space-y-3">
            {byScore.map(s => (
              <div key={s.value} className="flex items-center gap-3">
                <span className={`text-[12px] font-semibold px-2 py-0.5 rounded ${s.color} flex-shrink-0`}>{s.value}</span>
                <span className="text-[12px] text-ink-soft flex-shrink-0">{s.desc}</span>
                <div className="flex-1 h-1.5 bg-line-soft rounded-full">
                  <div className="h-1.5 bg-ink rounded-full" style={{ width: `${total > 0 ? (s.count / total) * 100 : 0}%` }} />
                </div>
                <span className="text-[12px] font-medium text-ink">{s.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Strategy Tab ───────────────────────────────────────────────────────────

function StrategyTab({ leads }: { leads: Lead[] }) {
  const [analysis, setAnalysis] = useState('')
  const [loading, setLoading]   = useState(false)

  async function analyze() {
    setLoading(true)
    const summary = {
      total: leads.length,
      by_segment: Object.fromEntries(
        ['designer','furniture','construction','glass_company','office','aluminum','renovation','studio'].map(seg => [
          seg, leads.filter(l => l.segment === seg).length
        ])
      ),
      by_status: Object.fromEntries(
        ['new','researched','contacted','call_done','negotiating','regular','lost'].map(s => [
          s, leads.filter(l => l.status === s).length
        ])
      ),
      by_score: { A: leads.filter(l => l.score === 'A').length, B: leads.filter(l => l.score === 'B').length, C: leads.filter(l => l.score === 'C').length },
      total_potential: leads.reduce((s, l) => s + (l.potential_monthly ?? 0), 0),
    }
    const res = await fetch('/api/ai/b2b-segment-analysis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leads_summary: summary }),
    })
    const data = await res.json()
    setAnalysis(data.analysis ?? '')
    setLoading(false)
  }

  const SEARCH_TIPS = [
    { platform: '2ГИС', desc: 'Дизайн-студии', query: '"дизайн интерьера" Москва → сортировка по рейтингу → 50+ отзывов' },
    { platform: 'Instagram', desc: 'Дизайнеры', query: '#дизайнинтерьера #москва — просматривать последние посты, искать тех кто показывает ванные' },
    { platform: 'СДЭК', desc: 'Мебельные фабрики', query: 'Google: "мебельная фабрика Москва МО" сайт → найти контакт закупщика' },
    { platform: 'Авито', desc: 'Ремонтники', query: '"ремонт квартир под ключ Москва" → найти компании с большим количеством объявлений' },
    { platform: 'Яндекс', desc: 'Алюминий / Офисы', query: '"офисные перегородки Москва" → B2B компании, у которых нет своего стекольного производства' },
    { platform: 'LinkedIn', desc: 'Дизайнеры / Архитекторы', query: 'Designer + Moscow → смотреть портфолио с ванными' },
  ]

  return (
    <div className="space-y-5">
      <div className="bg-surface border border-line rounded-xl p-5">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h3 className="text-[14px] font-semibold text-ink">AI Анализ сегментов</h3>
            <p className="text-[12px] text-muted">Анализирует текущую базу и даёт стратегические рекомендации</p>
          </div>
          <button onClick={analyze} disabled={loading}
            className="flex-shrink-0 px-4 py-2 bg-ink text-white rounded-xl text-[13px] font-medium hover:bg-[#333] disabled:opacity-50 transition-colors">
            {loading ? 'Анализирую...' : 'Запустить анализ'}
          </button>
        </div>
        {analysis ? (
          <div className="text-[13px] text-ink leading-relaxed whitespace-pre-wrap bg-[#fafaf8] rounded-xl p-4">{analysis}</div>
        ) : (
          <div className="text-[13px] text-muted bg-[#fafaf8] rounded-xl p-4">Нажмите «Запустить анализ» — AI проанализирует текущую базу лидов и даст рекомендации по сегментам, приоритетам и поиску новых клиентов.</div>
        )}
      </div>

      <div className="bg-surface border border-line rounded-xl p-5">
        <h3 className="text-[14px] font-semibold text-ink mb-4">Где искать B2B клиентов в Москве</h3>
        <div className="space-y-3">
          {SEARCH_TIPS.map(tip => (
            <div key={tip.platform} className="flex gap-3">
              <span className="text-[12px] font-semibold text-ink w-20 flex-shrink-0 pt-0.5">{tip.platform}</span>
              <div>
                <p className="text-[12px] font-medium text-ink-soft mb-0.5">{tip.desc}</p>
                <p className="text-[12px] text-muted font-mono">{tip.query}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
        <h3 className="text-[14px] font-semibold text-amber-900 mb-3">Приоритетные сегменты MGlass (по марже и repeat business)</h3>
        <div className="space-y-3">
          {[
            { seg: '🎨 Дизайнеры', why: 'Лучший repeat business. Один дизайнер = 10-30 заказов/год. Высокая маржа (premium объекты, Crystal Vision, 10 мм). Легко масштабировать через реферальную программу.' },
            { seg: '🪑 Мебельные', why: 'Регулярные повторные заказы (зеркала, стекло для фасадов). Средняя маржа, но высокая предсказуемость объёма. Один мебельный клиент = стабильный ежемесячный поток.' },
            { seg: '⚙️ Алюминий / Офисные перегородки', why: 'Крупные объёмы. У большинства нет собственной закалки. Если закрыть одного — объём стабильный на годы. Маржа средняя, зато заказы большие.' },
            { seg: '🏗️ Строители / Renovation', why: 'Высокий объём на объект, но нерегулярно. Важны сроки и надёжность. Хорошо работает через рекомендации от дизайнеров.' },
          ].map(item => (
            <div key={item.seg} className="flex gap-3">
              <p className="text-[13px] font-semibold text-amber-900 w-44 flex-shrink-0">{item.seg}</p>
              <p className="text-[13px] text-amber-800">{item.why}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
