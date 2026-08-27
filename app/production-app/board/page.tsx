import { createClient } from '@supabase/supabase-js'
import Link from 'next/link'
import ProductionTabs from '@/components/ProductionTabs'
import { type DetailStages, getApplicableStages, type DetailStageKey, stageLabel } from '@/lib/productionStages'
import { PROD_SINCE } from '@/lib/orderFlags'

// ЕДИНЫЙ ОБЗОР ЦЕХА. Собран из трёх экранов, которые отвечали на один вопрос
// «что сейчас в цеху» (П6): матрица «заказ × этапы» отсюда, пул по станциям — из
// «Пула на сегодня», сводка, фильтры и счётчик отмен — из «Панели производства».
// Та панель вдобавок стояла целиком на notes.detail_stages и не обращалась к
// production_tasks вообще — расходилась с остальным контуром по построению.
// Оба прежних адреса оставлены редиректами: на «Пул на сегодня» ссылается дашборд CEO.
// Строки = активные заказы, колонки = этапы ленты заказа, ячейки = статус этапа.
// Основа: notes.stages (order-level флаги — данные есть по всем активным заказам).
// Уточнение (в работе / частично / проблема): detail_stages + production_tasks
// у заказов, запущенных в новый поточный цех. Доступен роли production.

export const dynamic = 'force-dynamic'

type Stages = Partial<Record<string, boolean | string | null>>
type NotesData = {
  status?: string
  launched_at?: string
  production_days?: number
  deadline_date?: string
  docs_printed?: boolean
  stages?: Stages
  detail_stages?: DetailStages
  detail_stage_audit?: unknown[]
  urgent?: boolean
}
type ItemLite = { hasTempering?: boolean; materialName?: string; category?: string; hasHoles?: boolean; shape?: string }
type Order = { id: number; client_name: string | null; custom_number: string | null; items: ItemLite[]; created_at: string; pn: NotesData }

// Колонки ленты заказа. stage — этап производства (для уточнения по позициям), null — только order-level.
// alt — второй ключ флага (разные конвенции: импорт использует edge/packed, /b2b-orders — edge_processed/packaged).
const COLS = [
  { key: 'printed',          label: 'Чертёж',    stage: null,                            alt: null },
  { key: 'material_ordered', label: 'Материал',  stage: null,                            alt: null },
  { key: 'cut',              label: 'Резка',     stage: 'cutting'   as DetailStageKey,   alt: null },
  { key: 'edge',             label: 'Полировка', stage: 'polishing' as DetailStageKey,   alt: 'edge_processed' },
  { key: 'drilled',          label: 'Сверление', stage: 'drilling'  as DetailStageKey,   alt: null },
  { key: 'facet',            label: 'Фацет',     stage: 'facet'     as DetailStageKey,   alt: null },
  { key: 'tempering',        label: 'Закалка',   stage: 'tempering' as DetailStageKey,   alt: null },
  { key: 'triplex',          label: 'Триплекс',  stage: 'triplex'   as DetailStageKey,   alt: null },
  { key: 'packed',           label: 'Упаковка',  stage: 'packaging' as DetailStageKey,   alt: 'packaged' },
] as const

// Фацет/Триплекс — редкие этапы: колонку показываем, только если есть применимый заказ.
const OPTIONAL_COLS = new Set(['facet', 'triplex'])

function parseNotes(n: string | null): NotesData {
  if (!n) return {}
  try { const p = JSON.parse(n); return typeof p === 'object' && p ? p as NotesData : {} } catch { return {} }
}
function getDeadline(pn: NotesData, createdAt: string): Date {
  if (pn.deadline_date) return new Date(pn.deadline_date)
  if (pn.launched_at && pn.production_days) { const d = new Date(pn.launched_at); d.setDate(d.getDate() + pn.production_days); return d }
  if (pn.launched_at) { const d = new Date(pn.launched_at); d.setDate(d.getDate() + 7); return d }
  const d = new Date(createdAt); d.setDate(d.getDate() + 10); return d
}
const dLabel = (d: number) => d < 0 ? `−${Math.abs(d)}д` : d === 0 ? 'сегодня' : d === 1 ? 'завтра' : `+${d}д`
function dColor(d: number, ready: boolean) {
  if (ready) return 'text-emerald-700 bg-emerald-50 border-emerald-200'
  if (d < 0)  return 'text-red-600 bg-red-50 border-red-200'
  if (d === 0) return 'text-amber-700 bg-amber-50 border-amber-200'
  if (d <= 2) return 'text-yellow-700 bg-yellow-50 border-yellow-200'
  return 'text-[#6b6b66] bg-[#f0f0ec] border-[#e4e4e0]'
}

// Фильтры перенесены из «Панели производства». Живут в адресе, а не в состоянии:
// экран серверный, и ссылку на «просрочку» можно дать словами.
const FILTERS = [
  { key: 'all',      label: 'Все' },
  { key: 'overdue',  label: 'Просрочка' },
  { key: 'urgent',   label: 'Горит' },
  { key: 'problems', label: 'Проблемы' },
  { key: 'ready',    label: 'Готовы' },
  { key: 'audit',    label: 'С отменами' },
] as const
type FilterKey = typeof FILTERS[number]['key']

type CellStatus = 'done' | 'inprogress' | 'partial' | 'problem' | 'none'
type Cell = { status: CellStatus; doneN?: number; total?: number; worker?: string; frontier?: boolean }

export default async function BoardPage({ searchParams }: { searchParams: Promise<{ all?: string; filter?: string }> }) {
  const sp = await searchParams
  const showAll = sp.all === '1'
  const filter: FilterKey = (FILTERS.some(f => f.key === sp.filter) ? sp.filter : 'all') as FilterKey
  const svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const { data } = await svc
    .from('b2b_orders')
    .select('id,client_name,custom_number,items,notes,created_at')
    .not('notes', 'ilike', '%"status":"quote"%')
    .is('archived_at', null)
    .gte('created_at', PROD_SINCE)
    .order('created_at', { ascending: false })
    .limit(500)

  const active: Order[] = (data ?? []).map((o: Record<string, unknown>) => ({
    id: o.id as number,
    client_name: o.client_name as string | null,
    custom_number: o.custom_number as string | null,
    items: Array.isArray(o.items) ? o.items as ItemLite[] : [],
    created_at: o.created_at as string,
    pn: parseNotes(o.notes as string | null),
  })).filter(o => !o.pn.stages?.shipped)

  // WIP-оверлей из нового поточного цеха.
  const orderIds = active.map(o => o.id)
  const { data: ipTasks } = orderIds.length
    ? await svc.from('production_tasks').select('order_id,stage_key,assigned_to').eq('status', 'in_progress').in('order_id', orderIds)
    : { data: [] as { order_id: number; stage_key: string; assigned_to: string | null }[] }
  const assigneeIds = [...new Set((ipTasks ?? []).map(t => t.assigned_to).filter((x): x is string => !!x))]
  const { data: users } = assigneeIds.length
    ? await svc.from('users').select('id,name').in('id', assigneeIds)
    : { data: [] as { id: string; name: string | null }[] }
  const userName = new Map((users ?? []).map(u => [u.id, (u.name ?? '').split(' ')[0]]))
  const ipByOrderStage = new Map<string, string | undefined>()
  for (const t of ipTasks ?? []) ipByOrderStage.set(`${t.order_id}:${t.stage_key}`, t.assigned_to ? userName.get(t.assigned_to) : undefined)

  // Пул по станциям (из «Пула на сегодня»): сколько открытых задач стоит на каждой.
  const { data: poolTasks } = orderIds.length
    ? await svc.from('production_tasks').select('station,status').in('order_id', orderIds).in('status', ['queued', 'in_progress', 'problem'])
    : { data: [] as { station: string; status: string }[] }
  const pool = new Map<string, { open: number; problems: number }>()
  for (const t of (poolTasks ?? []) as { station: string; status: string }[]) {
    const cur = pool.get(t.station) ?? { open: 0, problems: 0 }
    if (t.status === 'problem') cur.problems += 1; else cur.open += 1
    pool.set(t.station, cur)
  }
  const poolRows = [...pool.entries()]
    .map(([station, v]) => ({ station, label: stageLabel(station), ...v }))
    .sort((a, b) => (b.open + b.problems) - (a.open + a.problems))

  const today = new Date(); today.setHours(0, 0, 0, 0)

  function buildRow(o: Order) {
    const flags = o.pn.stages ?? {}
    const ds = o.pn.detail_stages ?? {}
    const hasDetail = Object.keys(ds).length > 0
    const cells: Record<string, Cell> = {}
    let anyProblem = false

    for (const col of COLS) {
      const flagDone = flags[col.key] === true
        || (col.alt != null && flags[col.alt] === true)
        || (col.key === 'printed' && o.pn.docs_printed === true)
      let cell: Cell = { status: flagDone ? 'done' : 'none' }

      // Уточнение по позициям (только для колонок-этапов и заказов с detail_stages/задачами).
      if (col.stage && !flagDone) {
        const ip = ipByOrderStage.has(`${o.id}:${col.stage}`)
        if (hasDetail) {
          const applicable = o.items.map((it, i) => [i, getApplicableStages(it).some(s => s.key === col.stage)] as const).filter(([, ok]) => ok).map(([i]) => i)
          const total = applicable.length
          const doneN = applicable.filter(i => ds[String(i)]?.[col.stage!]?.status === 'done').length
          const problemN = applicable.filter(i => ds[String(i)]?.[col.stage!]?.status === 'problem').length
          if (problemN > 0) { cell = { status: 'problem' }; anyProblem = true }
          else if (total > 0 && doneN === total) cell = { status: 'done' }
          else if (ip) cell = { status: 'inprogress', worker: ipByOrderStage.get(`${o.id}:${col.stage}`) }
          else if (doneN > 0) cell = { status: 'partial', doneN, total }
        } else if (ip) {
          cell = { status: 'inprogress', worker: ipByOrderStage.get(`${o.id}:${col.stage}`) }
        }
      }
      cells[col.key] = cell
    }

    if (Object.values(ds).some(s => s?.problem?.status === 'problem')) anyProblem = true

    // Готов к отгрузке = упаковка выполнена: order-level флаг (исторические) ИЛИ
    // все позиции упакованы по detail_stages (новые июльские заказы из просчёта).
    const allDone = cells['packed']?.status === 'done'
    // Фронтир — первый невыполненный этап (где заказ «сейчас»).
    const frontier = allDone ? undefined : COLS.find(c => cells[c.key].status !== 'done')
    if (frontier) cells[frontier.key].frontier = true

    const dl = getDeadline(o.pn, o.created_at); dl.setHours(0, 0, 0, 0)
    const days = Math.round((dl.getTime() - today.getTime()) / 86_400_000)
    return { o, cells, anyProblem, allDone, days }
  }

  const rows = active.map(buildRow)
    .map(r => ({ ...r, undos: Array.isArray(r.o.pn.detail_stage_audit) ? r.o.pn.detail_stage_audit.length : 0 }))
    .sort((a, b) => (a.allDone ? 1 : 0) - (b.allDone ? 1 : 0) || a.days - b.days)

  const doneCount    = rows.filter(r => r.allDone).length
  const problemCount = rows.filter(r => r.anyProblem).length
  const overdueCount = rows.filter(r => !r.allDone && r.days < 0).length
  const urgentCount  = rows.filter(r => !r.allDone && r.days >= 0 && r.days <= 1).length
  const undoCount    = rows.filter(r => r.undos > 0).length

  const matches = (r: typeof rows[number]) => {
    if (filter === 'overdue')  return !r.allDone && r.days < 0
    if (filter === 'urgent')   return !r.allDone && r.days >= 0 && r.days <= 1
    if (filter === 'problems') return r.anyProblem
    if (filter === 'ready')    return r.allDone
    if (filter === 'audit')    return r.undos > 0
    return showAll || !r.allDone
  }
  const visible = rows.filter(matches)
  const counts: Record<FilterKey, number> = {
    all: showAll ? rows.length : rows.length - doneCount,
    overdue: overdueCount, urgent: urgentCount, problems: problemCount,
    ready: doneCount, audit: undoCount,
  }

  const usedStages = new Set<string>()
  for (const o of active) for (const it of o.items) for (const s of getApplicableStages(it)) usedStages.add(s.key)
  const visibleCols = COLS.filter(c => !OPTIONAL_COLS.has(c.key) || (c.stage != null && usedStages.has(c.stage)))

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-4 pt-12 pb-3 lg:pt-6">
        <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Обзор цеха</h1>
        <p className="text-[13px] text-[#9a9a95] mt-0.5">
          {rows.length - doneCount} в работе · {doneCount} готовы к отгрузке{problemCount > 0 ? ` · ${problemCount} с проблемой` : ''}
        </p>
        <ProductionTabs extra={
          <Link href={showAll ? '/production-app/board' : '/production-app/board?all=1'}
            className="text-[11px] font-medium px-2.5 py-1 rounded-full border border-[#e4e4e0] text-[#6b6b66] hover:bg-[#f0f0ec] transition-colors ml-auto">
            {showAll ? 'Скрыть готовые' : `Показать готовые (${doneCount})`}
          </Link>
        } />
      </div>

      <div className="px-4 pt-4 space-y-3">

        {/* Пул по станциям — перенесён из «Пула на сегодня». Где сколько стоит прямо сейчас. */}
        {poolRows.length > 0 && (
          <div className="bg-white rounded-xl border border-[#e4e4e0] px-4 py-3">
            <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-wide mb-2">Стоит по станциям</p>
            <div className="flex flex-wrap gap-2">
              {poolRows.map(r => (
                <Link key={r.station} href={`/production-app/station/${r.station}`}
                  className="flex items-baseline gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#e4e4e0] hover:border-[#111110] transition-colors">
                  <span className="text-[12px] text-[#111110]">{r.label}</span>
                  <span className="text-[13px] font-bold tabular-nums text-[#111110]">{r.open}</span>
                  {r.problems > 0 && <span className="text-[11px] font-semibold text-red-600">⚠{r.problems}</span>}
                </Link>
              ))}
            </div>
            <p className="text-[10px] text-[#c4c4be] mt-2">
              Большая очередь не всегда означает завал: если на станции не отмечают, работа идёт, а задачи копятся.
              Кто отмечает — видно в «Кто что делал».
            </p>
          </div>
        )}

        {/* Фильтры — перенесены из «Панели производства» */}
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map(f => {
            const active = filter === f.key
            const n = counts[f.key]
            const tone = f.key === 'overdue' ? 'text-red-600' : f.key === 'problems' ? 'text-orange-600' : f.key === 'ready' ? 'text-emerald-700' : 'text-[#6b6b66]'
            return (
              <Link key={f.key} href={f.key === 'all' ? '/production-app/board' : `/production-app/board?filter=${f.key}`}
                className={`text-[11px] font-medium px-2.5 py-1 rounded-full transition-colors ${active ? 'bg-[#111110] text-white' : 'bg-white border border-[#e4e4e0] hover:bg-[#f0f0ec]'}`}>
                {f.label} <span className={active ? 'opacity-70' : tone}>{n}</span>
              </Link>
            )
          })}
        </div>

        {visible.length === 0 ? (
          <div className="bg-white rounded-xl border border-[#e4e4e0] p-8 text-center">
            <p className="text-[14px] text-[#9a9a95]">{filter === 'all' ? 'Нет заказов в работе' : 'Под этот фильтр ничего не попало'}</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-[#e4e4e0] overflow-x-auto">
            <table className="text-xs border-collapse min-w-full">
              <thead>
                <tr className="border-b border-[#e4e4e0]">
                  <th className="text-left px-3 py-2 text-[10px] font-semibold text-[#9a9a95] uppercase tracking-wide sticky left-0 bg-white z-10">Заказ</th>
                  <th className="px-2 py-2 text-[10px] font-semibold text-[#9a9a95]">Срок</th>
                  {visibleCols.map(c => <th key={c.key} className="px-2 py-2 text-[10px] font-semibold text-[#9a9a95] whitespace-nowrap">{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {visible.map(({ o, cells, anyProblem, allDone, days, undos }) => (
                  <tr key={o.id} className="border-b border-[#f5f5f3] last:border-0 hover:bg-[#fafaf9]">
                    <td className="px-3 py-2 sticky left-0 bg-white">
                      <Link href={`/production-app/orders/${o.id}`} className="block min-w-[120px]">
                        <span className="font-bold text-[#111110]">{o.custom_number?.trim() || `00${o.id}`}</span>
                        {anyProblem && <span className="ml-1 text-red-600">⚠</span>}
                        {undos > 0 && <span className="ml-1 text-blue-600" title={`Отмен этапов: ${undos}`}>↩{undos}</span>}
                        <span className="block text-[11px] text-[#9a9a95] truncate max-w-[160px]">{o.client_name}</span>
                      </Link>
                    </td>
                    <td className="px-2 py-2 text-center">
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border whitespace-nowrap ${dColor(days, allDone)}`}>{allDone ? 'готов' : dLabel(days)}</span>
                    </td>
                    {visibleCols.map(c => <td key={c.key} className="px-2 py-2 text-center"><StageCell cell={cells[c.key]} /></td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Легенда */}
        <div className="flex flex-wrap items-center gap-3 mt-3 px-1">
          <span className="text-[10px] text-[#9a9a95]">Ячейки:</span>
          {[
            { l: 'готово', c: 'bg-emerald-500' },
            { l: 'в работе', c: 'bg-blue-500' },
            { l: 'частично', c: 'bg-amber-400' },
            { l: 'не начато', c: 'bg-[#e4e4e0]' },
            { l: 'проблема', c: 'bg-red-500' },
          ].map(x => (
            <span key={x.l} className="flex items-center gap-1 text-[10px] text-[#6b6b66]">
              <span className={`inline-block w-2.5 h-2.5 rounded-sm ${x.c}`} />{x.l}
            </span>
          ))}
          <span className="text-[10px] text-[#9a9a95]">· синяя рамка — текущий этап</span>
        </div>
      </div>
    </div>
  )
}

function StageCell({ cell }: { cell: Cell }) {
  if (!cell) return <span className="text-[#d4d4d0]">—</span>
  const ring = cell.frontier ? 'ring-2 ring-blue-400 ring-offset-1' : ''
  if (cell.status === 'done') return <span className={`inline-flex items-center justify-center w-6 h-6 rounded-md bg-emerald-500 text-white text-[12px] font-bold ${ring}`}>✓</span>
  if (cell.status === 'problem') return <span className={`inline-flex items-center justify-center w-6 h-6 rounded-md bg-red-500 text-white text-[12px] ${ring}`}>⚠</span>
  if (cell.status === 'inprogress') return <span className={`inline-flex items-center justify-center min-w-6 h-6 px-1 rounded-md bg-blue-500 text-white text-[10px] font-medium ${ring}`}>{cell.worker || '🔧'}</span>
  if (cell.status === 'partial') return <span className={`inline-flex items-center justify-center min-w-6 h-6 px-1 rounded-md bg-amber-400 text-white text-[10px] font-bold ${ring}`}>{cell.doneN}/{cell.total}</span>
  return <span className={`inline-block w-6 h-6 rounded-md bg-[#f0f0ec] border border-[#e4e4e0] ${ring}`} />
}
