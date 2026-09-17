// Единый источник правды по флажкам квалификации заявок Авито.
// Читают: скоринг (scoreLead), бот (avitoManagerRuntime), классификатор импорта,
// карточка лида /crm/[id]. Добавить/убрать флаг — правка ТОЛЬКО здесь.
//
// Идея: вместо одного непрозрачного score 0–100 лид описывается набором дискретных
// флажков. Из них детерминированно (в коде, не моделью) считается готовность и
// решение «отдать менеджеру».

export type FlagGroup = 'core' | 'support' | 'info' | 'disqualify'

export type FlagKey =
  | 'product' | 'sizes' | 'finish_known' | 'contact'
  | 'place' | 'photo' | 'ready_measure' | 'measure_agreed' | 'address_known' | 'object_ready'
  | 'price_asked' | 'price_ok' | 'price_quoted' | 'b2b' | 'repeat_referral' | 'timeline' | 'budget'
  | 'in_zone' | 'object_type' | 'stall'
  | 'not_our_profile' | 'refused' | 'spam'

export type LeadFlags = Partial<Record<FlagKey, boolean>>

export type FlagDef = {
  key: FlagKey
  label: string          // как показываем менеджеру в карточке
  group: FlagGroup
  weight: number         // вклад в readiness (для не-disqualify групп)
  isCore?: boolean       // входит в портрет клиента — собран портрет, клиент уходит менеджеру
  askPriority?: number   // порядок, в котором бот узнаёт недостающее (меньше — раньше)
  ask?: string           // подсказка боту: что узнать, одним коротким вопросом
  desc?: string          // подсказка модели: когда ставить флаг
}

// Портрет клиента по решению владельца 17.09.2026: изделие, размеры, готова ли
// чистовая отделка, телефон. Собран — клиент сразу у менеджера, бот не тянет
// разговор дальше. Место установки, фото, адрес, согласие на замер бот больше не
// добывает: это работа менеджера. Факты (стоимость замера, условия) — только из
// базы знаний, здесь их нет намеренно.
export const FLAGS: FlagDef[] = [
  // 🎯 Портрет клиента
  { key: 'product', label: 'Изделие определено', group: 'core', weight: 3, isCore: true, askPriority: 0,
    ask: 'какое изделие нужно',
    desc: 'клиент назвал изделие нашего профиля (душевая/зеркало/лофт/стекло)' },
  { key: 'sizes', label: 'Размеры', group: 'core', weight: 3, isCore: true, askPriority: 1,
    ask: 'примерные размеры',
    desc: 'есть размеры хотя бы примерные' },
  { key: 'finish_known', label: 'Известно про чистовую отделку', group: 'core', weight: 2, isCore: true, askPriority: 2,
    ask: 'готова ли чистовая отделка (плитка, поддон)',
    desc: 'клиент ответил, готова ли чистовая отделка — неважно, да или нет' },
  { key: 'contact', label: 'Телефон получен', group: 'core', weight: 3, isCore: true, askPriority: 3,
    ask: 'телефон, чтобы менеджер связался',
    desc: 'клиент оставил номер телефона' },

  // ⚡ Усиливающие — видны менеджеру, бот их не выспрашивает
  { key: 'place', label: 'Место/тип установки', group: 'support', weight: 1,
    desc: 'понятно, где и как ставится (ниша/угол/проём/стена)' },
  { key: 'photo', label: 'Фото места установки', group: 'support', weight: 2,
    desc: 'клиент прислал фото проёма/места установки' },
  { key: 'object_ready', label: 'Чистовая отделка готова', group: 'support', weight: 2,
    desc: 'клиент подтвердил: чистовая отделка готова (плитка выложена, поддон/ванна стоят)' },
  { key: 'price_asked', label: 'Спросил цену', group: 'support', weight: 2,
    desc: 'клиент спросил цену или стоимость — сигнал покупки' },
  { key: 'ready_measure', label: 'Готов на замер', group: 'support', weight: 2,
    desc: 'клиент сам заговорил о замере или не против выезда' },
  { key: 'measure_agreed', label: 'Согласился на замер', group: 'support', weight: 2,
    desc: 'клиент явно согласился на замер' },
  { key: 'address_known', label: 'Адрес объекта', group: 'support', weight: 1,
    desc: 'известен адрес объекта' },
  { key: 'price_ok', label: 'Цена устроила', group: 'support', weight: 2,
    desc: 'цена названа и клиента устроила (важно: «дорого» — НЕ ставит этот флаг и НЕ отказ)' },
  { key: 'price_quoted', label: 'Цена озвучена', group: 'support', weight: 1,
    desc: 'клиенту назвали цену' },
  { key: 'b2b', label: 'Дизайнер / прораб / опт', group: 'support', weight: 2,
    desc: 'профессиональный покупатель: дизайнер, прораб, опт' },
  { key: 'repeat_referral', label: 'Повторный / по рекомендации', group: 'support', weight: 2,
    desc: 'уже покупал у нас или пришёл по рекомендации — приоритетный клиент' },
  { key: 'timeline', label: 'Есть сроки', group: 'support', weight: 1,
    desc: 'есть срок или привязка к ремонту' },
  { key: 'budget', label: 'Бюджет подтверждён', group: 'support', weight: 1,
    desc: 'клиент назвал/подтвердил бюджет' },
  { key: 'in_zone', label: 'Москва / МО', group: 'support', weight: 1,
    desc: 'объект в Москве или области' },

  // ℹ️ Инфо-сегментация и состояние
  { key: 'object_type', label: 'Тип объекта известен', group: 'info', weight: 1,
    desc: 'выяснен тип объекта: квартира / частный дом / коммерция' },
  { key: 'stall', label: 'Отложен (ремонт/отпуск/позже)', group: 'info', weight: 0,
    desc: 'клиент отложил: «ремонт идёт», «в отпуске», «позже» — НЕ отказ' },

  // ⛔ Дисквалификация — гасит лид (readiness → 0, статус → refused)
  { key: 'not_our_profile', label: 'Не наш профиль', group: 'disqualify', weight: 0,
    desc: 'запрос не по нашему профилю (что не делаем — в базе знаний)' },
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
