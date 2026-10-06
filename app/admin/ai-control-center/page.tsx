'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'
import {
  runChecks, INITIAL_CHECKS, ISSUE_META, STATUS_ICON, STATUS_COLOR, STATUS_BG,
  SEVERITY_LABEL, SEVERITY_COLOR, FIX_ACTION_LABEL, LOG_KEY,
  type CheckResult, type CheckStatus, type FixStatus, type IssueMeta, type FixLogEntry,
} from '@/lib/healthCheckRunner'
import { PERSPECTIVES, REC_STATUS_LABEL, factLine, type Recommendation, type RecStatus } from '@/lib/ai/recommendationTypes'
import LiveHealthPanel, { liveSummary, type LiveHealth } from '@/components/admin/LiveHealthPanel'
import SystemFactsEditor from '@/components/admin/SystemFactsEditor'

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = 'overview' | 'health' | 'ai' | 'recommendations' | 'log'

const PRIORITY_COLOR: Record<string, string> = {
  critical: 'bg-red-100 text-red-700 border border-red-200',
  high:     'bg-orange-100 text-orange-700 border border-orange-200',
  medium:   'bg-amber-100 text-amber-700 border border-amber-200',
  low:      'bg-blue-100 text-blue-700 border border-blue-200',
}
const PRIORITY_LABEL: Record<string, string> = {
  critical: 'Критично', high: 'Высокий', medium: 'Средний', low: 'Низкий',
}
// ── IssueCard (inline for health check tab) ───────────────────────────────────

function IssueCard({
  check, meta, fixState, canFix, onFix, onIgnore,
}: {
  check: CheckResult
  meta: IssueMeta
  fixState: { status: FixStatus; message?: string }
  canFix: boolean
  onFix: (id: string, fixId: string, name: string, before: string) => Promise<void>
  onIgnore: (id: string) => void
}) {
  const [showInstr, setShowInstr] = useState(false)
  const border = check.status === 'error' ? 'border-red-200' : 'border-amber-200'
  const hdr    = check.status === 'error' ? 'bg-red-50'      : 'bg-amber-50'

  return (
    <div className={`rounded-xl border overflow-hidden ${border}`}>
      <div className={`px-5 py-3 flex items-start justify-between gap-3 ${hdr}`}>
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <span className={`text-[15px] font-bold flex-shrink-0 mt-0.5 ${STATUS_COLOR[check.status]}`}>{STATUS_ICON[check.status]}</span>
          <div>
            <p className="text-[13px] font-semibold text-[#1a1a18]">{check.name}</p>
            <p className="text-[11px] text-[#8a8a85] mt-0.5">{check.module}</p>
          </div>
        </div>
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${SEVERITY_COLOR[meta.severity]}`}>
          {SEVERITY_LABEL[meta.severity]}
        </span>
      </div>
      <div className="px-5 py-4 bg-white space-y-3">
        {check.detail && <div><p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-wide mb-1">Описание</p><p className={`text-[12px] ${check.status === 'error' ? 'text-red-700' : 'text-amber-700'}`}>{check.detail}</p></div>}
        <div><p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-wide mb-1">Причина</p><p className="text-[12px] text-[#3a3a38]">{meta.cause}</p></div>
        <div><p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-wide mb-1">Влияние</p><p className="text-[12px] text-[#3a3a38]">{meta.impact}</p></div>
        <div><p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-wide mb-1">Рекомендация</p><p className="text-[12px] text-[#3a3a38]">{meta.recommendation}</p></div>
        {meta.instruction && showInstr && (
          <div className="rounded-lg bg-[#f7f7f4] border border-[#e8e8e5] p-4 space-y-2">
            <p className="text-[11px] font-semibold text-[#4a4a46] mb-2">Инструкция</p>
            {([['Где', meta.instruction.where], ['Поля', meta.instruction.fields], ['Данные', meta.instruction.data], ['Кто', meta.instruction.who], ['Проверка', meta.instruction.verify]] as [string, string][]).map(([l, v]) => (
              <div key={l} className="grid grid-cols-[80px_1fr] gap-2">
                <span className="text-[10px] text-[#8a8a85]">{l}</span>
                <span className="text-[11px] text-[#2a2a28]">{v}</span>
              </div>
            ))}
          </div>
        )}
        {fixState.message && fixState.status !== 'idle' && (
          <div className={`rounded-lg px-4 py-2.5 text-[12px] font-medium ${fixState.status === 'fixed' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : fixState.status === 'failed' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-blue-50 text-blue-700 border border-blue-200'}`}>
            {fixState.status === 'fixing' ? '⟳ ' : fixState.status === 'fixed' ? '✓ ' : '✕ '}{fixState.message}
          </div>
        )}
      </div>
      <div className="px-5 py-3 bg-[#fafaf8] border-t border-[#f0f0ec] flex items-center gap-2 flex-wrap">
        {fixState.status === 'fixed' && <span className="text-[11px] text-emerald-600 font-semibold">✓ Исправлено</span>}
        {fixState.status === 'failed' && <span className="text-[11px] text-red-600 font-semibold">✕ Не удалось</span>}
        <div className="ml-auto flex items-center gap-2">
          {canFix && meta.autoFixId && fixState.status !== 'fixed' && fixState.status !== 'fixing' && (
            <button onClick={() => onFix(check.id, meta.autoFixId!, check.name, check.detail ?? '')} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-[#111110] text-white hover:bg-[#27272a] transition-colors">
              Исправить автоматически
            </button>
          )}
          {meta.instruction && (
            <button onClick={() => setShowInstr(v => !v)} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold border border-[#d8d8d4] text-[#4a4a46] hover:bg-[#f0f0ec] transition-colors">
              {showInstr ? 'Скрыть' : 'Инструкция'}
            </button>
          )}
          <button onClick={() => onIgnore(check.id)} className="px-2 py-1.5 text-[11px] text-[#9a9a95] hover:text-[#5a5a55] transition-colors">Игнор.</button>
        </div>
      </div>
    </div>
  )
}

// ── RecommendationCard ────────────────────────────────────────────────────────

// Каждая рекомендация ждёт решения владельца: в работу, в архив или убрать.
// Взятая в работу закрывается «Сделано» с записью, что получилось.
function RecommendationCard({
  rec, onDecide,
}: {
  rec: Recommendation
  onDecide: (id: string, status: RecStatus, resultNote?: string) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [closing, setClosing] = useState(false)
  const [note, setNote] = useState('')
  const decide = async (status: RecStatus, resultNote?: string) => {
    setBusy(true)
    try { await onDecide(rec.id, status, resultNote) } finally { setBusy(false); setClosing(false) }
  }
  const btn = 'px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-40'

  return (
    <div className={`rounded-xl border border-[#e8e8e5] overflow-hidden ${rec.status === 'archived' ? 'opacity-70' : ''}`}>
      <div className="px-5 py-3 bg-white flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${PRIORITY_COLOR[rec.priority]}`}>{PRIORITY_LABEL[rec.priority]}</span>
            {rec.category && <span className="text-[10px] text-[#9a9a95] bg-[#f4f3f1] px-2 py-0.5 rounded-full">{rec.category}</span>}
            {rec.perspective && <span className="text-[10px] text-violet-600 bg-violet-50 px-2 py-0.5 rounded-full">{PERSPECTIVES.find(p => p.id === rec.perspective)?.label ?? rec.perspective}</span>}
          </div>
          <p className="text-[13px] font-semibold text-[#1a1a18]">{rec.title}</p>
        </div>
        <span className="text-[10px] text-[#9a9a95] flex-shrink-0 mt-1 text-right">
          {REC_STATUS_LABEL[rec.status]}<br />{new Date(rec.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
        </span>
      </div>
      <div className="px-5 pb-4 bg-white space-y-2">
        {rec.problem && <div><p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-wide mb-0.5">Проблема</p><p className="text-[12px] text-[#3a3a38]">{rec.problem}</p></div>}
        {rec.impact && <div><p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-wide mb-0.5">Чем это стоит</p><p className="text-[12px] text-[#3a3a38]">{rec.impact}</p></div>}
        {rec.action && <div><p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-wide mb-0.5">Что сделать</p><p className="text-[12px] text-[#3a3a38]">{rec.action}</p></div>}
        {rec.metric && <div className="rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2"><p className="text-[11px] text-emerald-800"><b>Результат:</b> {rec.metric}</p></div>}
        {rec.evidence && rec.evidence.facts.length > 0 && (
          <div className="rounded-lg border border-[#e8e8e5] px-3 py-2">
            <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-wide mb-1">Цифры, на которых держится вывод</p>
            <ul className="space-y-0.5">
              {rec.evidence.facts.map(f => (
                <li key={f.id} className="text-[11px] text-[#3a3a38]">{factLine(f)} <span className="text-[#9a9a95]">· {f.source}</span>{f.id === rec.evidence?.check && <span className="text-emerald-700"> · сверим через месяц</span>}</li>
              ))}
            </ul>
            {rec.evidence.unverified.length > 0 && <p className="text-[11px] text-amber-700 mt-1">В тексте есть числа не из данных: {rec.evidence.unverified.join(', ')} — проверьте, прежде чем опираться.</p>}
          </div>
        )}
        {rec.status === 'done' && (
          <div className="rounded-lg bg-[#f5f5f3] px-3 py-2">
            <p className="text-[11px] text-[#3a3a38]"><b>Сделано{rec.done_at ? ` ${new Date(rec.done_at).toLocaleDateString('ru-RU')}` : ''}.</b> {rec.result_note ?? 'Итог не записан'}</p>
          </div>
        )}
      </div>
      {closing && (
        <div className="px-5 py-3 bg-[#fafaf8] border-t border-[#f0f0ec] space-y-2">
          <textarea id={`rec-note-${rec.id}`} value={note} onChange={e => setNote(e.target.value)} rows={2}
            placeholder="Что получилось — цифрой, если есть: «конверсия в замер 3% → 6%»"
            className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[12px] bg-white" />
          <div className="flex gap-2">
            <button disabled={busy} onClick={() => decide('done', note)} className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}>Сохранить итог</button>
            <button onClick={() => setClosing(false)} className={`${btn} text-[#6b6b66] hover:bg-[#f0f0ec]`}>Отмена</button>
          </div>
        </div>
      )}
      {!closing && (
        <div className="px-5 py-3 bg-[#fafaf8] border-t border-[#f0f0ec] flex items-center gap-2 flex-wrap">
          {rec.status === 'new' && <>
            <button disabled={busy} onClick={() => decide('in_work')} className={`${btn} bg-[#111110] text-white hover:bg-[#2a2a28]`}>В работу</button>
            <button disabled={busy} onClick={() => decide('archived')} className={`${btn} border border-[#d8d8d4] text-[#4a4a46] hover:bg-[#f0f0ec]`}>В архив</button>
            <button disabled={busy} onClick={() => decide('removed')} className={`${btn} text-[#9a9a95] hover:text-red-600 ml-auto`}>Убрать — не актуально</button>
          </>}
          {rec.status === 'in_work' && <>
            <button disabled={busy} onClick={() => setClosing(true)} className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}>Сделано</button>
            <button disabled={busy} onClick={() => decide('archived')} className={`${btn} border border-[#d8d8d4] text-[#4a4a46] hover:bg-[#f0f0ec]`}>В архив</button>
          </>}
          {rec.status === 'archived' && <>
            <button disabled={busy} onClick={() => decide('in_work')} className={`${btn} bg-[#111110] text-white hover:bg-[#2a2a28]`}>Вернуть в работу</button>
            <button disabled={busy} onClick={() => decide('removed')} className={`${btn} text-[#9a9a95] hover:text-red-600 ml-auto`}>Убрать</button>
          </>}
          {rec.status === 'done' && <span className="text-[11px] text-emerald-700 font-medium">✓ Сделано</span>}
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AIControlCenter() {
  const [tab, setTab] = useState<Tab>('overview')

  // ── Health check state ──────────────────────────────────────────────────────
  const [checks, setChecks]       = useState<CheckResult[]>(INITIAL_CHECKS.map(c => ({ ...c, status: 'pending' as CheckStatus })))
  const [hcRunning, setHcRunning] = useState(false)
  const [hcDone, setHcDone]       = useState(false)
  const [hcStarted, setHcStarted] = useState<Date | null>(null)
  const [fixStates, setFixStates] = useState<Record<string, { status: FixStatus; message?: string }>>({})
  const [ignoredIds, setIgnoredIds] = useState<Set<string>>(new Set())
  const [fixLog, setFixLog]       = useState<FixLogEntry[]>([])
  const [canFix, setCanFix]       = useState(false)
  const [userEmail, setUserEmail] = useState('')

  // ── AI analysis state ───────────────────────────────────────────────────────
  const [perspective, setPerspective]  = useState('ceo')
  const [aiLoading, setAiLoading]      = useState(false)
  const [aiError, setAiError]          = useState('')
  const [aiRecs, setAiRecs]            = useState<Recommendation[]>([])
  const [recsError, setRecsError]      = useState('')

  // ── Recommendations state ───────────────────────────────────────────────────
  const [recs, setRecs]               = useState<Recommendation[]>([])
  const [recFilter, setRecFilter]     = useState<RecStatus>('new')

  // ── Всё ли работает (живые проверки) ─────────────────────────────────────────
  const [live, setLive]               = useState<LiveHealth>(null)
  const [liveLoading, setLiveLoading] = useState(false)
  const loadLive = useCallback(async () => {
    setLiveLoading(true)
    try {
      const r = await fetch('/api/admin/live-health')
      const j = await r.json().catch(() => null)
      setLive(r.ok && j ? j : { error: j?.error ?? `ошибка ${r.status}` })
    } catch (e) {
      setLive({ error: e instanceof Error ? e.message : String(e) })
    } finally { setLiveLoading(false) }
  }, [])

  // ── Init ────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const sb = createClient()
    sb.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      setUserEmail(user.email ?? '')
      sb.from('users').select('role').eq('id', user.id).single().then(({ data }) => {
        if (data?.role === 'admin' || data?.role === 'ceo') setCanFix(true)
      })
    })
    // Load fix log — DB first, localStorage fallback
    fetch('/api/admin/health-fix-log')
      .then(r => r.ok ? r.json() : null)
      .then(rows => {
        if (rows && rows.length > 0) {
          setFixLog(rows.map((r: Record<string, string>) => ({
            id: r.id, ts: r.applied_at, userEmail: r.applied_by ?? '',
            checkName: r.fix_name, action: r.fix_name,
            result: 'success' as const, before: r.before ?? '', after: '',
          })))
        } else {
          try { const raw = localStorage.getItem(LOG_KEY); if (raw) setFixLog(JSON.parse(raw)) } catch {}
        }
      })
      .catch(() => { try { const raw = localStorage.getItem(LOG_KEY); if (raw) setFixLog(JSON.parse(raw)) } catch {} })

    // Рекомендации — только из базы: localStorage одного браузера и был причиной,
    // почему они «не сохранялись».
    fetch('/api/admin/ai-recommendations')
      .then(async r => {
        const body = await r.json().catch(() => null)
        if (!r.ok) { setRecsError(body?.error ?? 'Не удалось загрузить рекомендации'); return }
        setRecs(body ?? [])
      })
      .catch(() => setRecsError('Не удалось загрузить рекомендации'))

    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadLive()
  }, [loadLive])

  // ── Health check ────────────────────────────────────────────────────────────

  function updateCheck(id: string, partial: Partial<CheckResult>) {
    setChecks(prev => prev.map(c => c.id === id ? { ...c, ...partial } : c))
  }

  async function startHealthCheck() {
    setChecks(INITIAL_CHECKS.map(c => ({ ...c, status: 'pending' as CheckStatus })))
    setHcRunning(true); setHcDone(false); setHcStarted(new Date())
    setFixStates({}); setIgnoredIds(new Set())
    await runChecks(updateCheck)
    setHcRunning(false); setHcDone(true)
  }

  async function handleFix(checkId: string, fixId: string, checkName: string, before: string) {
    setFixStates(prev => ({ ...prev, [checkId]: { status: 'fixing', message: 'Выполняется...' } }))
    try {
      const res  = await fetch('/api/admin/health-check/fix', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fixId }) })
      const json = await res.json()
      if (!res.ok || json.error) {
        const msg = json.error ?? json.message ?? 'Ошибка'
        setFixStates(prev => ({ ...prev, [checkId]: { status: 'failed', message: msg } }))
        appendFixLog({ checkName, action: FIX_ACTION_LABEL[fixId] ?? fixId, result: 'fail', before, after: msg })
        return
      }
      const after = json.message ?? 'Исправлено'
      setFixStates(prev => ({ ...prev, [checkId]: { status: 'fixed', message: after } }))
      appendFixLog({ checkName, action: FIX_ACTION_LABEL[fixId] ?? fixId, result: 'success', before, after })
    } catch (e) {
      const msg = String(e)
      setFixStates(prev => ({ ...prev, [checkId]: { status: 'failed', message: msg } }))
      appendFixLog({ checkName, action: FIX_ACTION_LABEL[fixId] ?? fixId, result: 'fail', before, after: msg })
    }
  }

  function appendFixLog(p: { checkName: string; action: string; result: 'success' | 'fail'; before: string; after: string }) {
    const entry: FixLogEntry = { id: Date.now().toString(), ts: new Date().toISOString(), userEmail, ...p }
    setFixLog(prev => { const u = [...prev, entry]; try { localStorage.setItem(LOG_KEY, JSON.stringify(u)) } catch {} return u })
    fetch('/api/admin/health-fix-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fix_id: entry.id, fix_name: entry.action, before: entry.before, applied_by: null }),
    }).catch(() => {})
  }

  // ── AI Analysis ─────────────────────────────────────────────────────────────

  async function runAIAnalysis() {
    setAiLoading(true); setAiError('')
    try {
      const res  = await fetch('/api/admin/ai-recommendations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ perspective }) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || json.error) { setAiError(json.error ?? 'Не удалось получить рекомендации'); return }
      const created = (json.created ?? []) as Recommendation[]
      setAiRecs(created)
      setRecs(prev => [...created, ...prev])
      if (!created.length) setAiError('Новых рекомендаций нет: всё, что AI предложил, уже было в списке')
    } catch (e) { setAiError(String(e)) }
    finally { setAiLoading(false) }
  }

  // ── Recommendations management ───────────────────────────────────────────────

  async function decideRec(id: string, status: RecStatus, resultNote?: string) {
    const res = await fetch('/api/admin/ai-recommendations', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status, result_note: resultNote }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || json.error) { setRecsError(json.error ?? 'Решение не сохранилось'); return }
    setRecsError('')
    setRecs(prev => prev.map(r => r.id === id ? json as Recommendation : r))
  }

  // ── Derived ─────────────────────────────────────────────────────────────────

  const grouped = INITIAL_CHECKS.reduce<Record<string, string[]>>((acc, c) => {
    if (!acc[c.module]) acc[c.module] = []
    acc[c.module].push(c.id)
    return acc
  }, {})
  const byId = Object.fromEntries(checks.map(c => [c.id, c]))

  const okCount    = checks.filter(c => c.status === 'ok').length
  const warnCount  = checks.filter(c => c.status === 'warn').length
  const errorCount = checks.filter(c => c.status === 'error').length
  const fixedCount = Object.values(fixStates).filter(s => s.status === 'fixed').length
  const overallStatus = errorCount > 0 ? 'error' : warnCount > 0 ? 'warn' : hcDone ? 'ok' : 'pending'

  const issues = checks.filter(c => (c.status === 'warn' || c.status === 'error') && !ignoredIds.has(c.id))
    .sort((a, b) => {
      const o: Record<CheckStatus, number> = { error: 0, warn: 1, ok: 2, running: 3, pending: 4 }
      return o[a.status] - o[b.status]
    })

  const PRIORITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
  const recCount = (st: RecStatus) => recs.filter(r => r.status === st).length
  const filteredRecs = recs.filter(r => r.status === recFilter)
    .sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9) || b.created_at.localeCompare(a.created_at))
  const decisions = recs.filter(r => r.decided_at).sort((a, b) => (b.decided_at ?? '').localeCompare(a.decided_at ?? ''))

  const TABS: { id: Tab; label: string; badge?: number }[] = [
    { id: 'overview',        label: 'Обзор' },
    { id: 'health',          label: 'Справочники', badge: errorCount + warnCount > 0 ? errorCount + warnCount : undefined },
    { id: 'ai',              label: 'AI Анализ' },
    { id: 'recommendations', label: 'Рекомендации', badge: recCount('new') || undefined },
    { id: 'log',             label: 'Журнал' },
  ]

  const liveSum = liveSummary(live)

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">

      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-semibold text-violet-600 bg-violet-50 px-2 py-0.5 rounded-full uppercase tracking-wide">Owner Center</span>
          </div>
          <h1 className="text-[22px] font-bold text-[#111110] tracking-tight">AI Control Center</h1>
          <p className="text-[13px] text-[#8a8a85] mt-1">
            Единый центр управления, диагностики и развития платформы MGlass
          </p>
        </div>
        {liveSum && (
          <button onClick={() => setTab('overview')} className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-[12px] font-semibold ${
            liveSum.fail ? 'bg-red-50 border-red-200 text-red-700' :
            liveSum.warn ? 'bg-amber-50 border-amber-200 text-amber-700' :
                           'bg-emerald-50 border-emerald-200 text-emerald-700'
          }`}>
            <span className="text-[16px]">{liveSum.fail ? '✕' : liveSum.warn ? '⚠' : '✓'}</span>
            {liveSum.fail ? `Не работает: ${liveSum.fail}` : liveSum.warn ? `Требует внимания: ${liveSum.warn}` : 'Всё работает'}
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-[#f4f3f1] rounded-xl p-1">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 py-2 px-2 rounded-lg text-[12px] font-semibold transition-all flex items-center justify-center gap-1.5 ${
              tab === t.id
                ? 'bg-white text-[#111110] shadow-sm'
                : 'text-[#8a8a85] hover:text-[#4a4a46]'
            }`}
          >
            {t.label}
            {t.badge ? (
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${tab === t.id ? 'bg-red-100 text-red-600' : 'bg-red-100 text-red-500'}`}>
                {t.badge}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {/* ══════════════════════ OVERVIEW ══════════════════════ */}
      {tab === 'overview' && (
        <div className="space-y-6">
          <LiveHealthPanel health={live} onRefresh={() => void loadLive()} loading={liveLoading} />

          {/* Status + quick actions */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-[#e8e8e5] p-5">
              <p className="text-[12px] font-semibold text-[#4a4a46] mb-3">Справочники и расчёты</p>
              {!hcDone ? (
                <p className="text-[12px] text-[#9a9a95]">Цены стекла, услуги, LED, роли пользователей — запустите проверку справочников</p>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" /><span className="text-[12px] text-[#3a3a38]">{okCount} проверок успешно</span></div>
                  {warnCount > 0 && <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" /><span className="text-[12px] text-[#3a3a38]">{warnCount} предупреждений</span></div>}
                  {errorCount > 0 && <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" /><span className="text-[12px] text-[#3a3a38]">{errorCount} ошибок</span></div>}
                  {fixedCount > 0 && <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-blue-400 flex-shrink-0" /><span className="text-[12px] text-[#3a3a38]">{fixedCount} исправлено</span></div>}
                </div>
              )}
            </div>
            <div className="bg-white rounded-xl border border-[#e8e8e5] p-5">
              <p className="text-[12px] font-semibold text-[#4a4a46] mb-3">Быстрые действия</p>
              <div className="space-y-2">
                <button onClick={() => { setTab('health'); startHealthCheck() }} className="w-full h-9 rounded-lg bg-[#111110] text-white text-[12px] font-semibold hover:bg-[#27272a] transition-colors">
                  Проверить справочники
                </button>
                <button onClick={() => setTab('ai')} className="w-full h-9 rounded-lg border border-[#d8d8d4] text-[#4a4a46] text-[12px] font-semibold hover:bg-[#f0f0ec] transition-colors">
                  Получить рекомендации →
                </button>
                <button onClick={() => setTab('recommendations')} className="w-full h-9 rounded-lg border border-[#d8d8d4] text-[#4a4a46] text-[12px] font-semibold hover:bg-[#f0f0ec] transition-colors">
                  Ждут решения ({recCount('new')}) →
                </button>
              </div>
            </div>
          </div>

          {/* Recommendations preview */}
          {recs.filter(r => r.status === 'new' && r.priority === 'critical').length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4">
              <p className="text-[12px] font-semibold text-red-700 mb-2">Критичные рекомендации</p>
              {recs.filter(r => r.status === 'new' && r.priority === 'critical').slice(0, 2).map(r => (
                <div key={r.id} className="text-[12px] text-red-700 flex items-start gap-2">
                  <span>•</span><span>{r.title}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════ HEALTH CHECK ══════════════════════ */}
      {tab === 'health' && (
        <div>
          {/* Summary */}
          {hcDone && (
            <div className={`rounded-xl border px-5 py-4 mb-6 flex items-center gap-4 ${
              overallStatus === 'ok' ? 'bg-emerald-50 border-emerald-200' : overallStatus === 'warn' ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200'
            }`}>
              <div className={`text-3xl ${overallStatus === 'ok' ? 'text-emerald-500' : overallStatus === 'warn' ? 'text-amber-500' : 'text-red-500'}`}>
                {overallStatus === 'ok' ? '✓' : overallStatus === 'warn' ? '⚠' : '✕'}
              </div>
              <div className="flex-1">
                <p className={`text-[14px] font-semibold ${overallStatus === 'ok' ? 'text-emerald-800' : overallStatus === 'warn' ? 'text-amber-800' : 'text-red-800'}`}>
                  {overallStatus === 'ok' ? 'Система работает нормально' : overallStatus === 'warn' ? 'Есть предупреждения' : 'Обнаружены ошибки'}
                </p>
                <p className="text-[12px] text-[#6b6b66] mt-0.5">
                  {okCount} ОК · {warnCount} предупреждений · {errorCount} ошибок · {checks.length} проверок
                  {fixedCount > 0 && ` · ${fixedCount} исправлено`}
                  {hcStarted && ` · ${hcStarted.toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow' })}`}
                </p>
              </div>
            </div>
          )}

          <button onClick={startHealthCheck} disabled={hcRunning}
            className={`w-full h-12 rounded-xl text-[14px] font-semibold transition-colors mb-8 ${hcRunning ? 'bg-[#f0f0ec] text-[#9a9a95] cursor-not-allowed' : 'bg-[#111110] text-white hover:bg-[#27272a]'}`}>
            {hcRunning ? '⟳  Проверка...' : hcDone ? 'Запустить повторно' : 'Запустить проверку системы'}
          </button>

          {/* Issues panel */}
          {hcDone && issues.length > 0 && (
            <div className="mb-8">
              <div className="flex items-center gap-2 mb-4">
                <h2 className="text-[14px] font-semibold text-[#2a2a28]">Ошибки и предупреждения</h2>
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${errorCount > 0 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{issues.length}</span>
                {!canFix && <span className="text-[11px] text-[#9a9a95] ml-2">Автоисправление доступно только администратору</span>}
              </div>
              <div className="space-y-3">
                {issues.map(check => {
                  const meta = ISSUE_META[check.id]
                  if (!meta) return null
                  return (
                    <IssueCard key={check.id} check={check} meta={meta}
                      fixState={fixStates[check.id] ?? { status: 'idle' }}
                      canFix={canFix} onFix={handleFix}
                      onIgnore={id => setIgnoredIds(prev => new Set([...prev, id]))}
                    />
                  )
                })}
              </div>
              {fixedCount > 0 && (
                <button onClick={startHealthCheck} className="mt-4 w-full h-10 rounded-xl text-[13px] font-semibold border border-[#d8d8d4] text-[#4a4a46] hover:bg-[#f0f0ec] transition-colors">
                  Запустить проверку повторно
                </button>
              )}
            </div>
          )}

          {hcDone && issues.length === 0 && (
            <div className="mb-8 rounded-xl bg-emerald-50 border border-emerald-200 px-5 py-4 text-center">
              <p className="text-[13px] text-emerald-700 font-medium">Проблем не обнаружено — система работает нормально</p>
            </div>
          )}

          {/* Module checks */}
          <div className="space-y-4">
            {Object.entries(grouped).map(([module, ids]) => {
              const mc = ids.map(id => byId[id]).filter(Boolean)
              const badge = mc.some(c => c.status === 'running') ? 'running' : mc.some(c => c.status === 'error') ? 'error' : mc.some(c => c.status === 'warn') ? 'warn' : mc.every(c => c.status === 'ok') ? 'ok' : 'pending'
              return (
                <div key={module} className="bg-white rounded-xl border border-[#e8e8e5] overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-[#f2f2f0] bg-[#fafaf8]">
                    <span className="text-[12px] font-semibold text-[#4b4b47] uppercase tracking-wide">{module}</span>
                    <span className={`text-[11px] font-mono font-bold ${STATUS_COLOR[badge as CheckStatus]}`}>
                      {STATUS_ICON[badge as CheckStatus]} {badge === 'running' ? 'проверка...' : badge === 'ok' ? 'ок' : badge === 'warn' ? 'предупреждение' : badge === 'error' ? 'ошибка' : '—'}
                    </span>
                  </div>
                  <div className="divide-y divide-[#f5f5f3]">
                    {mc.map(c => (
                      <div key={c.id} className={`flex items-start gap-3 px-4 py-3 ${STATUS_BG[c.status]} transition-colors`}>
                        <span className={`text-[13px] font-bold mt-0.5 flex-shrink-0 ${STATUS_COLOR[c.status]}`}>{STATUS_ICON[c.status]}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[12px] font-medium text-[#2a2a28]">{c.name}</span>
                            {c.ms != null && <span className="text-[10px] text-[#c0c0bc] font-mono">{c.ms}ms</span>}
                            {fixStates[c.id]?.status === 'fixed' && <span className="text-[10px] text-emerald-600 font-semibold">✓ исправлено</span>}
                          </div>
                          {c.detail && <p className={`text-[11px] mt-0.5 ${c.status === 'error' ? 'text-red-600' : c.status === 'warn' ? 'text-amber-600' : 'text-[#6b6b66]'}`}>{c.detail}</p>}
                          {c.hint  && <p className="text-[11px] text-[#9a9a95] mt-0.5 italic">{c.hint}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ══════════════════════ AI ANALYSIS ══════════════════════ */}
      {tab === 'ai' && (
        <div className="grid grid-cols-[1fr_1.5fr] gap-6">
          {/* Left: на чём строится анализ */}
          <div className="space-y-4">
            <h2 className="text-[14px] font-semibold text-[#2a2a28]">На чём строится анализ</h2>
            {(() => {
              const ai = live && !('error' in live) ? live.checks.find(c => c.id === 'ai_anthropic') : null
              return ai && ai.status !== 'ok' ? (
                <div role="alert" className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                  <p className="text-[12px] text-red-700 font-semibold">AI сейчас не отвечает</p>
                  <p className="text-[11px] text-red-700 mt-1">{ai.detail}</p>
                  {ai.action && <p className="text-[11px] text-[#4a4a46] mt-1">→ {ai.action}</p>}
                </div>
              ) : null
            })()}
            <div className="bg-white rounded-xl border border-[#e8e8e5] p-4 space-y-2">
              <p className="text-[12px] text-[#3a3a38]">AI видит цифры, посчитанные кодом из учёта, — каждую с периодом и источником:</p>
              <ul className="text-[11px] text-[#6b6b66] list-disc pl-4 space-y-0.5">
                <li>«Продажи M-Glass»: сумма, заказы, средний чек за прошлый и позапрошлый месяц, по менеджерам;</li>
                <li>«Маржа»: маржа закрытых заказов за три месяца, сколько закрыто и сколько ждут расходов;</li>
                <li>«Показатели менеджеров»: разговоры, замеры, оплаты, деньги, разговор → замер;</li>
                <li>B2B: запущено в работу, клиенты, доля крупнейшего, просроченные отгрузки;</li>
                <li>заявки Авито-бота и расчёты за 30 дней, пробелы базы знаний, анкета стратегии, ваши прошлые решения.</li>
              </ul>
              <p className="text-[11px] text-[#6b6b66]">Рекомендация без опоры на эти цифры не сохраняется. На карточке видно, какие цифры за ней стоят; число в тексте, которого нет в данных, помечено.</p>
            </div>
            <SystemFactsEditor />
          </div>

          {/* Right: AI panel */}
          <div className="space-y-4">
            <h2 className="text-[14px] font-semibold text-[#2a2a28]">AI Анализ</h2>

            {/* Perspective selector */}
            <div className="bg-white rounded-xl border border-[#e8e8e5] p-4">
              <p className="text-[11px] font-semibold text-[#4a4a46] mb-2">Перспектива анализа</p>
              <div className="flex flex-wrap gap-2">
                {PERSPECTIVES.map(p => (
                  <button key={p.id} onClick={() => setPerspective(p.id)}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${perspective === p.id ? 'bg-[#111110] text-white' : 'bg-[#f4f3f1] text-[#4a4a46] hover:bg-[#ebebe8]'}`}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <button onClick={runAIAnalysis} disabled={aiLoading}
              className={`w-full h-12 rounded-xl text-[14px] font-semibold transition-colors ${aiLoading ? 'bg-[#f0f0ec] text-[#9a9a95] cursor-not-allowed' : 'bg-violet-600 text-white hover:bg-violet-700'}`}>
              {aiLoading ? '⟳  Анализ...' : '✦  Получить AI анализ'}
            </button>

            {aiError && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                <p className="text-[12px] text-red-700">{aiError}</p>
              </div>
            )}

            {aiRecs.length > 0 && (
              <div className="space-y-3">
                <p className="text-[12px] font-semibold text-[#4a4a46]">Получено {aiRecs.length} рекомендаций — добавлены во вкладку «Рекомендации»</p>
                {aiRecs.slice(0, 3).map(r => (
                  <div key={r.id} className="bg-white rounded-xl border border-[#e8e8e5] px-4 py-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${PRIORITY_COLOR[r.priority]}`}>{PRIORITY_LABEL[r.priority]}</span>
                      <span className="text-[10px] text-violet-600 bg-violet-50 px-2 py-0.5 rounded-full">AI</span>
                    </div>
                    <p className="text-[12px] font-semibold text-[#2a2a28]">{r.title}</p>
                    <p className="text-[11px] text-[#6a6a65] mt-1">{r.action}</p>
                  </div>
                ))}
                {aiRecs.length > 3 && (
                  <button onClick={() => setTab('recommendations')} className="w-full h-9 rounded-lg border border-[#d8d8d4] text-[12px] text-[#4a4a46] hover:bg-[#f0f0ec] transition-colors">
                    Показать все {aiRecs.length} → вкладка «Рекомендации»
                  </button>
                )}
              </div>
            )}

            {!aiLoading && aiRecs.length === 0 && (
              <div className="bg-[#f7f7f4] rounded-xl border border-[#e8e8e5] p-6 text-center">
                <p className="text-[13px] text-[#8a8a85]">Нажмите «Получить AI анализ», чтобы Claude проанализировал систему MGlass</p>
                <p className="text-[11px] text-[#b0b0aa] mt-2">Анализ учитывает данные БД, health check и бизнес-метрики</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════ RECOMMENDATIONS ══════════════════════ */}
      {tab === 'recommendations' && (
        <div>
          <div className="flex items-center gap-2 mb-6 flex-wrap">
            {([
              ['new', 'Ждут решения'], ['in_work', 'В работе'], ['done', 'Сделано'], ['archived', 'Архив'], ['removed', 'Убранные'],
            ] as [RecStatus, string][]).map(([id, label]) => (
              <button key={id} onClick={() => setRecFilter(id)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${recFilter === id ? 'bg-[#111110] text-white' : 'bg-[#f4f3f1] text-[#4a4a46] hover:bg-[#ebebe8]'}`}>
                {label} <span className="ml-1 text-[10px] opacity-60">{recCount(id)}</span>
              </button>
            ))}
            <div className="ml-auto">
              <button onClick={() => setTab('ai')} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-violet-600 text-white hover:bg-violet-700 transition-colors">
                ✦ Получить рекомендации
              </button>
            </div>
          </div>

          {recsError && <p className="mb-4 text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{recsError}</p>}

          {filteredRecs.length === 0 ? (
            <div className="bg-[#f7f7f4] rounded-xl border border-[#e8e8e5] p-10 text-center">
              <p className="text-[14px] text-[#8a8a85] mb-2">{recFilter === 'new' ? 'Всё разобрано' : 'Пусто'}</p>
              <p className="text-[12px] text-[#b0b0aa]">Новые рекомендации приходят каждый день в 9:00 по Москве, пока разобраны прошлые. Или получите их вручную во вкладке «AI Анализ».</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredRecs.map(rec => (
                <RecommendationCard key={rec.id} rec={rec} onDecide={decideRec} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════ LOG ══════════════════════ */}
      {tab === 'log' && (
        <div className="space-y-6">
          {/* Fix log */}
          {fixLog.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-[13px] font-semibold text-[#4b4b47]">Журнал исправлений</h2>
                <button onClick={() => { setFixLog([]); try { localStorage.removeItem(LOG_KEY) } catch {} fetch('/api/admin/health-fix-log', { method: 'DELETE' }).catch(() => {}) }} className="text-[11px] text-[#9a9a95] hover:text-[#5a5a55]">Очистить</button>
              </div>
              <div className="bg-white rounded-xl border border-[#e8e8e5] overflow-hidden">
                <div className="divide-y divide-[#f5f5f3]">
                  {[...fixLog].reverse().map(e => (
                    <div key={e.id} className="px-4 py-3 flex items-start gap-4">
                      <div className="flex-shrink-0 w-[72px]">
                        <p className="text-[10px] text-[#9a9a95]">{new Date(e.ts).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })}</p>
                        <p className="text-[10px] text-[#9a9a95]">{new Date(e.ts).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' })}</p>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-medium text-[#2a2a28]">{e.checkName}</p>
                        <p className="text-[11px] text-[#6a6a65] mt-0.5">{e.action}</p>
                        {e.after && <p className={`text-[11px] mt-0.5 ${e.result === 'success' ? 'text-emerald-600' : 'text-red-600'}`}>→ {e.after}</p>}
                      </div>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${e.result === 'success' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                        {e.result === 'success' ? 'Успешно' : 'Ошибка'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {decisions.length > 0 && (
            <div>
              <h2 className="text-[13px] font-semibold text-[#4b4b47] mb-3">Решения по рекомендациям</h2>
              <div className="bg-white rounded-xl border border-[#e8e8e5] overflow-hidden">
                <div className="divide-y divide-[#f5f5f3]">
                  {decisions.map(r => (
                    <div key={r.id} className="px-4 py-3 flex items-start gap-4">
                      <div className="flex-shrink-0 w-[72px]">
                        <p className="text-[10px] text-[#9a9a95]">{new Date(r.decided_at!).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })}</p>
                        <p className="text-[10px] text-[#9a9a95]">{new Date(r.decided_at!).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' })}</p>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-medium text-[#2a2a28]">{r.title}</p>
                        <p className="text-[11px] text-[#6a6a65] mt-0.5">{REC_STATUS_LABEL[r.status]}{r.decided_by ? ` · ${r.decided_by}` : ''}{r.result_note ? ` · ${r.result_note}` : ''}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {fixLog.length === 0 && decisions.length === 0 && (
            <div className="bg-[#f7f7f4] rounded-xl border border-[#e8e8e5] p-10 text-center">
              <p className="text-[13px] text-[#8a8a85]">Журнал пуст</p>
              <p className="text-[11px] text-[#b0b0aa] mt-1">Здесь появятся исправления из Health Check и решения по рекомендациям</p>
            </div>
          )}
        </div>
      )}

      {/* Legend */}
      {tab === 'health' && (
        <div className="mt-8 flex gap-4 text-[11px] text-[#9a9a95]">
          <span className="text-emerald-600 font-semibold">✓ Работает</span>
          <span className="text-amber-500 font-semibold">⚠ Предупреждение</span>
          <span className="text-red-500 font-semibold">✕ Ошибка</span>
        </div>
      )}
    </div>
  )
}
