'use client'

// Visual map of data architecture: what reads from where

interface Node {
  id: string
  label: string
  type: 'table' | 'calc' | 'page' | 'api'
  color: string
}

interface Edge {
  from: string
  to: string
  label?: string
}

const TABLES: Node[] = [
  { id: 'materials',          label: 'materials',          type: 'table', color: 'bg-blue-50 border-blue-200 text-blue-800' },
  { id: 'glass_price_matrix', label: 'glass_price_matrix', type: 'table', color: 'bg-cyan-50 border-cyan-200 text-cyan-800' },
  { id: 'services',           label: 'services',           type: 'table', color: 'bg-green-50 border-green-200 text-green-800' },
  { id: 'hardware_items',     label: 'hardware_items',     type: 'table', color: 'bg-orange-50 border-orange-200 text-orange-800' },
  { id: 'shower_hardware',    label: 'shower_hardware_kits', type: 'table', color: 'bg-orange-50 border-orange-200 text-orange-800' },
  { id: 'financial_settings', label: 'financial_settings', type: 'table', color: 'bg-purple-50 border-purple-200 text-purple-800' },
  { id: 'b2b_materials',      label: 'b2b_materials',      type: 'table', color: 'bg-yellow-50 border-yellow-200 text-yellow-800' },
  { id: 'b2b_services',       label: 'b2b_services',       type: 'table', color: 'bg-yellow-50 border-yellow-200 text-yellow-800' },
  { id: 'calculations',       label: 'calculations',       type: 'table', color: 'bg-slate-50 border-slate-200 text-slate-700' },
  { id: 'message_queue',      label: 'message_queue',      type: 'table', color: 'bg-red-50 border-red-200 text-red-700' },
  { id: 'avito_messages_raw', label: 'avito_messages_raw', type: 'table', color: 'bg-red-50 border-red-200 text-red-700' },
]

const ARCHITECTURE: {
  section: string
  color: string
  rows: {
    table: string
    description: string
    usedBy: string[]
    editedAt: string
    note?: string
  }[]
}[] = [
  {
    section: 'Стекло',
    color: 'bg-cyan-50 border-cyan-200',
    rows: [
      {
        table: 'glass_price_matrix',
        description: 'Матрица цен: наименование × толщина. Себестоимость + продажная. Расход %.',
        usedBy: ['Справочники → Стекло', 'Калькулятор лофт (waste_pct)'],
        editedAt: '/admin/glass-prices',
        note: 'Единственный source of truth для цен на стекло',
      },
    ],
  },
  {
    section: 'Материалы (B2C)',
    color: 'bg-blue-50 border-blue-200',
    rows: [
      {
        table: 'materials',
        description: 'Главный справочник: профиль, расходники, работа, услуги, фурнитура (не стекло). 9 категорий.',
        usedBy: ['Калькулятор зеркало', 'Калькулятор душевая', 'Калькулятор лофт', 'Справочники → Материалы'],
        editedAt: '/admin/materials',
      },
    ],
  },
  {
    section: 'Услуги',
    color: 'bg-green-50 border-green-200',
    rows: [
      {
        table: 'services',
        description: 'Услуги (закалка, монтаж, доставка, покраска). Себестоимость + продажная цена.',
        usedBy: ['Все калькуляторы B2C', 'Справочники → Услуги'],
        editedAt: '/admin/services',
      },
      {
        table: 'b2b_services',
        description: 'B2B услуги с типом расчёта: %, ₽/м², фиксировано. Для B2B калькулятора.',
        usedBy: ['B2B Калькулятор'],
        editedAt: '/admin/b2b-services',
        note: 'Планируется: объединить с services через флаг product_type',
      },
    ],
  },
  {
    section: 'Фурнитура',
    color: 'bg-orange-50 border-orange-200',
    rows: [
      {
        table: 'hardware_items',
        description: 'Фурнитура для лофт-перегородок. Три типа: sliding, swing, universal.',
        usedBy: ['Калькулятор лофт', 'Фурнитура → Лофт'],
        editedAt: '/admin/hardware',
      },
      {
        table: 'shower_hardware_kits',
        description: 'Наборы фурнитуры для душевых (модели M1-M12 × цвета). Матрица цен.',
        usedBy: ['Калькулятор душевая', 'Фурнитура → Душевые'],
        editedAt: '/admin/shower-hardware',
        note: 'Отдельная структура — матрица модель × цвет',
      },
    ],
  },
  {
    section: 'B2B',
    color: 'bg-yellow-50 border-yellow-200',
    rows: [
      {
        table: 'b2b_materials',
        description: 'Материалы только для B2B: стекло/зеркало с waste_percent и passthrough флагом.',
        usedBy: ['B2B Калькулятор'],
        editedAt: '/admin/b2b-materials',
        note: 'Планируется: перевести B2B на glass_price_matrix + коэффициент клиента',
      },
      {
        table: 'b2b_leads',
        description: 'CRM для B2B контактов: компании, сегменты, статусы.',
        usedBy: ['B2B Clients'],
        editedAt: '/admin/b2b-clients',
      },
    ],
  },
  {
    section: 'Финансы',
    color: 'bg-purple-50 border-purple-200',
    rows: [
      {
        table: 'financial_settings',
        description: 'Единая запись: налог %, маржа по умолчанию, SLA дни, мин. заказ.',
        usedBy: ['Все калькуляторы', 'P&L отчёт'],
        editedAt: '/admin/settings',
      },
    ],
  },
  {
    section: 'Интеграции (Avito / AMO)',
    color: 'bg-red-50 border-red-200',
    rows: [
      {
        table: 'avito_messages_raw',
        description: 'Сырые входящие сообщения от Wazzup. Всегда сохраняется первым.',
        usedBy: ['Wazzup Webhook', 'Avito/AMO Monitor'],
        editedAt: '/admin/integrations',
      },
      {
        table: 'message_queue',
        description: 'Очередь обработки сообщений: статус, попытки, ошибки. Cron каждую минуту.',
        usedBy: ['process-queue cron', 'Avito/AMO Monitor'],
        editedAt: '/admin/integrations',
      },
    ],
  },
  {
    section: 'История расчётов',
    color: 'bg-slate-50 border-slate-200',
    rows: [
      {
        table: 'calculations',
        description: 'Все сохранённые расчёты менеджеров: продукт, параметры, цены, маржа.',
        usedBy: ['История расчётов', 'Дашборд', 'P&L'],
        editedAt: '/calculations',
      },
    ],
  },
]

const ROADMAP = [
  {
    status: 'todo',
    label: 'Перевести B2B калькулятор на glass_price_matrix',
    detail: 'Убрать b2b_materials, использовать коэффициент скидки клиента',
  },
  {
    status: 'todo',
    label: 'Объединить services + b2b_services через флаг',
    detail: 'Добавить поле scope: "b2c" | "b2b" | "all" в таблицу services',
  },
  {
    status: 'todo',
    label: 'Единый каталог фурнитуры с поставщиками',
    detail: 'Одна карточка → несколько поставщиков × цветов × цен. Таблица hardware_suppliers.',
  },
  {
    status: 'todo',
    label: 'Цельностеклянные конструкции',
    detail: 'Новый раздел фурнитуры/материалов для безрамных душевых',
  },
  {
    status: 'done',
    label: 'glass_price_matrix — матрица цен на стекло',
    detail: 'Реализовано. Расход %, себестоимость, продажная (только Владислав). Используется в лофт.',
  },
  {
    status: 'done',
    label: 'Очередь сообщений Avito/AMO',
    detail: 'avito_messages_raw + message_queue. Wazzup webhook → cron → AmoCRM.',
  },
]

export default function ArchitecturePage() {
  return (
    <div className="max-w-[1100px] mx-auto px-6 py-8">
      <div className="mb-8">
        <h1 className="text-[20px] font-semibold text-ink tracking-tight">Карта данных MGlass</h1>
        <p className="text-[13px] text-muted mt-1">
          Какие таблицы существуют, что они содержат, где редактируются и какими модулями используются.
        </p>
      </div>

      {/* Architecture table */}
      <div className="space-y-4 mb-10">
        {ARCHITECTURE.map(section => (
          <div key={section.section} className={`border rounded-xl overflow-hidden ${section.color}`}>
            <div className="px-4 py-2.5 border-b border-inherit">
              <h2 className="text-[13px] font-semibold text-ink">{section.section}</h2>
            </div>
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-inherit">
                  <th className="px-4 py-2 text-left font-semibold text-ink-soft w-[200px]">Таблица</th>
                  <th className="px-4 py-2 text-left font-semibold text-ink-soft">Содержимое</th>
                  <th className="px-4 py-2 text-left font-semibold text-ink-soft w-[220px]">Используется в</th>
                  <th className="px-4 py-2 text-left font-semibold text-ink-soft w-[160px]">Редактировать</th>
                </tr>
              </thead>
              <tbody>
                {section.rows.map(row => (
                  <tr key={row.table} className="border-t border-inherit">
                    <td className="px-4 py-3 font-mono text-[11px] text-ink font-semibold align-top">
                      {row.table}
                    </td>
                    <td className="px-4 py-3 text-ink-soft align-top">
                      {row.description}
                      {row.note && (
                        <p className="mt-1 text-[11px] text-amber-500 font-medium">⚡ {row.note}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <ul className="space-y-0.5">
                        {row.usedBy.map(u => (
                          <li key={u} className="text-[11px] text-ink-soft">• {u}</li>
                        ))}
                      </ul>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <a href={row.editedAt}
                        className="text-[11px] text-blue-600 hover:underline font-mono break-all">
                        {row.editedAt}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {/* Roadmap */}
      <div>
        <h2 className="text-[16px] font-semibold text-ink mb-4">Roadmap консолидации</h2>
        <div className="space-y-2">
          {ROADMAP.map((item, i) => (
            <div key={i} className={`flex items-start gap-3 px-4 py-3 rounded-xl border ${
              item.status === 'done'
                ? 'bg-green-50 border-green-200'
                : 'bg-surface border-line'
            }`}>
              <span className="text-[16px] mt-0.5 flex-shrink-0">{item.status === 'done' ? '✅' : '⬜'}</span>
              <div>
                <p className={`text-[13px] font-medium ${item.status === 'done' ? 'text-green-700 line-through' : 'text-ink'}`}>
                  {item.label}
                </p>
                <p className="text-[12px] text-muted mt-0.5">{item.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
