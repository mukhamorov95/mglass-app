import { redirect } from 'next/navigation'
import { getRole, isOwnerRole } from '@/lib/getRole'
import { createClient } from '@/lib/supabase-server'
import type { FinancialSettings } from '@/lib/types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="text-[16px] font-semibold text-ink mb-4 pb-2 border-b border-line">{title}</h2>
      {children}
    </section>
  )
}

function Card({ children, color = 'border-line' }: { children: React.ReactNode; color?: string }) {
  return (
    <div className={`bg-surface rounded-xl border ${color} p-5 mb-4`}>
      {children}
    </div>
  )
}

function Formula({ formula, note }: { formula: string; note?: string }) {
  return (
    <div className="my-3">
      <div className="bg-canvas rounded-lg px-4 py-3 font-mono text-[13px] text-ink border border-line">
        {formula}
      </div>
      {note && <p className="text-[12px] text-muted mt-1.5 ml-1">{note}</p>}
    </div>
  )
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-canvas last:border-0">
      <span className="text-[13px] text-ink-soft">{label}</span>
      <span className={`text-[13px] font-semibold font-mono ${color ?? 'text-ink'}`}>{value}</span>
    </div>
  )
}

function TrafficLight({ green, yellow, red }: { green: string; yellow: string; red: string }) {
  return (
    <div className="grid grid-cols-3 gap-3 my-4">
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
        <div className="w-4 h-4 rounded-full bg-emerald-500 mx-auto mb-2" />
        <p className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wider mb-1">Рекомендовано</p>
        <p className="text-[13px] text-emerald-800 font-semibold">{green}</p>
      </div>
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
        <div className="w-4 h-4 rounded-full bg-amber-400 mx-auto mb-2" />
        <p className="text-[11px] font-semibold text-amber-700 uppercase tracking-wider mb-1">Допустимо</p>
        <p className="text-[13px] text-amber-800 font-semibold">{yellow}</p>
      </div>
      <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
        <div className="w-4 h-4 rounded-full bg-red-500 mx-auto mb-2" />
        <p className="text-[11px] font-semibold text-red-700 uppercase tracking-wider mb-1">Ниже минимума</p>
        <p className="text-[13px] text-red-800 font-semibold">{red}</p>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function PricingManualPage() {
  const role = await getRole()
  if (!isOwnerRole(role)) redirect('/')

  const supabase = await createClient()
  const { data: settingsRows } = await supabase
    .from('financial_settings')
    .select('*')
    .order('id')

  const settings = (settingsRows ?? []) as FinancialSettings[]
  const defSettings = settings[0]
  const loftSettings   = settings.find(s => s.product_type === 'loft')       ?? defSettings
  const mirrorSettings = settings.find(s => s.product_type === 'mirror_light') ?? defSettings
  const showerStd      = settings.find(s => s.product_type === 'shower_standard') ?? defSettings
  const showerBudget   = settings.find(s => s.product_type === 'shower_budget')   ?? defSettings

  function calcExample(cost: number, s: FinancialSettings) {
    const denom = 1 - s.tax_percent / 100 - s.default_margin / 100
    return denom > 0 ? Math.round(cost / denom).toLocaleString('ru-RU') : '—'
  }

  return (
    <div className="max-w-[860px] mx-auto px-6 py-8">

      {/* Header */}
      <div className="mb-8">
        <p className="text-[11px] font-semibold text-muted uppercase tracking-wider mb-1">Только для владельца · Admin</p>
        <h1 className="text-[26px] font-semibold text-ink tracking-tight">Руководство по ценообразованию</h1>
        <p className="text-[14px] text-ink-soft mt-1">
          Полная финансовая модель MGlass — формулы, коэффициенты, нормы маржи
        </p>
      </div>

      {/* ── 1. КЛЮЧЕВАЯ ФОРМУЛА ── */}
      <Section title="1. Единая формула ценообразования">
        <Card color="border-blue-200">
          <p className="text-[13px] font-semibold text-ink mb-2">Основная формула (для всех продуктов B2C):</p>
          <Formula
            formula="Цена продажи = Себестоимость / (1 − Расходы% − Маржа%)"
            note="Расходы% — это налог/overhead (12%), Маржа% — целевая прибыль. Всё вместе должно быть < 100%."
          />
          <p className="text-[13px] font-semibold text-ink mt-4 mb-2">Партнёрская надбавка (grossup):</p>
          <Formula
            formula="Цена с партнёркой = Цена продажи / (1 − Партнёр%)"
            note="Важно: надбавка считается через деление (grossup), а не как +%. Иначе цена будет занижена."
          />
          <p className="text-[13px] font-semibold text-ink mt-4 mb-2">Скидка:</p>
          <Formula
            formula="Итоговая цена = Цена с партнёркой × (1 − Скидка%)"
            note="Скидка применяется ПОСЛЕДНЕЙ, уже после партнёрской надбавки."
          />
          <p className="text-[13px] font-semibold text-ink mt-4 mb-2">Реальная прибыль (не margin × price!):</p>
          <Formula
            formula="Прибыль = Цена − Себестоимость − (Цена × Расходы%)"
            note="Маржа = Прибыль / Цена × 100%. Это реальная маржа с учётом скидки, а не целевая."
          />
        </Card>
      </Section>

      {/* ── 2. СВЕТОФОР ── */}
      <Section title="2. Система контроля маржи (светофор)">
        <p className="text-[13px] text-ink-soft mb-4">
          Все расчёты автоматически проверяются по трём порогам. Менеджер видит статус — можно ли продавать.
        </p>
        {defSettings && (
          <TrafficLight
            green={`≥ ${defSettings.green_threshold ?? defSettings.default_margin}% — рекомендованная маржа`}
            yellow={`${defSettings.yellow_threshold ?? defSettings.min_margin}–${(defSettings.green_threshold ?? defSettings.default_margin) - 1}% — можно продавать, маржа ниже цели`}
            red={`< ${defSettings.yellow_threshold ?? defSettings.min_margin}% — продажа требует согласования с руководителем`}
          />
        )}
        <Card>
          <p className="text-[12px] font-semibold text-muted uppercase tracking-wider mb-3">Текущие пороги по продуктам</p>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line">
                  <th className="text-left py-2 text-ink-soft font-semibold">Продукт</th>
                  <th className="text-center py-2 text-ink-soft font-semibold">Расходы%</th>
                  <th className="text-center py-2 text-ink-soft font-semibold">Целевая маржа</th>
                  <th className="text-center py-2 text-ink-soft font-semibold">Мин. маржа</th>
                  <th className="text-center py-2 text-ink-soft font-semibold">Макс. скидка</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { label: 'Зеркало с LED',      s: mirrorSettings },
                  { label: 'Душевая Стандарт',   s: showerStd     },
                  { label: 'Душевая Бюджет',     s: showerBudget  },
                  { label: 'Лофт-перегородка',   s: loftSettings  },
                ].map(({ label, s }) => s ? (
                  <tr key={label} className="border-b border-canvas last:border-0">
                    <td className="py-2.5 font-medium text-ink">{label}</td>
                    <td className="py-2.5 text-center font-mono">{s.tax_percent}%</td>
                    <td className="py-2.5 text-center font-mono text-emerald-600">{s.default_margin}%</td>
                    <td className="py-2.5 text-center font-mono text-amber-600">{s.min_margin}%</td>
                    <td className="py-2.5 text-center font-mono text-red-500">{s.max_discount_percent}%</td>
                  </tr>
                ) : null)}
              </tbody>
            </table>
          </div>
        </Card>
      </Section>

      {/* ── 3. ЗЕРКАЛО ── */}
      <Section title="3. Зеркала и зеркала с подсветкой">
        <Card color="border-blue-100">
          <p className="text-[12px] font-semibold text-blue-600 uppercase tracking-wider mb-3">Себестоимость — BOM</p>
          <div className="space-y-1">
            <Row label="Зеркало (с учётом sale_price)" value="м² × цена/м²" />
            <Row label="Коэффициент высоты > 2800 мм" value="× 1.2 к площади" color="text-amber-600" />
            <Row label="LED-лента + профиль + рассеиватель" value="пог.м периметра × стоимость/м" />
            <Row label="Блок питания" value="1 шт × цена" />
            <Row label="Датчик взмаха" value="800 ₽ (или из справочника)" />
            <Row label="Сенсорная кнопка" value="400 ₽ (или из справочника)" />
            <Row label="Пескоструй" value="м² × цена" />
            <Row label="Подложка (круг/овал)" value="2 000 ₽ по умолчанию" />
            <Row label="Сложная форма" value="+1 500 ₽ фиксировано" />
            <Row label="Сборка зеркала" value="1 шт × цена" />
          </div>
        </Card>
        <Card>
          <p className="text-[12px] font-semibold text-muted uppercase tracking-wider mb-3">Специальные коэффициенты</p>
          <div className="space-y-1">
            <Row label="Высота > 2800 мм" value="Площадь × 1.20" color="text-amber-600" />
            <Row label="Круглая / овальная форма" value="Реальная площадь (π × a × b)" />
            <Row label="Периметр круга" value="2πr (в метрах)" />
            <Row label="Периметр овала" value="Аппроксимация Рамануджана" />
          </div>
          {mirrorSettings && (
            <div className="mt-4 pt-4 border-t border-canvas">
              <p className="text-[12px] text-muted mb-2">Пример: себестоимость 10 000 ₽ →</p>
              <p className="text-[20px] font-semibold font-mono text-ink">
                {calcExample(10000, mirrorSettings)} ₽ цена клиенту
              </p>
              <p className="text-[11px] text-muted mt-1">
                Формула: 10 000 / (1 − {mirrorSettings.tax_percent}% − {mirrorSettings.default_margin}%)
              </p>
            </div>
          )}
        </Card>
        <Card color="border-emerald-100">
          <p className="text-[12px] font-semibold text-emerald-600 uppercase tracking-wider mb-3">Заработок менеджера — зеркала</p>
          <div className="space-y-1">
            <Row label="Базовая комиссия" value="2% от финальной цены" />
            <Row label="Бонус за надбавку" value="10% от прибыли сверх стандартной маржи" color="text-emerald-600" />
            <Row label="Итого менеджеру" value="Base + Upsell бонус" />
          </div>
          <p className="text-[11px] text-muted mt-3">
            Менеджер получает базу всегда. Upsell-бонус — только если маржа продажи выше стандартной (целевой).
          </p>
        </Card>
      </Section>

      {/* ── 4. ДУШЕВЫЕ ── */}
      <Section title="4. Душевые перегородки">
        <Card color="border-cyan-100">
          <p className="text-[12px] font-semibold text-cyan-600 uppercase tracking-wider mb-3">Тир-система</p>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-canvas rounded-lg p-4">
              <p className="text-[13px] font-semibold text-ink mb-2">Бюджет</p>
              <div className="space-y-1">
                <Row label="Коэф. фурнитуры" value="× 0.60" />
                <Row label="Расходы%" value={`${showerBudget?.tax_percent ?? 33}%`} color="text-amber-600" />
                <Row label="Цвета" value="Хром, Чёрный, Белый" />
              </div>
            </div>
            <div className="bg-canvas rounded-lg p-4">
              <p className="text-[13px] font-semibold text-ink mb-2">Стандарт</p>
              <div className="space-y-1">
                <Row label="Коэф. фурнитуры" value="× 1.00" />
                <Row label="Расходы%" value={`${showerStd?.tax_percent ?? 39}%`} color="text-amber-600" />
                <Row label="Цвета" value="Хром, Чёрный, Бронза, Золото, Белый" />
              </div>
            </div>
          </div>
        </Card>
        <Card>
          <p className="text-[12px] font-semibold text-muted uppercase tracking-wider mb-3">Коэффициенты цвета фурнитуры</p>
          <div className="space-y-1">
            <Row label="Хром" value="× 1.00 (базовый)" />
            <Row label="Белый" value="× 1.15" />
            <Row label="Чёрный" value="× 1.25" color="text-amber-600" />
            <Row label="Бронза" value="× 1.30" color="text-amber-600" />
            <Row label="Золото" value="× 1.45" color="text-red-600" />
          </div>
          <p className="text-[11px] text-muted mt-3">
            Золото на 45% дороже хрома. Менеджер должен объяснить клиенту разницу заранее.
          </p>
        </Card>
        <Card>
          <p className="text-[12px] font-semibold text-muted uppercase tracking-wider mb-3">BOM — что входит в себестоимость</p>
          <div className="space-y-1">
            <Row label="Стекло закалённое" value="м² × цена/м² (включая закалку)" />
            <Row label="Фурнитура" value="hardwareBase × tierMultiplier × colorMultiplier" />
          </div>
        </Card>
        <Card color="border-orange-100">
          <p className="text-[12px] font-semibold text-orange-600 uppercase tracking-wider mb-3">Edge cases — нестандартные ситуации</p>
          <div className="space-y-1">
            <Row label="Угловая кабина" value="Площадь = (width + width2) × height" />
            <Row label="Стандартный каталог" value="Фурнитура выбирается из каталога по позициям" />
            <Row label="Толщина стекла 10 мм" value="Дороже 8 мм — проверьте цену в материалах" color="text-amber-600" />
            <Row label="Монтаж" value="cost_price × glassCount (по стёклам)" />
            <Row label="Подъём на этаж" value="cost_price × количество этажей" />
          </div>
        </Card>
      </Section>

      {/* ── 5. ЛОФТ ── */}
      <Section title="5. Лофт-перегородки">
        <Card color="border-orange-100">
          <p className="text-[12px] font-semibold text-orange-600 uppercase tracking-wider mb-3">Геометрия — как считается площадь и металл</p>
          <Formula
            formula="Длина профиля = 2×(W+H) + (sections−1)×H + divisions×W  (мм → пог.м)"
            note="Внешний контур + вертикальные стойки + горизонтальные перемычки"
          />
          <Formula
            formula="Площадь стекла ≈ (openingW × openingH) × (sections × (divisions+1))"
            note="Каждое стекло в проёме: вычитается рамка 25 мм с каждой стороны"
          />
          <Formula
            formula="Штапик = 2 × (openingW + openingH) × openingsCount  (пог.м)"
            note="Периметр всех стеклянных проёмов"
          />
        </Card>
        <Card>
          <p className="text-[12px] font-semibold text-muted uppercase tracking-wider mb-3">BOM лофта</p>
          <div className="space-y-1">
            <Row label="Профиль 40×20" value="пог.м × цена/м" />
            <Row label="Штапик 15×15" value="пог.м × цена/м" />
            <Row label="Уплотнитель" value="пог.м × цена/м" />
            <Row label="Производственные расходники" value="м² × цена/м²" />
            <Row label="Работа сварщика" value="м² × цена/м²" />
            <Row label="Сборка лофт" value="м² × цена/м²" />
            <Row label="Стекло" value="м² стекла × цена/м²" />
            <Row label="Закалка" value="м² стекла × цена" />
            <Row label="Покраска" value="max(минимум, м² × цена/м²)" color="text-amber-600" />
            <Row label="Зеркальная плёнка" value="м² × цена из справочника услуг" />
            <Row label="Фурнитура" value="Из справочника hardware_items" />
          </div>
        </Card>
        {loftSettings && (
          <Card>
            <p className="text-[12px] font-semibold text-muted uppercase tracking-wider mb-2">Пример расчёта лофта 2000×2200 мм, 1 секция:</p>
            <div className="space-y-1">
              <Row label="Площадь" value={`${(2000 * 2200 / 1_000_000).toFixed(2)} м²`} />
              <Row label="Длина профиля" value={`${((2*(2000+2200))/1000).toFixed(2)} пог.м`} />
              <Row label="При себестоимости 15 000 ₽" value={`${calcExample(15000, loftSettings)} ₽ клиенту`} color="text-emerald-600" />
            </div>
          </Card>
        )}
      </Section>

      {/* ── 6. ЗАРАБОТОК МЕНЕДЖЕРА ── */}
      <Section title="6. Система заработка менеджеров">
        <Card color="border-emerald-100">
          <p className="text-[13px] text-ink-soft mb-4">
            Заработок состоит из двух частей. Это мотивирует менеджеров продавать по хорошей цене, а не «просто закрыть сделку».
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-emerald-50 rounded-lg p-4 border border-emerald-200">
              <p className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wider mb-2">Базовая комиссия</p>
              <p className="text-[22px] font-semibold text-emerald-800">2%</p>
              <p className="text-[12px] text-emerald-600">от финальной цены продажи</p>
              <p className="text-[11px] text-emerald-600 mt-2">Всегда, при любой продаже</p>
            </div>
            <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
              <p className="text-[11px] font-semibold text-blue-700 uppercase tracking-wider mb-2">Upsell-бонус</p>
              <p className="text-[22px] font-semibold text-blue-800">10%</p>
              <p className="text-[12px] text-blue-600">от прибыли сверх стандартной маржи</p>
              <p className="text-[11px] text-blue-600 mt-2">Только если маржа выше целевой</p>
            </div>
          </div>
          <Formula
            formula="Upsell = (finalPrice − stdFinalPrice − tax(extra)) × 10%"
            note="stdFinalPrice — цена при стандартной марже и тех же условиях (скидка, партнёр)"
          />
        </Card>
      </Section>

      {/* ── 7. СКИДКИ ── */}
      <Section title="7. Политика скидок">
        <Card color="border-red-100">
          <div className="grid grid-cols-2 gap-6">
            <div>
              <p className="text-[12px] font-semibold text-muted uppercase tracking-wider mb-3">Менеджер может дать</p>
              <div className="space-y-1">
                {defSettings && <Row label="Максимум без согласования" value={`${defSettings.max_discount_percent}%`} color="text-amber-600" />}
                <Row label="Условие" value="Маржа остаётся выше минимума" />
                <Row label="UI" value="Жёлтое предупреждение при превышении" />
              </div>
            </div>
            <div>
              <p className="text-[12px] font-semibold text-muted uppercase tracking-wider mb-3">Требует согласования</p>
              <div className="space-y-1">
                <Row label="Скидка выше лимита" value="Нужен апрув руководителя" color="text-red-600" />
                <Row label="Маржа ниже минимума" value="Блокировка / апрув" color="text-red-600" />
                <Row label="Форма" value="Заказ попадает в pending_approval" />
              </div>
            </div>
          </div>
        </Card>
        <Card>
          <p className="text-[12px] font-semibold text-muted uppercase tracking-wider mb-3">Когда можно давать скидку</p>
          <div className="space-y-2">
            {[
              ['✅ Постоянный клиент', 'Скидка 5–10%, если история есть'],
              ['✅ Большой заказ (несколько позиций)', 'Скидка на весь пакет'],
              ['✅ Горящий slot', 'Заполнить производство — можно снизить'],
              ['⚠️ Хочет дешевле конкурента', 'Проверить реальную ситуацию — часто не стоит'],
              ['❌ Просто торгуется', 'Стоять на цене — ценность важнее скидки'],
              ['❌ Маржа уже ниже минимума', 'Нельзя. Нужен апрув или отказ от сделки'],
            ].map(([case_, rule]) => (
              <div key={case_} className="flex gap-3">
                <span className="text-[13px] font-medium text-ink w-64 flex-shrink-0">{case_}</span>
                <span className="text-[13px] text-ink-soft">{rule}</span>
              </div>
            ))}
          </div>
        </Card>
      </Section>

      {/* ── 8. B2B ── */}
      <Section title="8. B2B калькулятор — особенности">
        <Card color="border-purple-100">
          <p className="text-[13px] text-ink-soft mb-4">
            B2B — принципиально другая модель. Здесь явный НДС 22%, отход материала и индивидуальные цены.
          </p>
          <div className="space-y-1">
            <Row label="НДС" value="22% (явно выделяется)" color="text-amber-600" />
            <Row label="Отход стекла" value="15–35% в зависимости от типа" />
            <Row label="Отход зеркала" value="18%" />
            <Row label="Отход сатина" value="22%" />
            <Row label="Отход рифлёного" value="30–35%" />
            <Row label="Торцевая обработка" value="40 ₽/пог.м" />
            <Row label="Транспорт на закалку" value="77 ₽/шт" />
            <Row label="Упаковка (гофрокартон)" value="120 ₽/м²" />
          </div>
          <Formula
            formula="Стоимость материала (с НДС) = Площадь × (1 + Отход%) × Цена/м²"
            note="Цена клиенту — прайс m²; маржа = (1 − costEx / saleEx) × 100%"
          />
        </Card>
      </Section>

      {/* ── 9. SMART PRICING ── */}
      <Section title="9. Динамическое ценообразование — архитектура">
        <Card color="border-indigo-100">
          <p className="text-[13px] text-ink-soft mb-4">
            Система готова к подключению динамических коэффициентов. Таблица <code className="text-[12px] bg-canvas px-1 rounded">coefficients</code> уже есть в БД.
          </p>
          <div className="space-y-3">
            {[
              { trigger: 'Высокая загрузка цеха', effect: 'Маржа +5%, цена выше' },
              { trigger: 'Низкая загрузка', effect: 'Разрешить скидку до минимума без апрув' },
              { trigger: 'Срочный заказ (< 3 дней)', effect: 'Коэффициент ×1.20–1.30' },
              { trigger: 'Сложный монтаж (> 5 этаж)', effect: '+₽2000–5000 к монтажу' },
              { trigger: 'VIP клиент', effect: 'Персональная цена из client_ownership' },
              { trigger: 'Сезонный пик (лето)', effect: 'Маржа +3–5%' },
            ].map(({ trigger, effect }) => (
              <div key={trigger} className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-indigo-400 flex-shrink-0" />
                <span className="text-[13px] text-ink-soft w-60 flex-shrink-0">{trigger}</span>
                <span className="text-[13px] font-medium text-ink">{effect}</span>
              </div>
            ))}
          </div>
        </Card>
      </Section>

      {/* ── 10. ЧЕКЛИСТ OWNER ── */}
      <Section title="10. Чеклист финансового управления">
        <Card color="border-amber-100">
          <p className="text-[12px] font-semibold text-amber-700 uppercase tracking-wider mb-4">Ежемесячные проверки для собственника</p>
          <div className="space-y-2">
            {[
              'Посмотреть P&L — сравнить с прошлым месяцем',
              'Проверить среднюю маржу по менеджерам в Аналитике',
              'Найти товары с маржой < мин — понять причину',
              'Проверить, нет ли заказов с необоснованными скидками',
              'Актуализировать цены в справочнике Материалы',
              'Проверить цены в справочнике Услуги (монтаж, доставка)',
              'Проверить financial_settings — пороги маржи и лимиты скидок',
              'Проверить заработки менеджеров — соответствуют ли плану',
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <div className="w-5 h-5 rounded border-2 border-amber-300 flex-shrink-0 mt-0.5" />
                <span className="text-[13px] text-ink-soft">{item}</span>
              </div>
            ))}
          </div>
        </Card>
      </Section>

      {/* Footer */}
      <div className="mt-8 pt-6 border-t border-line text-center">
        <p className="text-[12px] text-muted">
          MGlass Pricing Manual · Документ актуален для текущей версии платформы
        </p>
        <p className="text-[11px] text-faint mt-1">
          Изменить пороги маржи можно в <a href="/admin/settings" className="underline hover:text-ink-soft">Финансовых настройках</a>
        </p>
      </div>

    </div>
  )
}
