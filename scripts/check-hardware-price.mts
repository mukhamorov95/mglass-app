import { test, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { config } from 'dotenv'
config({ path: '.env.local' })

// Диагностика, не тест поведения: печатает себестоимость фурнитуры по прайсу
// визуализатора рядом со старым флэтом и показывает, где в комплекте нет цены.
// Запуск: npx vitest run scripts/check-hardware-price.mts --reporter=verbose
// Ходит в живую БД, поэтому в общий прогон (__tests__) не входит.
test('фурнитура: прайс визуализатора против старого флэта', async () => {
  const { hardwareCostFromVisualizer } = await import('@/lib/configurator/hardwareCost')
  const { SHOWER_MODELS, TIER_CONFIGS } = await import('@/lib/showerCalculator')
  const budget = TIER_CONFIGS.find(t => t.value === 'budget')!

  const dims = { width: 900, height: 2000, width2: 900 }
  const rows: string[] = []
  for (const m of SHOWER_MODELS) {
    const flat = Math.round(m.hardwareBase * budget.hwMultiplier)
    const hw = await hardwareCostFromVisualizer({
      modelId: m.id, width: dims.width, height: dims.height, width2: dims.width2,
      thickness: 8, hardwareColor: 'chrome',
    })
    if (!hw) { rows.push(`${m.id.padEnd(4)} флэт ${String(flat).padStart(6)}  → комплекта нет (модель вне ряда)`); continue }
    const d = flat > 0 ? Math.round((hw.cost - flat) / flat * 100) : 0
    rows.push(`${m.id.padEnd(4)} флэт ${String(flat).padStart(6)}  визуализатор ${String(hw.cost).padStart(6)}  ${d > 0 ? '+' : ''}${d}%  ${hw.complete ? '' : 'НЕПОЛНЫЙ: ' + hw.missing.join('; ')}`)
  }
  console.log('\n' + rows.join('\n') + '\n')
}, 120_000)
