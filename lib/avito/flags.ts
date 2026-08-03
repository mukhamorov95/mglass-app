// Единый источник правды по флажкам квалификации заявок Авито.
// Читают: скоринг (scoreLead), бот (avitoManagerRuntime), классификатор импорта,
// карточка лида /crm/[id]. Добавить/убрать флаг — правка ТОЛЬКО здесь.
//
// Идея: вместо одного непрозрачного score 0–100 лид описывается набором дискретных
// флажков. Из них детерминированно (в коде, не моделью) считается готовность и
// «светофор». Как только собрано ядро (или клиент готов на замер + дал телефон) —
// лид загорается 🟢 и уходит живому менеджеру.

export type FlagGroup = 'core' | 'support' | 'info' | 'disqualify'

export type FlagKey =
  | 'product' | 'sizes' | 'place' | 'contact'
  | 'photo' | 'ready_measure' | 'price_ok' | 'price_quoted'
  | 'b2b' | 'repeat_referral' | 'timeline' | 'budget' | 'in_zone' | 'object_type'
  | 'not_our_profile' | 'refused' | 'spam'

export type LeadFlags = Partial<Record<FlagKey, boolean>>

export type FlagDef = {
  key: FlagKey
  label: string          // как показываем менеджеру в карточке
  group: FlagGroup
  weight: number         // вклад в readiness (для не-disqualify групп)
  isCore?: boolean       // входит в «ядро» заявки
  askPriority?: number   // порядок, в котором бот добывает недостающий флаг (меньше — раньше)
  ask?: string           // подсказка боту: как добыть флаг у клиента
  desc?: string          // подсказка боту/модели: когда ставить флаг
}

export const FLAGS: FlagDef[] = [
  // 🎯 Ядро — база заявки
  { key: 'product', label: 'Продукт определён', group: 'core', weight: 3, isCore: true, askPriority: 0,
    ask: 'уточни, что нужно: душевая / зеркало / лофт-перегородка / стекло',
    desc: 'клиент назвал изделие нашего профиля (душевая/зеркало/лофт/стекло)' },
  { key: 'sizes', label: 'Размеры проёма', group: 'core', weight: 3, isCore: true, askPriority: 1,
    ask: 'попроси размеры проёма (хотя бы примерно, в см)',
    desc: 'есть размеры хотя бы примерные' },
  { key: 'place', label: 'Место/тип установки', group: 'core', weight: 2, isCore: true, askPriority: 2,
    ask: 'уточни, куда ставим: ниша / угол / вдоль стены / проём',
    desc: 'понятно, где и как ставится (ниша/угол/проём/стена)' },
  { key: 'contact', label: 'Телефон получен', group: 'core', weight: 3, isCore: true, askPriority: 4,
    ask: 'мягко попроси телефон, чтобы согласовать замер и прислать расчёт',
    desc: 'клиент оставил номер телефона' },

  // ⚡ Усиливающие — ускоряют/утяжеляют заявку
  { key: 'photo', label: 'Фото места установки', group: 'support', weight: 3, askPriority: 3,
    ask: 'попроси фото проёма/места, где будет стоять изделие — так точнее расчёт и замер',
    desc: 'клиент прислал фото проёма/места установки' },
  { key: 'ready_measure', label: 'Готов на замер', group: 'support', weight: 3, askPriority: 5,
    ask: 'предложи бесплатный замер и получи согласие на выезд',
    desc: 'клиент согласен на замер/выезд — сильнейший сигнал покупки' },
  { key: 'price_ok', label: 'Цена устроила', group: 'support', weight: 2,
    desc: 'цена названа и клиента устроила (важно: «дорого» — НЕ ставит этот флаг и НЕ отказ)' },
  { key: 'price_quoted', label: 'Цена озвучена', group: 'support', weight: 1,
    desc: 'бот назвал предварительную цену' },
  { key: 'b2b', label: 'Дизайнер / прораб / опт', group: 'support', weight: 2,
    desc: 'профессиональный покупатель: дизайнер, прораб, опт' },
  { key: 'repeat_referral', label: 'Повторный / по рекомендации', group: 'support', weight: 2,
    desc: 'уже покупал у нас или пришёл по рекомендации — приоритетный клиент' },
  { key: 'timeline', label: 'Есть сроки', group: 'support', weight: 1,
    desc: 'есть срок или привязка к ремонту' },
  { key: 'budget', label: 'Бюджет подтверждён', group: 'support', weight: 1,
    desc: 'клиент назвал/подтвердил бюджет' },
  { key: 'in_zone', label: 'Москва / МО', group: 'support', weight: 1,
    desc: 'объект в Москве или области (зона монтажа)' },

  // ℹ️ Инфо-сегментация
  { key: 'object_type', label: 'Тип объекта известен', group: 'info', weight: 1,
    desc: 'выяснен тип объекта: квартира / частный дом / коммерция' },

  // ⛔ Дисквалификация — гасит лид (readiness → 0, статус → refused)
  { key: 'not_our_profile', label: 'Не наш профиль', group: 'disqualify', weight: 0,
    desc: 'запрос не наш профиль: автостёкла, ремонт стеклопакетов, мебель без стекла' },
  { key: 'refused', label: 'Явный отказ', group: 'disqualify', weight: 0,
    desc: 'клиент явно отказался («не интересно / уже купил / передумал»); «дорого» сюда НЕ входит' },
  { key: 'spam', label: 'Спам / нерелевант', group: 'disqualify', weight: 0,
    desc: 'спам или нерелевантное сообщение' },
]

export const FLAG_BY_KEY = Object.fromEntries(FLAGS.map(f => [f.key, f])) as Record<FlagKey, FlagDef>
export const CORE_KEYS: FlagKey[] = FLAGS.filter(f => f.isCore).map(f => f.key)
export const POSITIVE_FLAGS: FlagDef[] = FLAGS.filter(f => f.group !== 'disqualify')
export const DISQUALIFY_KEYS: FlagKey[] = FLAGS.filter(f => f.group === 'disqualify').map(f => f.key)

// Порядок, в котором бот добывает недостающие флаги (по одному за сообщение).
export const ASK_ORDER: FlagKey[] = FLAGS
  .filter(f => f.askPriority != null)
  .sort((a, b) => (a.askPriority! - b.askPriority!))
  .map(f => f.key)
