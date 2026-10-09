import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { requirePageAccess } from '@/lib/apiAuth'
import { FINISH_IDS } from '@/lib/configurator/pricing'
import { COMPOSITION_ROLES, type CompositionHardware, type CompositionPanel } from '@/lib/calc/composition'
import { GLASS_B2B_NAME, loadComposition, type CompositionRequest } from '@/lib/calc/compositionServer'

export const dynamic = 'force-dynamic'

// Расчёт душевой по составу чертежа (SHOWROOM_COST_ROUTE.md, Ч3) — логика в lib/calc/composition.ts.
// Ответ — себестоимость стекла и закупка фурнитуры, поэтому пускаем тех же, кому открыт
// «Быстрый расчёт»: там менеджер и так вписывает себестоимость руками.

const ARTICLE = /^[A-Za-z0-9][A-Za-z0-9.\- /]{1,40}$/
const int = (v: unknown, lo: number, hi: number) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null
}

function parse(body: unknown): CompositionRequest | string {
  const b = body as Record<string, unknown> | null
  if (!b || typeof b !== 'object') return 'пустой запрос'
  if (typeof b.glassId !== 'string' || !GLASS_B2B_NAME[b.glassId]) return 'неизвестное стекло'
  if (typeof b.finishId !== 'string' || !(FINISH_IDS as readonly string[]).includes(b.finishId)) return 'неизвестный цвет фурнитуры'
  const thickness = b.thickness == null ? 8 : int(b.thickness, 4, 12)
  if (thickness == null) return 'толщина 4–12 мм'
  if (!Array.isArray(b.panels) || b.panels.length < 1 || b.panels.length > 12) return 'створок 1–12'
  if (!Array.isArray(b.hardware) || b.hardware.length > 30) return 'фурнитуры не больше 30 строк'

  const panels: CompositionPanel[] = []
  for (const [i, p] of (b.panels as Record<string, unknown>[]).entries()) {
    const w = int(p?.w, 50, 3500), h = int(p?.h, 50, 3500)
    if (w == null || h == null) return `створка ${i + 1}: размер 50–3500 мм`
    panels.push({ label: String(p.label ?? `Створка ${i + 1}`).slice(0, 60), w, h, derived: p.derived === true })
  }
  const hardware: CompositionHardware[] = []
  for (const [i, x] of (b.hardware as Record<string, unknown>[]).entries()) {
    if (!(COMPOSITION_ROLES as readonly string[]).includes(String(x?.role))) return `фурнитура ${i + 1}: неизвестная роль`
    const article = x.article == null || x.article === '' ? null : String(x.article).trim()
    if (article && !ARTICLE.test(article)) return `фурнитура ${i + 1}: артикул не похож на артикул`
    const pieces = Array.isArray(x.pieces_mm) ? (x.pieces_mm as unknown[]).slice(0, 20).map(v => int(v, 1, 4000)) : []
    if (pieces.some(v => v == null)) return `фурнитура ${i + 1}: длина куска 1–4000 мм`
    const qty = x.qty == null ? undefined : int(x.qty, 0, 50)
    if (qty === null) return `фурнитура ${i + 1}: количество 0–50`
    hardware.push({ role: x.role as CompositionHardware['role'], label: String(x.label ?? '').slice(0, 80) || String(x.role), article, qty, pieces_mm: pieces as number[] })
  }
  return { glassId: b.glassId, thickness, finishId: b.finishId as CompositionRequest['finishId'], panels, hardware }
}

export async function POST(req: NextRequest) {
  const guard = await requirePageAccess('/calculator/quick')
  if (guard instanceof NextResponse) return guard

  const parsed = parse(await req.json().catch(() => null))
  if (typeof parsed === 'string') return NextResponse.json({ error: parsed }, { status: 400 })
  try {
    const result = await loadComposition(createServiceClient(), parsed)
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'расчёт не выполнен' }, { status: 500 })
  }
}
