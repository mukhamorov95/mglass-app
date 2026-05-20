'use client'

import { useState, useEffect } from 'react'

// Каждый новый блок получает уникальный id.
// Добавь сюда id нового блока — он подсветится жёлтым пока не нажата кнопка.
const NEW_ITEMS = ['daily-checklist', 'responsibilities', 'system-buying', 'system-logistics', 'kpi', 'mistakes', 'tools']

const STORAGE_KEY = 'guide_acknowledged_v1'

function useAcknowledged() {
  const [acked, setAcked] = useState<Set<string>>(new Set())

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
      setAcked(new Set(stored))
    } catch { /* ignore */ }
  }, [])

  function acknowledge(id: string) {
    setAcked(prev => {
      const next = new Set(prev)
      next.add(id)
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...next])) } catch { /* ignore */ }
      return next
    })
  }

  return { acked, acknowledge }
}

export default function GuidePage() {
  const { acked, acknowledge } = useAcknowledged()
  const allAcked = NEW_ITEMS.every(id => acked.has(id))

  return (
    <div className="min-h-screen bg-[#f8f8f7] p-6">
      <div className="max-w-3xl mx-auto space-y-5">

        {/* Заголовок */}
        <div>
          <h1 className="text-[18px] font-semibold text-[#111110]">Регламент: Логист / Закупщик</h1>
          <p className="text-[12px] text-[#9a9a95] mt-0.5">Вера — MGlass, версия май 2025</p>
        </div>

        {/* Баннер "пополняется" */}
        <div className="bg-[#111110] text-white rounded-xl px-6 py-5">
          <p className="text-[22px] font-bold leading-tight">📌 Регламент постоянно пополняется.</p>
          <p className="text-[15px] text-[#a0a09a] mt-1">Новые разделы подсвечены жёлтым — прочитай и нажми «Ознакомилась».</p>
          {allAcked ? (
            <p className="mt-3 text-[13px] text-emerald-400 font-semibold">✓ Все разделы прочитаны</p>
          ) : (
            <p className="mt-3 text-[13px] text-amber-400 font-semibold">
              {NEW_ITEMS.filter(id => !acked.has(id)).length} непрочитанных разделов
            </p>
          )}
        </div>

        {/* Главная цель */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-emerald-50 border border-emerald-100 rounded-xl px-5 py-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 mb-1">🛒 Закупщик — цель</p>
            <p className="text-[13px] text-[#111110] font-medium leading-snug">Обеспечить производство материалами по лучшим ценам в нужные сроки.</p>
            <p className="text-[11px] text-[#6b6b66] mt-1">Результат: непрерывное производство без простоев.</p>
          </div>
          <div className="bg-orange-50 border border-orange-100 rounded-xl px-5 py-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-orange-600 mb-1">🚚 Логист — цель</p>
            <p className="text-[13px] text-[#111110] font-medium leading-snug">Организовать доставку готовых изделий клиентам вовремя и без повреждений.</p>
            <p className="text-[11px] text-[#6b6b66] mt-1">Результат: заказ клиенту в целости и в срок.</p>
          </div>
        </div>

        <NewSection id="daily-checklist" title="☀️ Ежедневный чеклист (утро)" acked={acked} onAck={acknowledge}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-[11px] font-bold text-emerald-600 uppercase tracking-wide mb-2">Закупки</p>
              <ul className="space-y-1.5">
                <Li>Критические позиции на складе (ниже минимума)</Li>
                <Li>Ожидаемые поставки сегодня</Li>
                <Li>Неоплаченные счета поставщиков</Li>
                <Li>Заявки от производства на материалы</Li>
                <Li>Цены конкурентов на ключевые позиции</Li>
              </ul>
            </div>
            <div>
              <p className="text-[11px] font-bold text-orange-600 uppercase tracking-wide mb-2">Логистика</p>
              <ul className="space-y-1.5">
                <Li>Маршрутный лист на сегодня</Li>
                <Li>Заказы, ожидающие доставки</Li>
                <Li>Наличие водителей</Li>
                <Li>Подтверждения доставок вчерашнего дня</Li>
                <Li>Обратная связь от клиентов о доставке</Li>
              </ul>
            </div>
          </div>
        </NewSection>

        <NewSection id="responsibilities" title="📋 Обязанности" acked={acked} onAck={acknowledge}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-[11px] font-bold text-emerald-600 uppercase tracking-wide mb-2">Закупки</p>
              <ul className="space-y-1.5">
                <Li>Мониторинг складских остатков</Li>
                <Li>Своевременное размещение заказов у поставщиков</Li>
                <Li>Переговоры об условиях поставки и ценах</Li>
                <Li>Контроль доставки и качества материалов</Li>
                <Li>Ведение базы поставщиков в системе</Li>
                <Li>Согласование платежей с финансовым директором</Li>
                <Li>Ежемесячный анализ цен</Li>
              </ul>
            </div>
            <div>
              <p className="text-[11px] font-bold text-orange-600 uppercase tracking-wide mb-2">Логистика</p>
              <ul className="space-y-1.5">
                <Li>Составление маршрутных листов доставок</Li>
                <Li>Координация водителей</Li>
                <Li>Отслеживание доставок в реальном времени</Li>
                <Li>Учёт стоимости доставки по зонам</Li>
                <Li>Решение проблем на маршруте</Li>
                <Li>Сдача документов о доставке</Li>
                <Li>Планирование маршрутов для снижения затрат</Li>
              </ul>
            </div>
          </div>
        </NewSection>

        <NewSection id="system-buying" title="💻 Работа в системе — Закупки" acked={acked} onAck={acknowledge}>
          <Steps>
            <Step n={1}>Открой раздел <b>Фурнитура душевых</b> → вкладка <b>Каталог</b>. Здесь весь каталог позиций.</Step>
            <Step n={2}>Нажми <b>«+ Добавить позицию»</b> чтобы добавить новую. Заполни: наименование, категорию, подкатегорию, где используется.</Step>
            <Step n={3}>В блоке <b>«Поведение в калькуляторе»</b> укажи срок поставки и остаток на складе.</Step>
            <Step n={4}>Добавь цены: поставщик × цвет × цена на сайте × скидка. Закупочная считается автоматически.</Step>
            <Step n={5}>Для обновления цены — найди позицию → <b>Изм.</b> → исправь строку цен → сохрани.</Step>
            <Step n={6}>Для быстрого обновления прямо в таблице — раскрой позицию, кликни на ячейку матрицы цен.</Step>
            <Step n={7}>Раздел <b>Поставщики</b> — справочник всех поставщиков. Добавляй новых здесь.</Step>
          </Steps>
          <div className="mt-3 text-[12px] text-[#6b6b66] bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
            ⚠️ Если поставщик прекратил поставку цвета — обнули цену (поставь 0), не удаляй строку. Менеджер увидит «нет у поставщика».
          </div>
        </NewSection>

        <NewSection id="system-logistics" title="🚚 Работа в системе — Логистика" acked={acked} onAck={acknowledge}>
          <Steps>
            <Step n={1}>Открой раздел <b>Заказы MGlass</b> — список всех активных заказов. Смотри статус «Готов к доставке».</Step>
            <Step n={2}>Открой <b>Маршрутный лист</b> — составь маршрут на день, добавь адреса доставок.</Step>
            <Step n={3}>Проверь <b>Заказы B2B</b> — оптовые заказы, которые тоже могут требовать доставки.</Step>
            <Step n={4}>После доставки отметь подтверждение в заказе. Приложи фото если нужно.</Step>
            <Step n={5}>При проблеме на маршруте — уведоми руководителя и зафиксируй в системе.</Step>
          </Steps>
        </NewSection>

        <NewSection id="kpi" title="📊 KPI" acked={acked} onAck={acknowledge}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-[11px] font-bold text-emerald-600 uppercase tracking-wide mb-2">Закупки</p>
              <ul className="space-y-1.5">
                <Li>Нет остановок производства из-за отсутствия материалов</Li>
                <Li>Экономия на закупках ≥ 5% от прошлого периода</Li>
                <Li>Срок поставки соответствует договорному</Li>
                <Li>База поставщиков актуальна</Li>
                <Li>Счета согласованы и оплачены в срок</Li>
              </ul>
            </div>
            <div>
              <p className="text-[11px] font-bold text-orange-600 uppercase tracking-wide mb-2">Логистика</p>
              <ul className="space-y-1.5">
                <Li>Доставки в срок ≥ 95%</Li>
                <Li>Повреждения при доставке &lt; 0.5%</Li>
                <Li>Стоимость доставки в рамках зон</Li>
                <Li>Все доставки подтверждены клиентом</Li>
              </ul>
            </div>
          </div>
        </NewSection>

        <NewSection id="mistakes" title="🚫 Типичные ошибки и запреты" acked={acked} onAck={acknowledge}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-[11px] font-bold text-red-500 uppercase tracking-wide mb-2">Не делать</p>
              <ul className="space-y-1.5">
                <Li>Закупать по первой цене без анализа рынка</Li>
                <Li>Не иметь 2–3 альтернативных поставщиков</Li>
                <Li>Допускать кассовые разрывы из-за авансов</Li>
                <Li>Не предупреждать клиента о времени доставки</Li>
                <Li>Не проверять упаковку перед отгрузкой</Li>
                <Li>Игнорировать жалобы на доставку</Li>
              </ul>
            </div>
            <div>
              <p className="text-[11px] font-bold text-red-700 uppercase tracking-wide mb-2">Запрещено</p>
              <ul className="space-y-1.5">
                <Li>Подписывать договоры с поставщиками без согласования</Li>
                <Li>Оплачивать счета без согласования с финдиром</Li>
                <Li>Отгружать без документов</Li>
                <Li>Менять маршрут без уведомления руководителя</Li>
              </ul>
            </div>
          </div>
        </NewSection>

        <NewSection id="tools" title="🛠️ Инструменты" acked={acked} onAck={acknowledge}>
          <div className="flex flex-wrap gap-2">
            {['MGlass Заказы', 'MGlass Маршрутный лист', 'Фурнитура душевых', 'Поставщики', 'Материалы', 'Admin Panel', 'Telegram', 'Яндекс.Карты', 'Excel'].map(t => (
              <span key={t} className="px-3 py-1 bg-[#f0f0ec] text-[#4b4b47] text-[12px] rounded-full">{t}</span>
            ))}
          </div>
        </NewSection>

      </div>
    </div>
  )
}

// ─── Блок с подсветкой и кнопкой ─────────────────────────────────────────────

function NewSection({
  id, title, children, acked, onAck,
}: {
  id: string
  title: string
  children: React.ReactNode
  acked: Set<string>
  onAck: (id: string) => void
}) {
  const isNew = !acked.has(id)

  return (
    <div className={`rounded-xl border px-6 py-5 transition-colors ${
      isNew ? 'bg-yellow-50 border-yellow-300' : 'bg-white border-[#e4e4e0]'
    }`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <h2 className="text-[14px] font-semibold text-[#111110]">
          {isNew && <span className="inline-block w-2 h-2 rounded-full bg-yellow-400 mr-2 mb-0.5" />}
          {title}
        </h2>
        {isNew && (
          <button
            onClick={() => onAck(id)}
            className="flex-shrink-0 text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-yellow-400 text-yellow-900 hover:bg-yellow-500 transition-colors whitespace-nowrap">
            ✓ Ознакомилась
          </button>
        )}
      </div>
      <div className="text-[13px] text-[#4b4b47] leading-relaxed">{children}</div>
    </div>
  )
}

function Steps({ children }: { children: React.ReactNode }) {
  return <ol className="space-y-2 mt-1">{children}</ol>
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[#111110] text-white text-[10px] font-bold flex items-center justify-center mt-0.5">{n}</span>
      <span className="text-[13px] text-[#4b4b47] leading-relaxed">{children}</span>
    </li>
  )
}

function Li({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2 items-start">
      <span className="text-[#c4c4be] mt-1 flex-shrink-0">•</span>
      <span>{children}</span>
    </li>
  )
}
