'use client'

import { useState, useEffect } from 'react'

// Добавь id нового раздела — он подсветится жёлтым до первого прочтения
const NEW_ITEMS = [
  'daily-checklist',
  'responsibilities',
  'production-requests',
  'system-procurement',
  'system-stock',
  'system-routes',
  'price-monitoring',
  'supplier-db',
  'vera-sergey',
  'system-logistics',
  'kpi',
  'mistakes',
  'tools',
  'future',
]

const STORAGE_KEY = 'guide_acknowledged_v2'

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
  const unread = NEW_ITEMS.filter(id => !acked.has(id)).length
  const allAcked = unread === 0

  return (
    <div className="min-h-screen bg-[#f8f8f7] p-6">
      <div className="max-w-3xl mx-auto space-y-5">

        <div>
          <h1 className="text-[18px] font-semibold text-[#111110]">Регламент: Логист / Закупщик</h1>
          <p className="text-[12px] text-[#9a9a95] mt-0.5">Вера — MGlass, версия май 2025</p>
        </div>

        {/* Баннер */}
        <div className="bg-[#111110] text-white rounded-xl px-6 py-5">
          <p className="text-[24px] font-extrabold leading-tight">📌 Регламент постоянно пополняется.</p>
          <p className="text-[15px] text-[#a0a09a] mt-1">Новые разделы подсвечены жёлтым — прочитай и нажми «Ознакомилась».</p>
          {allAcked ? (
            <p className="mt-3 text-[13px] text-emerald-400 font-semibold">✓ Все разделы прочитаны</p>
          ) : (
            <p className="mt-3 text-[13px] text-amber-400 font-semibold">{unread} непрочитанных разделов</p>
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

        {/* ─── РАЗДЕЛЫ ─── */}

        <NewSection id="daily-checklist" title="☀️ Ежедневный чеклист (утро)" acked={acked} onAck={acknowledge}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-[11px] font-bold text-emerald-600 uppercase tracking-wide mb-2">Закупки</p>
              <ul className="space-y-1.5">
                <Li>Критические позиции на складе (ниже минимума) — раздел «Критические остатки»</Li>
                <Li>Ожидаемые поставки сегодня</Li>
                <Li>Неоплаченные счета поставщиков — Канбан закупок</Li>
                <Li>Заявки от производства на материалы</Li>
                <Li>Цены конкурентов на ключевые позиции</Li>
              </ul>
            </div>
            <div>
              <p className="text-[11px] font-bold text-orange-600 uppercase tracking-wide mb-2">Логистика</p>
              <ul className="space-y-1.5">
                <Li>Маршрутный лист на сегодня — готовится накануне вечером</Li>
                <Li>Заказы, ожидающие доставки</Li>
                <Li>Наличие водителей</Li>
                <Li>Подтверждения доставок вчерашнего дня — прозвон клиентов или проверка в системе</Li>
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
                <Li>Мониторинг складских остатков вручную</Li>
                <Li>Своевременное размещение заказов у поставщиков</Li>
                <Li>Переговоры об условиях поставки и ценах</Li>
                <Li>Контроль доставки и качества материалов</Li>
                <Li>Ведение базы поставщиков в системе</Li>
                <Li>Согласование платежей с руководством</Li>
                <Li>Ежемесячный анализ цен</Li>
              </ul>
            </div>
            <div>
              <p className="text-[11px] font-bold text-orange-600 uppercase tracking-wide mb-2">Логистика</p>
              <ul className="space-y-1.5">
                <Li>Составление маршрутных листов для клиентских доставок</Li>
                <Li>Составление маршрутных листов к поставщикам</Li>
                <Li>Координация водителя Сергея Васильевича</Li>
                <Li>Учёт стоимости доставки по зонам</Li>
                <Li>Решение проблем на маршруте</Li>
                <Li>Подтверждение факта доставки (звонок клиенту)</Li>
                <Li>Планирование маршрутов для снижения затрат</Li>
              </ul>
            </div>
          </div>
        </NewSection>

        <NewSection id="production-requests" title="🏭 Заявки от производства" acked={acked} onAck={acknowledge}>
          <p className="text-[12px] text-[#6b6b66] mb-3">
            Производственный процесс: Дмитрий (монтаж) → Бигзат (производство) → Вера (закупка)
          </p>
          <Steps>
            <Step n={1}>Дмитрий или Бигзат сообщает о нехватке материала — <b>лично, в Telegram или через систему</b>.</Step>
            <Step n={2}>Вера проверяет склад в разделе <b>«Критические остатки»</b> — актуален ли сигнал.</Step>
            <Step n={3}>Если позиция ниже минимума — немедленно размещает заказ у поставщика. Если выше — объясняет, когда плановая закупка.</Step>
            <Step n={4}>Сообщает Дмитрию/Бигзату: ожидаемую дату поставки или дату ближайшей закупки.</Step>
            <Step n={5}>После получения материала — обновляет <b>остаток в системе</b> (раздел «Критические остатки»).</Step>
          </Steps>
          <div className="mt-3 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 text-[12px] text-[#4b4b47]">
            📌 Правило: производство не должно останавливаться ни дня. Если есть риск простоя — сразу уведоми руководителя.
          </div>
        </NewSection>

        <NewSection id="system-stock" title="📦 Работа в системе — Критические остатки" acked={acked} onAck={acknowledge}>
          <Steps>
            <Step n={1}>Открой раздел <b>«Критические остатки»</b> в меню слева (раздел Склад).</Step>
            <Step n={2}>По умолчанию видны только позиции с флагом «Критич. ★» — это ключевые позиции для мониторинга.</Step>
            <Step n={3}>Нажми <b>«Все позиции»</b> чтобы видеть весь склад целиком.</Step>
            <Step n={4}>Статусы: <b>Критично</b> (ниже минимума), <b>Внимание</b> (ниже рекомендуемого), <b>Норма</b>.</Step>
            <Step n={5}>Обнови факт. остаток в строке — появится кнопка <b>«Сохр.»</b> — нажми. Данные сохраняются в базу.</Step>
            <Step n={6}>Чтобы пометить позицию как критическую для мониторинга — нажми <b>«☆ Нет»</b> → станет <b>«★ Да»</b>.</Step>
          </Steps>
          <div className="mt-3 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 text-[12px] text-[#4b4b47]">
            ⚠️ Остатки <b>не обновляются автоматически</b>. Обновляй после каждой приёмки товара.
          </div>
        </NewSection>

        <NewSection id="system-procurement" title="💳 Работа в системе — Канбан закупок" acked={acked} onAck={acknowledge}>
          <p className="text-[12px] text-[#6b6b66] mb-3">
            Канбан отражает жизненный цикл каждого счёта от поставщика — от получения до закрытия.
          </p>
          <Steps>
            <Step n={1}>Открой раздел <b>«Канбан закупок»</b>. Видишь 8 колонок — стадии обработки счёта.</Step>
            <Step n={2}>Нажми <b>«+ Новая закупка»</b> — заполни поставщика, сумму, счёт, позиции, комментарий.</Step>
            <Step n={3}>Карточка появляется в первой колонке <b>«Получен счёт»</b>.</Step>
            <Step n={4}>Нажимай <b>«→ следующий статус»</b> по мере прохождения этапов.</Step>
            <Step n={5}>Если есть проблема — открой карточку → напиши в <b>«Проблема»</b>. Карточка выделится красным.</Step>
            <Step n={6}>Когда товар получен и закрыт — переведи в <b>«Закрыто»</b>.</Step>
          </Steps>
          <div className="mt-3 text-[12px] text-[#6b6b66]">
            Статусы: Получен счёт → На согласовании → Ожидает оплаты → Частично оплачен → Оплачен → В дороге → Самовывоз → Закрыто
          </div>
        </NewSection>

        <NewSection id="system-routes" title="🗺️ Работа в системе — Маршруты к поставщикам" acked={acked} onAck={acknowledge}>
          <p className="text-[12px] text-[#6b6b66] mb-3">
            Маршрутные листы к поставщикам составляются <b>накануне вечером</b> на следующий день.
          </p>
          <Steps>
            <Step n={1}>Открой раздел <b>«Маршруты к поставщикам»</b>.</Step>
            <Step n={2}>Выбери дату (завтра) и водителя → нажми <b>«+ Создать маршрут»</b>.</Step>
            <Step n={3}>Нажимай <b>«+ Добавить точку»</b> для каждого поставщика. Заполни: название, адрес, контакт, что забрать, номер заказа/счёта, часы работы.</Step>
            <Step n={4}>Точки нумеруются автоматически — выстраивай в логичный порядок (по geography или срочности).</Step>
            <Step n={5}>Нажми <b>«🖨 Распечатать»</b> — откроется печатная версия. Кнопка «Печать» → бумажный лист водителю.</Step>
            <Step n={6}>В день маршрута водитель отмечает статус каждой точки: В очереди / Выполнено / Проблема.</Step>
          </Steps>
          <div className="mt-3 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 text-[12px] text-[#4b4b47]">
            📌 Правило: маршрутный лист всегда должен быть готов накануне до 18:00. Сергей Васильевич должен знать план заранее.
          </div>
        </NewSection>

        <NewSection id="price-monitoring" title="📈 Мониторинг цен" acked={acked} onAck={acknowledge}>
          <p className="text-[12px] text-[#6b6b66] mb-3">
            Цель: покупать по рынку или ниже. Не переплачивать из-за лени проверить альтернативу.
          </p>
          <Steps>
            <Step n={1}><b>Еженедельно</b>: проверяй цены 3–5 основных поставщиков на ключевые позиции (фурнитура, стекло, комплектующие).</Step>
            <Step n={2}><b>Ежемесячно</b>: сравни закупочные цены прошлого месяца с текущими предложениями. Если разница &gt;5% — запрашивай переговоры.</Step>
            <Step n={3}>При получении нового прайса — обновляй цены в разделе <b>«Фурнитура душевых»</b> → позиция → строка цен.</Step>
            <Step n={4}>Для новых поставщиков: запрашивай прайс, вноси в систему как нового поставщика, добавляй тестовую закупку в Канбан.</Step>
            <Step n={5}>Правило двух поставщиков: на каждую ключевую позицию должно быть минимум <b>2 активных поставщика</b>.</Step>
          </Steps>
          <div className="mt-3 bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-[12px] text-[#4b4b47]">
            🚫 Запрещено покупать по первой предложенной цене без сравнения хотя бы с одним альтернативным поставщиком.
          </div>
        </NewSection>

        <NewSection id="supplier-db" title="🏢 База поставщиков" acked={acked} onAck={acknowledge}>
          <p className="text-[12px] text-[#6b6b66] mb-3">
            Все поставщики хранятся в разделе <b>«Поставщики»</b>. База должна быть актуальной.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <p className="text-[11px] font-bold text-[#111110] uppercase tracking-wide mb-2">Что вносить</p>
              <ul className="space-y-1.5">
                <Li>Полное название компании</Li>
                <Li>Адрес склада/офиса (для маршрутов)</Li>
                <Li>Контактное лицо + телефон + Telegram</Li>
                <Li>Категория поставок (фурнитура, стекло, расходники…)</Li>
                <Li>Режим работы</Li>
                <Li>Условия работы (отсрочка, предоплата, минималка)</Li>
              </ul>
            </div>
            <div>
              <p className="text-[11px] font-bold text-[#111110] uppercase tracking-wide mb-2">Правила</p>
              <ul className="space-y-1.5">
                <Li>Новый поставщик → сразу вноси в базу, не держи только в телефоне</Li>
                <Li>Поставщик прекратил работу → не удаляй, поставь статус «Неактивен»</Li>
                <Li>Обновляй контакты при каждом изменении</Li>
                <Li>На каждую категорию — минимум 2 поставщика</Li>
              </ul>
            </div>
          </div>
        </NewSection>

        <NewSection id="vera-sergey" title="🤝 Взаимодействие с Сергеем Васильевичем" acked={acked} onAck={acknowledge}>
          <p className="text-[12px] text-[#6b6b66] mb-3">
            Сергей Васильевич — водитель и кладовщик MGlass. Вера — его непосредственный координатор по логистике.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <p className="text-[11px] font-bold text-emerald-600 uppercase tracking-wide mb-2">Ежедневно</p>
              <ul className="space-y-1.5">
                <Li>Передаёт маршрутный лист (бумажный или сообщением)</Li>
                <Li>Проверяет готовность к выезду</Li>
                <Li>Принимает отчёт по каждой точке маршрута</Li>
                <Li>Фиксирует проблемы если есть</Li>
              </ul>
            </div>
            <div>
              <p className="text-[11px] font-bold text-orange-600 uppercase tracking-wide mb-2">Важно</p>
              <ul className="space-y-1.5">
                <Li>Сергей не планирует маршрут — только выполняет. Вера планирует.</Li>
                <Li>При отсутствии Сергея — Вера немедленно сообщает руководителю</Li>
                <Li>Все изменения маршрута — только через Веру, не напрямую</Li>
                <Li>Спорные ситуации с клиентами на маршруте — сразу звонок Вере</Li>
              </ul>
            </div>
          </div>
        </NewSection>

        <NewSection id="system-logistics" title="🚚 Работа в системе — Логистика доставок клиентам" acked={acked} onAck={acknowledge}>
          <Steps>
            <Step n={1}>Открой <b>«Заказы MGlass»</b> — ищи статус «Готов к доставке». Это заказы на сегодня/ближайшее время.</Step>
            <Step n={2}>Открой <b>«Маршрутный лист»</b> (доставки клиентам) — добавь адреса, удобное время, комментарии.</Step>
            <Step n={3}>Для B2B: открой <b>«B2B Заказы»</b> — проверь, есть ли готовые к отгрузке.</Step>
            <Step n={4}>Передай маршрут Сергею Васильевичу накануне. Убедись, что адреса верны.</Step>
            <Step n={5}>После доставки: позвони клиенту, уточни всё ли в порядке. Отметь статус в заказе.</Step>
            <Step n={6}>При повреждении или проблеме — сфотографируй, уведоми руководителя, зафиксируй в заказе.</Step>
          </Steps>
        </NewSection>

        <NewSection id="kpi" title="📊 KPI — Показатели работы" acked={acked} onAck={acknowledge}>
          <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 mb-3">
            <p className="text-[12px] font-semibold text-blue-700">🔧 Раздел KPI в системе находится в разработке.</p>
            <p className="text-[11px] text-blue-600 mt-0.5">Ниже — плановые показатели для самоконтроля.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-[11px] font-bold text-emerald-600 uppercase tracking-wide mb-2">Закупки</p>
              <ul className="space-y-1.5">
                <Li>Нет остановок производства из-за отсутствия материалов</Li>
                <Li>Экономия на закупках ≥ 5% к прошлому периоду</Li>
                <Li>Срок поставки соответствует договорному</Li>
                <Li>База поставщиков актуальна (0 устаревших контактов)</Li>
                <Li>Все счета согласованы и оплачены в срок</Li>
              </ul>
            </div>
            <div>
              <p className="text-[11px] font-bold text-orange-600 uppercase tracking-wide mb-2">Логистика</p>
              <ul className="space-y-1.5">
                <Li>Доставки в срок ≥ 95%</Li>
                <Li>Повреждения при доставке &lt; 0.5%</Li>
                <Li>Все доставки подтверждены звонком клиенту</Li>
                <Li>Стоимость доставки в рамках плановых зон</Li>
                <Li>Маршрутный лист готов накануне до 18:00</Li>
              </ul>
            </div>
          </div>
        </NewSection>

        <NewSection id="mistakes" title="🚫 Типичные ошибки и запреты" acked={acked} onAck={acknowledge}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-[11px] font-bold text-red-500 uppercase tracking-wide mb-2">Не делать</p>
              <ul className="space-y-1.5">
                <Li>Закупать по первой цене без сравнения с рынком</Li>
                <Li>Не иметь 2–3 альтернативных поставщиков на позицию</Li>
                <Li>Держать контакты поставщиков только в телефоне, не в системе</Li>
                <Li>Составлять маршрут в день поездки (поздно)</Li>
                <Li>Не предупреждать клиента о примерном времени доставки</Li>
                <Li>Не проверять упаковку перед отгрузкой</Li>
                <Li>Не обновлять остатки после приёмки товара</Li>
                <Li>Игнорировать жалобы на доставку</Li>
              </ul>
            </div>
            <div>
              <p className="text-[11px] font-bold text-red-700 uppercase tracking-wide mb-2">Запрещено</p>
              <ul className="space-y-1.5">
                <Li>Подписывать договоры с поставщиками без согласования</Li>
                <Li>Оплачивать счета без согласования с руководством</Li>
                <Li>Отгружать без документов</Li>
                <Li>Самостоятельно менять маршрут без уведомления руководителя</Li>
                <Li>Давать поставщику обещания о цене или объёме без согласования</Li>
                <Li>Принимать товар без проверки по накладной</Li>
              </ul>
            </div>
          </div>
        </NewSection>

        <NewSection id="tools" title="🛠️ Инструменты" acked={acked} onAck={acknowledge}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-[11px] font-bold text-[#111110] uppercase tracking-wide mb-2">Система MGlass</p>
              <div className="flex flex-wrap gap-2">
                {['Критические остатки', 'Канбан закупок', 'Маршруты к поставщикам', 'Заказы MGlass', 'Маршрутный лист', 'Фурнитура душевых', 'Поставщики', 'Материалы', 'B2B Заказы'].map(t => (
                  <span key={t} className="px-2.5 py-1 bg-[#f0f0ec] text-[#4b4b47] text-[11px] rounded-full">{t}</span>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[11px] font-bold text-[#111110] uppercase tracking-wide mb-2">Внешние</p>
              <div className="flex flex-wrap gap-2">
                {['Telegram', 'Яндекс.Карты', 'WhatsApp (поставщики)', 'Excel (резервно)'].map(t => (
                  <span key={t} className="px-2.5 py-1 bg-[#f0f0ec] text-[#4b4b47] text-[11px] rounded-full">{t}</span>
                ))}
              </div>
            </div>
          </div>
        </NewSection>

        <NewSection id="future" title="🔭 Что будет добавлено в систему" acked={acked} onAck={acknowledge}>
          <p className="text-[12px] text-[#6b6b66] mb-3">
            MGlass строит единый центр снабжения и логистики. Эти разделы появятся по мере готовности:
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-2">
              <FutureItem label="Карта поставщиков" desc="Визуальная карта всех поставщиков с маршрутами" />
              <FutureItem label="Отслеживание доставок" desc="GPS-трекинг маршрута в реальном времени" />
              <FutureItem label="Подтверждение доставки" desc="Клиент подписывает получение в системе" />
            </div>
            <div className="space-y-2">
              <FutureItem label="Обратная связь клиентов" desc="Оценка качества доставки от получателя" />
              <FutureItem label="Учёт логистических затрат" desc="Стоимость маршрутов, ГСМ, амортизация" />
              <FutureItem label="Оптимизация маршрутов" desc="Автоматическое построение оптимального маршрута" />
            </div>
          </div>
        </NewSection>

      </div>
    </div>
  )
}

// ─── Компоненты ──────────────────────────────────────────────────────────────

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

function FutureItem({ label, desc }: { label: string; desc: string }) {
  return (
    <div className="flex items-start gap-2 bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-3 py-2">
      <span className="text-[11px] font-bold text-[#9a9a95] mt-0.5 flex-shrink-0">🔧</span>
      <div>
        <p className="text-[12px] font-semibold text-[#6b6b66]">{label}</p>
        <p className="text-[11px] text-[#9a9a95]">{desc}</p>
      </div>
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
