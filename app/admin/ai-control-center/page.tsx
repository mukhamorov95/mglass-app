'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'
import {
  runChecks, INITIAL_CHECKS, ISSUE_META, STATUS_ICON, STATUS_COLOR, STATUS_BG,
  SEVERITY_LABEL, SEVERITY_COLOR, FIX_ACTION_LABEL, LOG_KEY,
  type CheckResult, type CheckStatus, type FixStatus, type IssueMeta, type FixLogEntry,
} from '@/lib/healthCheckRunner'

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = 'overview' | 'health' | 'calculators' | 'ai' | 'recommendations' | 'log'

type Recommendation = {
  id: string
  title: string
  priority: 'critical' | 'high' | 'medium' | 'low'
  category: string
  problem: string
  impact: string
  recommendation: string
  metric?: string
  status: 'pending' | 'implementing' | 'done' | 'dismissed' | 'deferred'
  source: 'ai' | 'system'
  createdAt: string
}

type CalcBreakdown = {
  materialName: string
  widthMm: number
  heightMm: number
  areaSqm: number
  costPerSqm: number
  wastePct: number
  materialCost: number
  margin: number
  basePrice: number
  ledCost: number
  installCost: number
  deliveryCost: number
  totalPrice: number
}

const REC_KEY      = 'mglass_ai_recommendations'
const IMPL_LOG_KEY = 'mglass_impl_log'

const PRIORITY_COLOR: Record<string, string> = {
  critical: 'bg-red-100 text-red-700 border border-red-200',
  high:     'bg-orange-100 text-orange-700 border border-orange-200',
  medium:   'bg-amber-100 text-amber-700 border border-amber-200',
  low:      'bg-blue-100 text-blue-700 border border-blue-200',
}
const PRIORITY_LABEL: Record<string, string> = {
  critical: 'Критично', high: 'Высокий', medium: 'Средний', low: 'Низкий',
}
const STATUS_LABEL_REC: Record<string, string> = {
  pending: 'Ожидает', implementing: 'Внедряется', done: 'Внедрено', dismissed: 'Отклонено', deferred: 'Отложено',
}

const PERSPECTIVES = [
  { id: 'ceo',       label: 'CEO / Собственник',    icon: '👑' },
  { id: 'analyst',   label: 'Системный аналитик',    icon: '🔍' },
  { id: 'product',   label: 'Product Owner',         icon: '🎯' },
  { id: 'erp',       label: 'ERP-специалист',        icon: '⚙️' },
  { id: 'marketing', label: 'Маркетолог / SEO',      icon: '📣' },
]

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

function RecommendationCard({
  rec, onStatusChange, onLog,
}: {
  rec: Recommendation
  onStatusChange: (id: string, status: Recommendation['status']) => void
  onLog: (rec: Recommendation, action: string) => void
}) {
  const isDone      = rec.status === 'done'
  const isDismissed = rec.status === 'dismissed'

  return (
    <div className={`rounded-xl border overflow-hidden transition-opacity ${isDone ? 'opacity-60' : isDismissed ? 'opacity-40' : ''}`}>
      <div className="px-5 py-3 bg-white flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${PRIORITY_COLOR[rec.priority]}`}>
              {PRIORITY_LABEL[rec.priority]}
            </span>
            <span className="text-[10px] text-[#9a9a95] bg-[#f4f3f1] px-2 py-0.5 rounded-full">{rec.category}</span>
            {rec.source === 'ai' && <span className="text-[10px] text-violet-600 bg-violet-50 px-2 py-0.5 rounded-full">AI</span>}
          </div>
          <p className="text-[13px] font-semibold text-[#1a1a18]">{rec.title}</p>
        </div>
        <span className="text-[10px] text-[#9a9a95] flex-shrink-0 mt-1">
          {STATUS_LABEL_REC[rec.status]}
        </span>
      </div>
      <div className="px-5 pb-4 bg-white space-y-2">
        <div><p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-wide mb-0.5">Проблема</p><p className="text-[12px] text-[#3a3a38]">{rec.problem}</p></div>
        <div><p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-wide mb-0.5">Влияние</p><p className="text-[12px] text-[#3a3a38]">{rec.impact}</p></div>
        <div><p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-wide mb-0.5">Рекомендация</p><p className="text-[12px] text-[#3a3a38]">{rec.recommendation}</p></div>
        {rec.metric && <div className="mt-2 rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2"><p className="text-[11px] text-emerald-700 font-medium">📈 {rec.metric}</p></div>}
      </div>
      {!isDone && !isDismissed && (
        <div className="px-5 py-3 bg-[#fafaf8] border-t border-[#f0f0ec] flex items-center gap-2">
          <button
            onClick={() => { onStatusChange(rec.id, 'done'); onLog(rec, 'Отмечено внедрённым') }}
            className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
          >
            ✓ Внедрить
          </button>
          <button
            onClick={() => { onStatusChange(rec.id, 'deferred'); onLog(rec, 'Отложено') }}
            className="px-3 py-1.5 rounded-lg text-[11px] border border-[#d8d8d4] text-[#4a4a46] hover:bg-[#f0f0ec] transition-colors"
          >
            Отложить
          </button>
          <button
            onClick={() => { onStatusChange(rec.id, 'dismissed'); onLog(rec, 'Отклонено') }}
            className="px-2 py-1.5 text-[11px] text-[#9a9a95] hover:text-[#5a5a55] transition-colors ml-auto"
          >
            Отклонить
          </button>
        </div>
      )}
      {isDone && (
        <div className="px-5 py-2.5 bg-emerald-50 border-t border-emerald-100">
          <p className="text-[11px] text-emerald-700 font-medium">✓ Внедрено</p>
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

  // ── Calculator state ────────────────────────────────────────────────────────
  const [calcData, setCalcData]   = useState<CalcBreakdown | null>(null)
  const [calcLoading, setCalcLoading] = useState(false)

  // ── AI analysis state ───────────────────────────────────────────────────────
  const [perspective, setPerspective]  = useState('ceo')
  const [aiLoading, setAiLoading]      = useState(false)
  const [aiError, setAiError]          = useState('')
  const [aiRecs, setAiRecs]            = useState<Recommendation[]>([])

  // ── Recommendations state ───────────────────────────────────────────────────
  const [recs, setRecs]               = useState<Recommendation[]>([])
  const [recFilter, setRecFilter]     = useState<string>('all')
  const [implLog, setImplLog]         = useState<{ ts: string; title: string; action: string }[]>([])

  // ── Overview metrics ────────────────────────────────────────────────────────
  const [metrics, setMetrics]         = useState<{ calcs: number; orders: number; users: number } | null>(null)

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

    // Load recommendations — DB first, localStorage fallback
    fetch('/api/admin/ai-recommendations')
      .then(r => r.ok ? r.json() : null)
      .then(rows => {
        if (rows && rows.length > 0) {
          setRecs(rows.map((r: Record<string, string>) => ({
            id: r.id, title: r.title,
            priority: r.priority as Recommendation['priority'],
            category: r.category ?? '',
            problem: r.description ?? '', impact: '', recommendation: r.title,
            status: r.status as Recommendation['status'],
            source: (r.source ?? 'ai') as Recommendation['source'],
            createdAt: r.created_at,
          })))
        } else {
          try { const raw = localStorage.getItem(REC_KEY); if (raw) setRecs(JSON.parse(raw)) } catch {}
        }
      })
      .catch(() => { try { const raw = localStorage.getItem(REC_KEY); if (raw) setRecs(JSON.parse(raw)) } catch {} })

    try { const rawLog = localStorage.getItem(IMPL_LOG_KEY); if (rawLog) setImplLog(JSON.parse(rawLog)) } catch {}

    // Load quick metrics
    const fetchMetrics = async () => {
      const [c, o, u] = await Promise.all([
        sb.from('calculations').select('*', { count: 'exact', head: true }),
        sb.from('orders').select('*', { count: 'exact', head: true }),
        sb.from('users').select('*', { count: 'exact', head: true }),
      ])
      setMetrics({ calcs: c.count ?? 0, orders: o.count ?? 0, users: u.count ?? 0 })
    }
    fetchMetrics()
  }, [])

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

  // ── Calculator ──────────────────────────────────────────────────────────────

  const loadCalcExample = useCallback(async () => {
    setCalcLoading(true)
    try {
      const sb = createClient()
      const [glassRes, stratRes, servRes, ledRes] = await Promise.all([
        sb.from('glass_price_matrix').select('name, price').eq('price_type', 'cost').eq('category', 'mirror').limit(1).single(),
        fetch('/api/admin/owner-strategy').then(r => r.json()).catch(() => ({ target_margin: 40 })),
        sb.from('services').select('name, price').eq('active', true),
        sb.from('mirror_lighting_components').select('cost_price, unit').eq('component_type', 'led_strip').eq('active', true).limit(1).single(),
      ])

      const glass    = glassRes.data
      const margin   = Number(stratRes?.target_margin ?? 40)
      const services = servRes.data ?? []
      const led      = ledRes.data

      if (!glass) return

      const W = 900, H = 500
      const areaSqm   = (W * H) / 1_000_000
      const wastePct  = 10
      const areaWithWaste = areaSqm * (1 + wastePct / 100)
      const matCost   = Math.round(areaWithWaste * glass.price)
      const basePrice = Math.round(matCost / (1 - margin / 100))

      const perimeter  = 2 * (W + H) / 1000
      const ledCost    = led ? Math.round(perimeter * led.cost_price) : 0

      const installSvc  = services.find(s => s.name?.toLowerCase().includes('монтаж'))
      const deliverySvc = services.find(s => s.name?.toLowerCase().includes('доставка'))
      const installCost = installSvc ? Math.round(installSvc.price) : 2500
      const deliveryCost = deliverySvc ? Math.round(deliverySvc.price) : 1200

      setCalcData({
        materialName: glass.name, widthMm: W, heightMm: H, areaSqm,
        costPerSqm: glass.price, wastePct, materialCost: matCost,
        margin, basePrice, ledCost, installCost, deliveryCost,
        totalPrice: basePrice + ledCost + installCost + deliveryCost,
      })
    } catch {}
    setCalcLoading(false)
  }, [])

  useEffect(() => { if (tab === 'calculators') loadCalcExample() }, [tab, loadCalcExample])

  // ── AI Analysis ─────────────────────────────────────────────────────────────

  async function runAIAnalysis() {
    setAiLoading(true); setAiError('')
    const healthSummary = hcDone ? {
      ok:    checks.filter(c => c.status === 'ok').length,
      warn:  checks.filter(c => c.status === 'warn').length,
      error: checks.filter(c => c.status === 'error').length,
      issues: checks.filter(c => c.status !== 'ok' && c.status !== 'pending').map(c => ({ id: c.id, status: c.status, detail: c.detail })),
    } : null

    try {
      const res  = await fetch('/api/admin/ai-control-center/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ perspective, healthSummary }) })
      const json = await res.json()
      if (json.error) { setAiError(json.error); return }

      const newRecs: Recommendation[] = (json.recommendations ?? []).map((r: Omit<Recommendation, 'id' | 'status' | 'source' | 'createdAt'>) => ({
        ...r,
        id: `ai_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        status: 'pending' as const,
        source: 'ai' as const,
        createdAt: new Date().toISOString(),
      }))
      setAiRecs(newRecs)

      // Merge into main recommendations (avoid duplicates by title)
      setRecs(prev => {
        const existingTitles = new Set(prev.map(r => r.title))
        const toAdd = newRecs.filter(r => !existingTitles.has(r.title))
        const merged = [...prev, ...toAdd]
        try { localStorage.setItem(REC_KEY, JSON.stringify(merged)) } catch {}
        if (toAdd.length > 0) {
          fetch('/api/admin/ai-recommendations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(toAdd.map(r => ({
              id: r.id, title: r.title, description: r.problem || null,
              priority: r.priority, category: r.category || null,
              status: r.status, source: r.source,
            }))),
          }).catch(() => {})
        }
        return merged
      })
    } catch (e) { setAiError(String(e)) }
    setAiLoading(false)
  }

  // ── Recommendations management ───────────────────────────────────────────────

  function updateRecStatus(id: string, status: Recommendation['status']) {
    setRecs(prev => {
      const updated = prev.map(r => r.id === id ? { ...r, status } : r)
      try { localStorage.setItem(REC_KEY, JSON.stringify(updated)) } catch {}
      const rec = updated.find(r => r.id === id)
      if (rec) {
        fetch('/api/admin/ai-recommendations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify([{
            id: rec.id, title: rec.title, description: rec.problem || null,
            priority: rec.priority, category: rec.category || null,
            status: rec.status, source: rec.source,
          }]),
        }).catch(() => {})
      }
      return updated
    })
  }

  function addImplLog(rec: Recommendation, action: string) {
    const entry = { ts: new Date().toISOString(), title: rec.title, action }
    setImplLog(prev => { const u = [entry, ...prev]; try { localStorage.setItem(IMPL_LOG_KEY, JSON.stringify(u)) } catch {} return u })
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

  const filteredRecs = recs.filter(r => recFilter === 'all' || r.priority === recFilter || r.status === recFilter)

  const TABS: { id: Tab; label: string; badge?: number }[] = [
    { id: 'overview',        label: 'Обзор' },
    { id: 'health',          label: 'Health Check', badge: errorCount + warnCount > 0 ? errorCount + warnCount : undefined },
    { id: 'calculators',     label: 'Калькуляторы' },
    { id: 'ai',              label: 'AI Анализ' },
    { id: 'recommendations', label: 'Рекомендации', badge: recs.filter(r => r.status === 'pending').length || undefined },
    { id: 'log',             label: 'Журнал' },
  ]

  const fmt = (n: number) => n.toLocaleString('ru-RU')

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
        {hcDone && (
          <div className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-[12px] font-semibold ${
            overallStatus === 'ok'   ? 'bg-emerald-50 border-emerald-200 text-emerald-700' :
            overallStatus === 'warn' ? 'bg-amber-50 border-amber-200 text-amber-700' :
                                       'bg-red-50 border-red-200 text-red-700'
          }`}>
            <span className="text-[16px]">{overallStatus === 'ok' ? '✓' : overallStatus === 'warn' ? '⚠' : '✕'}</span>
            {overallStatus === 'ok' ? 'Система OK' : overallStatus === 'warn' ? `${warnCount} предупреждений` : `${errorCount} ошибок`}
          </div>
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
          {/* Metric cards */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Расчётов в системе', value: metrics ? fmt(metrics.calcs) : '…', icon: '📋', color: 'border-blue-100' },
              { label: 'Заказов в системе',  value: metrics ? fmt(metrics.orders) : '…', icon: '📦', color: 'border-emerald-100' },
              { label: 'Пользователей',       value: metrics ? fmt(metrics.users) : '…', icon: '👥', color: 'border-purple-100' },
            ].map(m => (
              <div key={m.label} className={`bg-white rounded-xl border ${m.color} px-5 py-4`}>
                <p className="text-[24px] mb-1">{m.icon}</p>
                <p className="text-[22px] font-bold text-[#111110]">{m.value}</p>
                <p className="text-[11px] text-[#8a8a85] mt-0.5">{m.label}</p>
              </div>
            ))}
          </div>

          {/* Status + quick actions */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-[#e8e8e5] p-5">
              <p className="text-[12px] font-semibold text-[#4a4a46] mb-3">Статус системы</p>
              {!hcDone ? (
                <p className="text-[12px] text-[#9a9a95]">Запустите проверку, чтобы увидеть статус</p>
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
                  Запустить Health Check
                </button>
                <button onClick={() => setTab('ai')} className="w-full h-9 rounded-lg border border-[#d8d8d4] text-[#4a4a46] text-[12px] font-semibold hover:bg-[#f0f0ec] transition-colors">
                  Получить AI анализ →
                </button>
                <button onClick={() => setTab('recommendations')} className="w-full h-9 rounded-lg border border-[#d8d8d4] text-[#4a4a46] text-[12px] font-semibold hover:bg-[#f0f0ec] transition-colors">
                  Рекомендации ({recs.filter(r => r.status === 'pending').length}) →
                </button>
              </div>
            </div>
          </div>

          {/* Recommendations preview */}
          {recs.filter(r => r.status === 'pending' && r.priority === 'critical').length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4">
              <p className="text-[12px] font-semibold text-red-700 mb-2">Критичные рекомендации</p>
              {recs.filter(r => r.status === 'pending' && r.priority === 'critical').slice(0, 2).map(r => (
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
                  {hcStarted && ` · ${hcStarted.toLocaleTimeString('ru-RU')}`}
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

      {/* ══════════════════════ CALCULATORS ══════════════════════ */}
      {tab === 'calculators' && (
        <div className="grid grid-cols-2 gap-6">
          {/* Left: Example calculation */}
          <div className="space-y-4">
            <h2 className="text-[14px] font-semibold text-[#2a2a28]">Пример расчёта</h2>
            {calcLoading ? (
              <div className="bg-white rounded-xl border border-[#e8e8e5] p-8 text-center">
                <p className="text-[13px] text-[#9a9a95]">Загрузка данных...</p>
              </div>
            ) : calcData ? (
              <div className="bg-white rounded-xl border border-[#e8e8e5] overflow-hidden">
                <div className="bg-[#fafaf8] px-5 py-3 border-b border-[#f0f0ec]">
                  <p className="text-[13px] font-semibold text-[#2a2a28]">Зеркало {calcData.widthMm}×{calcData.heightMm} мм</p>
                  <p className="text-[11px] text-[#8a8a85]">{calcData.materialName}</p>
                </div>
                <div className="divide-y divide-[#f5f5f3]">
                  {[
                    { label: 'Площадь', value: `${calcData.areaSqm.toFixed(3)} м²` },
                    { label: `Цена материала (себест.)`, value: `${fmt(calcData.costPerSqm)} ₽/м²` },
                    { label: `Потери +${calcData.wastePct}%`, value: `+${fmt(Math.round(calcData.materialCost - calcData.areaSqm * calcData.costPerSqm))} ₽` },
                    { label: 'Себестоимость материала', value: `${fmt(calcData.materialCost)} ₽`, bold: true },
                    { label: `Маржа ${calcData.margin}%`, value: `+${fmt(calcData.basePrice - calcData.materialCost)} ₽` },
                    { label: 'Цена зеркала', value: `${fmt(calcData.basePrice)} ₽`, bold: true },
                    ...(calcData.ledCost > 0 ? [{ label: 'Подсветка (LED)', value: `+${fmt(calcData.ledCost)} ₽` }] : []),
                    { label: 'Монтаж', value: `+${fmt(calcData.installCost)} ₽` },
                    { label: 'Доставка', value: `+${fmt(calcData.deliveryCost)} ₽` },
                  ].map((row, i) => (
                    <div key={i} className={`flex items-center justify-between px-5 py-3 ${row.bold ? 'bg-[#fafaf8]' : ''}`}>
                      <span className={`text-[12px] ${row.bold ? 'font-semibold text-[#2a2a28]' : 'text-[#5a5a55]'}`}>{row.label}</span>
                      <span className={`text-[12px] font-mono ${row.bold ? 'font-semibold text-[#111110]' : 'text-[#4a4a46]'}`}>{row.value}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between px-5 py-4 bg-[#111110]">
                    <span className="text-[13px] font-bold text-white">Итого клиенту</span>
                    <span className="text-[16px] font-bold text-white font-mono">{fmt(calcData.totalPrice)} ₽</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-[#e8e8e5] p-8 text-center">
                <p className="text-[12px] text-[#9a9a95]">Нет данных в glass_price_matrix</p>
              </div>
            )}
          </div>

          {/* Right: Formula breakdown */}
          <div className="space-y-4">
            <h2 className="text-[14px] font-semibold text-[#2a2a28]">Формула расчёта</h2>
            <div className="space-y-3">
              {[
                {
                  step: '1', title: 'Площадь с потерями',
                  formula: 'S = (W × H / 1 000 000) × (1 + waste%)',
                  note: 'waste — процент потерь при раскрое (обычно 5–15%)',
                },
                {
                  step: '2', title: 'Себестоимость материала',
                  formula: 'cost = S × price_per_m² (из glass_price_matrix)',
                  note: 'price_type = "cost", category = "mirror" или "glass"',
                },
                {
                  step: '3', title: 'Цена с маржой',
                  formula: 'price = cost ÷ (1 - margin / 100)',
                  note: 'margin — целевая маржа из owner-strategy (target_margin%)',
                },
                {
                  step: '4', title: 'Дополнения',
                  formula: 'total = price + led + install + delivery',
                  note: 'LED — периметр × цена LED-ленты; услуги — из таблицы services',
                },
              ].map(s => (
                <div key={s.step} className="bg-white rounded-xl border border-[#e8e8e5] px-5 py-4">
                  <div className="flex items-start gap-3">
                    <span className="w-6 h-6 rounded-full bg-[#111110] text-white text-[11px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{s.step}</span>
                    <div>
                      <p className="text-[12px] font-semibold text-[#2a2a28] mb-1">{s.title}</p>
                      <code className="text-[11px] text-violet-700 bg-violet-50 px-2 py-1 rounded font-mono block mb-1">{s.formula}</code>
                      <p className="text-[11px] text-[#8a8a85]">{s.note}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="bg-white rounded-xl border border-[#e8e8e5] px-5 py-4">
              <p className="text-[12px] font-semibold text-[#4a4a46] mb-3">Задействованные таблицы</p>
              {[
                ['glass_price_matrix', 'Цены на стекло/зеркало'],
                ['financial_settings', 'Финансовые параметры'],
                ['services',           'Монтаж, доставка'],
                ['mirror_lighting_components', 'LED, каркасы, БП'],
                ['facet_prices',       'Фацетная обработка'],
              ].map(([table, desc]) => (
                <div key={table} className="flex items-center justify-between py-1.5 border-b border-[#f5f5f3] last:border-0">
                  <code className="text-[11px] text-blue-600 font-mono">{table}</code>
                  <span className="text-[11px] text-[#8a8a85]">{desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════ AI ANALYSIS ══════════════════════ */}
      {tab === 'ai' && (
        <div className="grid grid-cols-[1fr_1.5fr] gap-6">
          {/* Left: context */}
          <div className="space-y-4">
            <h2 className="text-[14px] font-semibold text-[#2a2a28]">Контекст системы</h2>
            <div className="bg-white rounded-xl border border-[#e8e8e5] p-4 space-y-3">
              {metrics && (
                <>
                  <div className="flex justify-between items-center py-1.5 border-b border-[#f5f5f3]">
                    <span className="text-[11px] text-[#8a8a85]">Расчётов в системе</span>
                    <span className="text-[12px] font-semibold text-[#2a2a28]">{fmt(metrics.calcs)}</span>
                  </div>
                  <div className="flex justify-between items-center py-1.5 border-b border-[#f5f5f3]">
                    <span className="text-[11px] text-[#8a8a85]">Заказов</span>
                    <span className="text-[12px] font-semibold text-[#2a2a28]">{fmt(metrics.orders)}</span>
                  </div>
                  <div className="flex justify-between items-center py-1.5">
                    <span className="text-[11px] text-[#8a8a85]">Пользователей</span>
                    <span className="text-[12px] font-semibold text-[#2a2a28]">{fmt(metrics.users)}</span>
                  </div>
                </>
              )}
            </div>
            {hcDone && (
              <div className="bg-white rounded-xl border border-[#e8e8e5] p-4 space-y-2">
                <p className="text-[11px] font-semibold text-[#4a4a46] mb-2">Последний Health Check</p>
                <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-emerald-500" /><span className="text-[11px] text-[#3a3a38]">{okCount} ок</span></div>
                {warnCount > 0 && <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-amber-400" /><span className="text-[11px] text-[#3a3a38]">{warnCount} предупреждений</span></div>}
                {errorCount > 0 && <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-red-500" /><span className="text-[11px] text-[#3a3a38]">{errorCount} ошибок</span></div>}
              </div>
            )}
            {!hcDone && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                <p className="text-[11px] text-amber-700">Запустите Health Check, чтобы передать AI данные о проблемах системы</p>
              </div>
            )}
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
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${perspective === p.id ? 'bg-[#111110] text-white' : 'bg-[#f4f3f1] text-[#4a4a46] hover:bg-[#ebebе8]'}`}>
                    {p.icon} {p.label}
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
                    <p className="text-[11px] text-[#6a6a65] mt-1">{r.recommendation}</p>
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
          {/* Filter bar */}
          <div className="flex items-center gap-2 mb-6 flex-wrap">
            {[
              { id: 'all',       label: 'Все' },
              { id: 'critical',  label: 'Критично' },
              { id: 'high',      label: 'Высокий' },
              { id: 'medium',    label: 'Средний' },
              { id: 'low',       label: 'Низкий' },
              { id: 'pending',   label: 'Ожидают' },
              { id: 'done',      label: 'Внедрено' },
              { id: 'dismissed', label: 'Отклонено' },
            ].map(f => (
              <button key={f.id} onClick={() => setRecFilter(f.id)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${recFilter === f.id ? 'bg-[#111110] text-white' : 'bg-[#f4f3f1] text-[#4a4a46] hover:bg-[#ebebе8]'}`}>
                {f.label}
                {f.id === 'all' && recs.length > 0 && <span className="ml-1 text-[10px] opacity-60">{recs.length}</span>}
              </button>
            ))}
            <div className="ml-auto">
              <button onClick={() => setTab('ai')} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-violet-600 text-white hover:bg-violet-700 transition-colors">
                ✦ Получить AI рекомендации
              </button>
            </div>
          </div>

          {filteredRecs.length === 0 ? (
            <div className="bg-[#f7f7f4] rounded-xl border border-[#e8e8e5] p-10 text-center">
              <p className="text-[14px] text-[#8a8a85] mb-2">Нет рекомендаций</p>
              <p className="text-[12px] text-[#b0b0aa]">Запустите AI анализ во вкладке «AI Анализ»</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredRecs.map(rec => (
                <RecommendationCard key={rec.id} rec={rec} onStatusChange={updateRecStatus} onLog={addImplLog} />
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
                        <p className="text-[10px] text-[#9a9a95]">{new Date(e.ts).toLocaleDateString('ru-RU')}</p>
                        <p className="text-[10px] text-[#9a9a95]">{new Date(e.ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</p>
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

          {/* Implementation log */}
          {implLog.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-[13px] font-semibold text-[#4b4b47]">Журнал рекомендаций</h2>
                <button onClick={() => { setImplLog([]); try { localStorage.removeItem(IMPL_LOG_KEY) } catch {} }} className="text-[11px] text-[#9a9a95] hover:text-[#5a5a55]">Очистить</button>
              </div>
              <div className="bg-white rounded-xl border border-[#e8e8e5] overflow-hidden">
                <div className="divide-y divide-[#f5f5f3]">
                  {implLog.map((e, i) => (
                    <div key={i} className="px-4 py-3 flex items-start gap-4">
                      <div className="flex-shrink-0 w-[72px]">
                        <p className="text-[10px] text-[#9a9a95]">{new Date(e.ts).toLocaleDateString('ru-RU')}</p>
                        <p className="text-[10px] text-[#9a9a95]">{new Date(e.ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</p>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-medium text-[#2a2a28]">{e.title}</p>
                        <p className="text-[11px] text-[#6a6a65] mt-0.5">{e.action}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {fixLog.length === 0 && implLog.length === 0 && (
            <div className="bg-[#f7f7f4] rounded-xl border border-[#e8e8e5] p-10 text-center">
              <p className="text-[13px] text-[#8a8a85]">Журнал пуст</p>
              <p className="text-[11px] text-[#b0b0aa] mt-1">Здесь появятся исправления из Health Check и действия с рекомендациями</p>
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
