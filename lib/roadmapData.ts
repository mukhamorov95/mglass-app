// Доска прогресса работ (/admin/roadmap). Обновляется в каждом PR вместе с
// кодом — что смёрджено, то и отмечено. Источник правды для владельца.

export type RoadmapStatus = 'done' | 'progress' | 'queue' | 'waiting'
export type RoadmapItem = { title: string; status: RoadmapStatus; note?: string; date?: string }
export type RoadmapSection = { title: string; icon: string; items: RoadmapItem[] }

export const ROADMAP_UPDATED = '20.07.2026, вечер'

export const ROADMAP: RoadmapSection[] = [
  {
    title: 'Деньги как учёт (Д)',
    icon: '💰',
    items: [
      { title: 'Архитектура: docs/ERP_MONEY_ARCHITECTURE.md', status: 'done', date: '20.07' },
      { title: 'Д1 — ядро платежей (payments, маржа, модули записи)', status: 'done', date: '20.07' },
      { title: 'Д2 — все кнопки оплат пишут в ядро + ночная сверка с бэкфиллом', status: 'queue' },
      { title: 'Д3 — импорт истории продаж (604+ строк) и маржи (662 заказа) + витрины CFO', status: 'queue' },
      { title: 'Д4 — 4 недели параллели → Google-таблицы закрываются', status: 'waiting', note: 'нужна дата закрытия (предложение: 01.09)' },
    ],
  },
  {
    title: 'Бухгалтерия (Б)',
    icon: '🧾',
    items: [
      { title: 'Б1 — раздел /accounting: фонды из ДДС, ввод операций, учётки Алёны и Екатерины', status: 'done', date: '20.07' },
      { title: 'Б2 — заявки на расходы + четверговый комитет', status: 'done', date: '20.07' },
      { title: 'Б3 — финнеделя чт–ср: наполнение фондов, пересчёт недельного плана', status: 'progress' },
      { title: 'Б4 — голосовые предложения бухгалтеров + импорт истории ДДС с 06.2024', status: 'queue' },
    ],
  },
  {
    title: 'AI-боты (Ф)',
    icon: '🤖',
    items: [
      { title: 'Аудит всех AI-контуров (3 отчёта)', status: 'done', date: '20.07' },
      { title: 'Ф1 — «клиентам пишет только Иван» + честные метрики агентов', status: 'done', date: '20.07' },
      { title: 'Ф2 — Иван на полную мощность (страж цен, склейка сообщений, телефон всегда, фоллоу-ап)', status: 'queue' },
      { title: 'Ф3 — вырезать мёртвый AI Владислава, конвейер оставить', status: 'queue' },
      { title: 'Ф4 — порядок в AI-инструментах (модели, дубли, мёртвое, меню)', status: 'queue' },
    ],
  },
  {
    title: 'Сделано сегодня (оперативка)',
    icon: '⚡',
    items: [
      { title: 'Лист рейса Воронеж — печать A4 без обрезаний', status: 'done', date: '20.07' },
      { title: 'Цех: «изделие готово» одной кнопкой (каскад этапов для Никиты)', status: 'done', date: '20.07' },
      { title: 'Монтажи: голосовая заявка (надиктовал → поля заполнились)', status: 'done', date: '20.07' },
      { title: 'Личная вкладка Влад: голос→задачи, финансы, спорт, советник 2×день', status: 'done', date: '20.07' },
      { title: 'CRM: настоящая защита данных (RLS) + живые тумблеры', status: 'done', date: '20.07' },
      { title: 'Sentry включён (не работал с мая), Vercel-логи, CI: линт 306→0', status: 'done', date: '20.07' },
    ],
  },
  {
    title: 'Решения владельца',
    icon: '🔑',
    items: [
      { title: 'Маржа продаж — видит только владелец (менеджерам — позже, отдельным решением)', status: 'done', date: '20.07' },
      { title: 'Список долгов из ДДС-книги — НЕ переносить (неактуален)', status: 'done', date: '20.07' },
      { title: 'РОП-ответственный за период параллели — владелец', status: 'done', date: '20.07' },
      { title: 'Дата закрытия Google-таблиц продаж (предложение 01.09) — подтвердить при Д4', status: 'waiting' },
      { title: 'Запись в amoCRM из анализа звонков (нарушает read-only) — решить при Ф4', status: 'waiting' },
    ],
  },
]
