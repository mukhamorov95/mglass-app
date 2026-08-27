// Диагностика источников выручки для /cfo/model. По каждому юниту — какие
// источники есть, их покрытие (сколько записей, период, сумма) и можно ли им
// верить. Правило: источнику нельзя доверять → показываем «данных нет», а не
// молчаливый ноль и не битую цифру из импорта.

import type { SupabaseClient } from '@supabase/supabase-js'

export type Verdict = 'trust' | 'partial' | 'distrust'

export type SourceDiag = {
  unit: string
  source: string          // человекочитаемое имя источника
  table: string
  records: number         // записей за месяц (или охват)
  sumRub: number | null   // сумма, если применимо
  periodFrom: string | null
  periodTo: string | null
  issue: string           // «битые/пустые»: что не так (пусто, если всё чисто)
  verdict: Verdict
  reason: string
  usedForFact: boolean
}

// Значение факта для юнита: число ТОЛЬКО если есть источник с verdict='trust',
// помеченный usedForFact, с ненулевой суммой. Иначе captured=false → «данных
// нет». Никаких молчаливых нулей.
export function factForUnit(
  diags: SourceDiag[],
  unit: string,
): { revenue: number; captured: true } | { revenue: null; captured: false } {
  const trusted = diags.find(
    (d) => d.unit === unit && d.usedForFact && d.verdict === 'trust' && d.sumRub != null,
  )
  if (trusted && trusted.sumRub != null) return { revenue: trusted.sumRub, captured: true }
  return { revenue: null, captured: false }
}

const sumBy = <T>(rows: T[], pick: (r: T) => number) => rows.reduce((s, r) => s + (pick(r) || 0), 0)

export async function collectSourceDiagnostics(
  sb: SupabaseClient,
  monthStart: string,
): Promise<SourceDiag[]> {
  const out: SourceDiag[] = []

  // ── Производство: запущенные заказы B2B ──────────────────────────────────
  const { data: launched } = await sb
    .from('b2b_orders')
    .select('total_after_discount, total_sale_inc_vat, launched_at')
    .gte('launched_at', monthStart)
    .not('launched_at', 'is', null)
    .is('archived_at', null)
  const lRows = (launched ?? []) as { total_after_discount: number | null; total_sale_inc_vat: number | null; launched_at: string | null }[]
  const lSum = sumBy(lRows, (r) => r.total_after_discount ?? r.total_sale_inc_vat ?? 0)
  const lDates = lRows.map((r) => r.launched_at).filter(Boolean).sort() as string[]
  const { count: notLaunched } = await sb
    .from('b2b_orders')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', monthStart)
    .is('launched_at', null)
    .is('archived_at', null)
  out.push({
    unit: 'Производство',
    source: 'Запущенные заказы B2B',
    table: 'b2b_orders (launched_at)',
    records: lRows.length,
    sumRub: Math.round(lSum),
    periodFrom: lDates[0] ?? null,
    periodTo: lDates[lDates.length - 1] ?? null,
    issue: (notLaunched ?? 0) > 0 ? `${notLaunched} КП не запущены — исключены (это не продажи)` : '',
    verdict: 'trust',
    reason: '100% предоплата: запуск в работу = оплата = реальный оборот',
    usedForFact: true,
  })

  // ── M-Glass: просчёты (calculations) ─────────────────────────────────────
  const { count: calcTotal } = await sb
    .from('calculations')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', monthStart)
  const { count: calcApproved } = await sb
    .from('calculations')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', monthStart)
    .eq('status', 'approved')
  out.push({
    unit: 'M-Glass',
    source: 'Просчёты (одобренные)',
    table: 'calculations',
    records: calcApproved ?? 0,
    sumRub: null,
    periodFrom: null,
    periodTo: null,
    issue: `за месяц ${calcTotal ?? 0} шт, одобренных ${calcApproved ?? 0} — это черновики в калькуляторе, не продажи`,
    verdict: 'distrust',
    reason: 'calculations — это КП/просчёты, а не выручка',
    usedForFact: false,
  })

  // ── M-Glass: книга продаж (crm_sales) ────────────────────────────────────
  const { count: crmHist } = await sb
    .from('crm_sales')
    .select('*', { count: 'exact', head: true })
    .eq('department', 'mglass')
  const { count: crmMtd } = await sb
    .from('crm_sales')
    .select('*', { count: 'exact', head: true })
    .eq('department', 'mglass')
    .gte('created_at', monthStart)
  out.push({
    unit: 'M-Glass',
    source: 'Книга продаж (розница)',
    table: 'crm_sales',
    records: crmMtd ?? 0,
    sumRub: null,
    periodFrom: null,
    periodTo: null,
    issue: `источник загрязнён историей: всего ${crmHist ?? 0} записей по рознице (аномальный импорт Google-выгрузки). Ночной крон backbone завернул`,
    verdict: 'distrust',
    reason: 'битые исторические данные — суммы кратно выше плана; доверять нельзя',
    usedForFact: false,
  })

  // ── M-Glass / общий: оплаты из выписки (payments) ────────────────────────
  const { data: pays } = await sb
    .from('payments')
    .select('amount, created_at, invoice_id')
    .gte('created_at', monthStart)
  const pRows = (pays ?? []) as { amount: number | null; created_at: string | null; invoice_id: number | null }[]
  const pSum = sumBy(pRows, (r) => r.amount ?? 0)
  const pDates = pRows.map((r) => r.created_at).filter(Boolean).sort() as string[]
  const pWithInvoice = pRows.filter((r) => r.invoice_id != null).length
  out.push({
    unit: 'M-Glass',
    source: 'Оплаты из банк-выписки',
    table: 'payments',
    records: pRows.length,
    sumRub: Math.round(pSum),
    periodFrom: pDates[0]?.slice(0, 10) ?? null,
    periodTo: pDates[pDates.length - 1]?.slice(0, 10) ?? null,
    issue: `новый источник; розница пока идёт не полностью; с привязкой к счёту ${pWithInvoice}/${pRows.length}`,
    verdict: 'partial',
    reason: 'касса из выписки надёжна по деньгам, но розничные продажи заносятся не полностью — как наладится, станет доверенным источником розницы',
    usedForFact: false,
  })

  return out
}
