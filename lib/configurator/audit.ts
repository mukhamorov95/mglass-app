import { buildFromModel } from '@/components/configurator/scene/assembly'
import { M_MODELS, getModel, type MModel } from '@/lib/configurator/arrangement'
import { FINISH_IDS, GLASS_TYPE_IDS } from '@/lib/configurator/pricing'
import {
  computeKitQuantities, computeKitPrice, piecesForRole, ROLE_META,
  type Library, type ModelKit, type KitRates, type RoleId,
} from '@/lib/configurator/kit'

// Аудит комплектов: прогоняем каждую модель на трёх размерах и во всех цветах и
// собираем, где прайс развалится ДО того, как это увидит клиент. Чистая функция —
// работает на тех же данных, что и админка, без запросов к базе.

export type AuditSeverity = 'blocker' | 'warn'
export type AuditIssue = {
  code: 'нет позиции' | 'нет цены' | 'кусок длиннее хлыста' | 'нет цены в цвете' | 'нулевой хлыст' | 'маржа ниже минимума' | 'нет цены стекла'
  severity: AuditSeverity
  role?: RoleId
  label: string
  detail: string
}
export type AuditModel = {
  code: string
  name: string
  sellable: boolean            // можно ли показывать клиенту цену
  issues: AuditIssue[]
  sizes: { label: string; total: number; cost: number }[]
}
export type AuditReport = {
  models: AuditModel[]
  ready: number
  total: number
  libraryIssues: AuditIssue[]
}

// Три точки размеров: минимум, середина, максимум — на краях вылезает то, чего не видно
// в середине (стойка не влезает в хлыст, петель становится три).
function sizesFor(model: MModel) {
  const c = model.constraints
  const at = (k: 0 | 1 | 0.5, [a, b]: [number, number]) => Math.round(k === 0.5 ? (a + b) / 2 : k === 0 ? a : b)
  const mk = (k: 0 | 1 | 0.5, label: string) => ({
    label,
    dims: {
      width: at(k, c.width),
      height: at(k, c.height),
      width2: c.needsWidth2 && c.width2 ? at(k, c.width2) : undefined,
      doorWidth: c.doorWidth ? at(k, c.doorWidth) : undefined,
    },
  })
  return [mk(0, 'минимум'), mk(0.5, 'середина'), mk(1, 'максимум')]
}

export function auditKits(
  library: Library,
  kits: Record<string, ModelKit>,
  rates: KitRates,
  finance: { marginPct: number; taxPct: number; minMarginPct?: number },
): AuditReport {
  const libraryIssues: AuditIssue[] = []
  const byId = new Map(library.items.map(i => [i.id, i]))

  // Позиция без цены хотя бы в одном цвете — клиент выберет этот цвет и получит дыру.
  for (const it of library.items) {
    if (ROLE_META[it.role].kind === 'bar') {
      const stocks = it.stocks ?? []
      if (stocks.length === 0) {
        libraryIssues.push({ code: 'нулевой хлыст', severity: 'blocker', role: it.role, label: it.name, detail: 'не задан ни один хлыст' })
        continue
      }
      const bad = stocks.filter(s => !(s.len > 0))
      if (bad.length) libraryIssues.push({ code: 'нулевой хлыст', severity: 'blocker', role: it.role, label: it.name, detail: 'у хлыста не указана длина' })
      const noColor = FINISH_IDS.filter(f => !stocks.some(s => (s.prices?.[f] ?? 0) > 0))
      if (noColor.length && noColor.length < FINISH_IDS.length) {
        libraryIssues.push({ code: 'нет цены в цвете', severity: 'warn', role: it.role, label: it.name, detail: `нет цены: ${noColor.join(', ')}` })
      }
    } else {
      const prices = it.prices ?? {}
      const noColor = FINISH_IDS.filter(f => !(prices[f] > 0))
      if (noColor.length === FINISH_IDS.length) {
        libraryIssues.push({ code: 'нет цены', severity: 'blocker', role: it.role, label: it.name, detail: 'цены нет ни в одном цвете' })
      } else if (noColor.length) {
        libraryIssues.push({ code: 'нет цены в цвете', severity: 'warn', role: it.role, label: it.name, detail: `нет цены: ${noColor.join(', ')}` })
      }
    }
  }

  const glassMissing = GLASS_TYPE_IDS.filter(g => !((rates.glassPerM2?.[g] ?? 0) > 0))
  if (glassMissing.length) {
    libraryIssues.push({ code: 'нет цены стекла', severity: 'blocker', label: 'Стекло', detail: `нет ₽/м²: ${glassMissing.join(', ')}` })
  }

  const models: AuditModel[] = M_MODELS.map(m => {
    const kit = kits[m.code] ?? { slots: [] }
    const issues: AuditIssue[] = []
    const seen = new Set<string>()
    const push = (i: AuditIssue) => { const k = `${i.code}|${i.role ?? ''}|${i.detail}`; if (!seen.has(k)) { seen.add(k); issues.push(i) } }
    const sizes: AuditModel['sizes'] = []

    for (const s of sizesFor(m)) {
      const q = computeKitQuantities(buildFromModel(getModel(m.code), s.dims, m.thickness[0] ?? 8), m.thickness[0] ?? 8, m, rates.capMargin)
      // Цвет влияет на цену — гоняем все, но в отчёт кладём один раз на проблему.
      for (const finishId of FINISH_IDS) {
        const p = computeKitPrice(q, library, kit, rates, finance, { finishId })
        for (const miss of p.missing) {
          push({
            code: miss.reason, severity: 'blocker', role: miss.role, label: miss.label,
            detail: miss.reason === 'кусок длиннее хлыста'
              ? `${s.label}: кусок не влезает ни в один хлыст`
              : `${miss.label}: ${miss.reason}${miss.reason === 'нет цены' ? ` (цвет ${finishId})` : ''}`,
          })
        }
        if (p.belowMin) push({ code: 'маржа ниже минимума', severity: 'blocker', label: 'Маржа', detail: `${p.marginPct}% ниже минимума` })
        if (finishId === 'chrome') sizes.push({ label: s.label, total: p.total, cost: p.materialsCost })
      }
    }

    // Пустой слот — роль есть в комплекте, а позиции в ней нет.
    for (const slot of kit.slots) {
      const need = ROLE_META[slot.role].kind === 'bar'
        ? piecesForRole(computeKitQuantities(buildFromModel(getModel(m.code), sizesFor(m)[1].dims, 8), 8, m, rates.capMargin), kit, slot.role).length
        : 1
      if (slot.entries.length === 0 && need > 0) {
        push({ code: 'нет позиции', severity: 'blocker', role: slot.role, label: ROLE_META[slot.role].label, detail: 'подгруппа пустая' })
      }
      for (const e of slot.entries) {
        if (!byId.has(e.itemId)) {
          push({ code: 'нет позиции', severity: 'blocker', role: slot.role, label: ROLE_META[slot.role].label, detail: 'ссылка на удалённую позицию' })
        }
      }
    }

    return {
      code: m.code, name: m.name, issues, sizes,
      sellable: issues.every(i => i.severity !== 'blocker'),
    }
  })

  return {
    models,
    ready: models.filter(m => m.sellable).length,
    total: models.length,
    libraryIssues,
  }
}
