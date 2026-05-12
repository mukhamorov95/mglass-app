'use client'

import { useState, useRef, useEffect } from 'react'

// ─── Data ─────────────────────────────────────────────────────────────────────

const SLIDES = [
  { id: 1, label: 'Кто мы' },
  { id: 2, label: 'Что мы делаем' },
  { id: 3, label: 'Возможности' },
  { id: 4, label: 'Для кого' },
  { id: 5, label: 'Почему мы' },
  { id: 6, label: 'Качество' },
  { id: 7, label: 'Кейсы' },
  { id: 8, label: 'Условия' },
  { id: 9, label: 'Как начать' },
  { id: 10, label: 'Контакты' },
]

// ─── Slide Components ─────────────────────────────────────────────────────────

function Slide1() {
  return (
    <div className="relative h-full flex flex-col justify-center items-center text-center px-16 overflow-hidden">
      {/* Background grid */}
      <div className="absolute inset-0 opacity-[0.04]" style={{
        backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)',
        backgroundSize: '60px 60px',
      }} />
      {/* Accent line */}
      <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-transparent via-amber-400 to-transparent" />

      <div className="relative z-10 max-w-3xl">
        <div className="inline-block px-4 py-1.5 rounded-full bg-white/10 border border-white/20 text-amber-400 text-[12px] font-semibold tracking-[0.2em] uppercase mb-8">
          MGlass · Москва
        </div>
        <h1 className="text-[72px] font-black text-white leading-none tracking-tight mb-6">
          МЫ ДЕЛАЕМ<br />
          <span className="text-amber-400">СТЕКЛО</span><br />
          ДЛЯ БИЗНЕСА
        </h1>
        <p className="text-[18px] text-white/60 leading-relaxed max-w-xl mx-auto mb-10">
          Производство закалённого стекла любой сложности для B2B-партнёров в Москве и МО.
          Собственное производство — без посредников.
        </p>
        <div className="flex items-center justify-center gap-8 text-white/40 text-[13px]">
          <div className="flex items-center gap-2">
            <div className="w-1 h-1 rounded-full bg-amber-400" />
            <span>Собственное производство</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-1 h-1 rounded-full bg-amber-400" />
            <span>Москва и МО</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-1 h-1 rounded-full bg-amber-400" />
            <span>B2B партнёрство</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function Slide2() {
  const services = [
    { icon: '✂️', title: 'Резка', desc: 'Любые размеры и формы. Прямые и фигурные резы по чертежам.' },
    { icon: '🔥', title: 'Закалка', desc: 'Полный цикл закалки. Стекло 4–19 мм. ГОСТ, документы.' },
    { icon: '✨', title: 'Полировка торцов', desc: 'Матовая, зеркальная, фацет. Любая геометрия торца.' },
    { icon: '🔩', title: 'Сверловка', desc: 'Отверстия любого диаметра под фурнитуру и крепёж.' },
    { icon: '🪞', title: 'Зеркала', desc: 'Серебряные и бронзовые. Подрезка, огранка, фацет.' },
    { icon: '🏗️', title: 'Монтаж', desc: 'Собственные бригады. Душевые, перегородки, зеркала.' },
  ]
  return (
    <div className="h-full flex flex-col justify-center px-16 py-12">
      <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-transparent via-amber-400 to-transparent" />
      <div className="mb-10">
        <div className="text-amber-400 text-[11px] font-bold tracking-[0.25em] uppercase mb-3">02 / Что мы делаем</div>
        <h2 className="text-[48px] font-black text-white leading-none tracking-tight">
          ПОЛНЫЙ ЦИКЛ<br /><span className="text-amber-400">ОБРАБОТКИ СТЕКЛА</span>
        </h2>
      </div>
      <div className="grid grid-cols-3 gap-4">
        {services.map((s, i) => (
          <div key={i} className="bg-white/[0.04] border border-white/10 rounded-xl p-5 hover:border-amber-400/40 hover:bg-white/[0.07] transition-all group">
            <div className="text-[28px] mb-3">{s.icon}</div>
            <div className="text-white font-bold text-[15px] mb-1.5 group-hover:text-amber-400 transition-colors">{s.title}</div>
            <div className="text-white/50 text-[12px] leading-relaxed">{s.desc}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Slide3() {
  const specs = [
    { label: 'Толщина стекла', value: '4 / 6 / 8 / 10 / 12 / 15 / 19 мм' },
    { label: 'Макс. размер листа', value: '2500 × 3000 мм' },
    { label: 'Точность резки', value: '±0.5 мм' },
    { label: 'Закалка', value: 'По ГОСТ 30698-2014' },
    { label: 'Типы стекла', value: 'Float, Lacobel, Crystal Vision, матовое, тонированное' },
    { label: 'Цвета', value: 'Прозрачное, сатин, серое, бронза, чёрное, белое' },
    { label: 'Покрытие', value: 'Плёнка Oracal, триплекс, ультрабез' },
    { label: 'Производительность', value: 'до 500 м² в месяц' },
    { label: 'Срок изготовления', value: 'от 3 рабочих дней' },
    { label: 'Документы', value: 'Сертификат, УПД, акт выполненных работ' },
  ]
  return (
    <div className="h-full flex flex-col justify-center px-16 py-12">
      <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-transparent via-amber-400 to-transparent" />
      <div className="mb-8">
        <div className="text-amber-400 text-[11px] font-bold tracking-[0.25em] uppercase mb-3">03 / Возможности</div>
        <h2 className="text-[48px] font-black text-white leading-none tracking-tight">
          ПРОИЗВОДСТВЕННЫЕ<br /><span className="text-amber-400">ХАРАКТЕРИСТИКИ</span>
        </h2>
      </div>
      <div className="grid grid-cols-2 gap-x-12 gap-y-3">
        {specs.map((s, i) => (
          <div key={i} className="flex items-start gap-4 py-2.5 border-b border-white/[0.08]">
            <div className="w-2 h-2 rounded-full bg-amber-400 mt-[5px] flex-shrink-0" />
            <div className="flex-1 flex items-start justify-between gap-4">
              <span className="text-white/50 text-[12px]">{s.label}</span>
              <span className="text-white text-[12px] font-semibold text-right">{s.value}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Slide4() {
  const segments = [
    {
      icon: '🏠',
      title: 'Дизайн-студии',
      desc: 'Партнёрские условия, приоритет в производстве, % с каждого объекта.',
      tag: 'Высокий потенциал',
    },
    {
      icon: '🛋️',
      title: 'Мебельные компании',
      desc: 'Зеркала, стеклянные фасады, вставки под размер и цвет.',
      tag: 'Регулярные заказы',
    },
    {
      icon: '🏗️',
      title: 'Строительные компании',
      desc: 'Душевые, перегородки, зеркала под ключ. Своя бригада монтажа.',
      tag: 'Объёмные проекты',
    },
    {
      icon: '🏢',
      title: 'Алюминиевые компании',
      desc: 'Стекло под нарезку для офисных перегородок. Чёткие сроки, чертежи.',
      tag: 'Производственный B2B',
    },
    {
      icon: '🔧',
      title: 'Стекольные мастерские',
      desc: 'Производственная кооперация: закалка, полировка без своей печи.',
      tag: 'Субподряд',
    },
    {
      icon: '🏦',
      title: 'Управляющие компании',
      desc: 'Офисные лофт-перегородки, fit-out. Оптовые условия.',
      tag: 'Долгосрочно',
    },
  ]
  return (
    <div className="h-full flex flex-col justify-center px-16 py-12">
      <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-transparent via-amber-400 to-transparent" />
      <div className="mb-8">
        <div className="text-amber-400 text-[11px] font-bold tracking-[0.25em] uppercase mb-3">04 / Для кого</div>
        <h2 className="text-[48px] font-black text-white leading-none tracking-tight">
          С КОГО МЫ<br /><span className="text-amber-400">РАБОТАЕМ</span>
        </h2>
      </div>
      <div className="grid grid-cols-3 gap-4">
        {segments.map((s, i) => (
          <div key={i} className="bg-white/[0.04] border border-white/10 rounded-xl p-4 hover:border-amber-400/40 transition-all group">
            <div className="flex items-start justify-between mb-2">
              <span className="text-[24px]">{s.icon}</span>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-400/10 text-amber-400 border border-amber-400/20">
                {s.tag}
              </span>
            </div>
            <div className="text-white font-bold text-[14px] mb-1.5 group-hover:text-amber-400 transition-colors">{s.title}</div>
            <div className="text-white/50 text-[11px] leading-relaxed">{s.desc}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Slide5() {
  const points = [
    {
      num: '01',
      title: 'Собственное производство',
      desc: 'Своя печь закалки, оборудование для резки и полировки. Никаких субподрядчиков на ключевых операциях.',
    },
    {
      num: '02',
      title: 'Скорость',
      desc: 'Стандартные позиции — от 3 дней. Срочные заказы согласовываем индивидуально. Живые сроки, без сюрпризов.',
    },
    {
      num: '03',
      title: 'Гибкость',
      desc: 'Малые партии от 1 листа. Нестандартные размеры. Работаем под чертёж и DXF-файл.',
    },
    {
      num: '04',
      title: 'Документооборот',
      desc: 'Работаем с ИП и ООО. УПД, сертификаты соответствия, акты. Белый бизнес.',
    },
    {
      num: '05',
      title: 'Команда',
      desc: 'Технологи, менеджеры и монтажники — всё под одной крышей. Один контакт для всего проекта.',
    },
    {
      num: '06',
      title: 'Локация',
      desc: 'Производство в Москве. Доставка по МО. Быстрый доступ и контроль качества на месте.',
    },
  ]
  return (
    <div className="h-full flex flex-col justify-center px-16 py-12">
      <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-transparent via-amber-400 to-transparent" />
      <div className="mb-8">
        <div className="text-amber-400 text-[11px] font-bold tracking-[0.25em] uppercase mb-3">05 / Почему мы</div>
        <h2 className="text-[48px] font-black text-white leading-none tracking-tight">
          ПОЧЕМУ ВЫБИРАЮТ<br /><span className="text-amber-400">MGLASS</span>
        </h2>
      </div>
      <div className="grid grid-cols-3 gap-4">
        {points.map((p, i) => (
          <div key={i} className="flex gap-4">
            <div className="text-[11px] font-black text-amber-400/40 pt-0.5 flex-shrink-0">{p.num}</div>
            <div>
              <div className="text-white font-bold text-[14px] mb-1">{p.title}</div>
              <div className="text-white/50 text-[11px] leading-relaxed">{p.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Slide6() {
  const steps = [
    { label: 'Входной контроль', desc: 'Каждый лист проходит визуальный контроль до обработки.' },
    { label: 'Закалка по ГОСТ', desc: 'Режимы температуры и охлаждения строго по ГОСТ 30698-2014.' },
    { label: 'Контроль размеров', desc: 'Проверка отклонений от чертежа на каждом этапе.' },
    { label: 'Выходной ОТК', desc: 'Осмотр готового изделия перед упаковкой и отгрузкой.' },
    { label: 'Упаковка', desc: 'Пенопласт, скотч, деревянные паллеты для крупных заказов.' },
    { label: 'Гарантия', desc: '12 месяцев на закалённое стекло. Акт выполненных работ.' },
  ]
  return (
    <div className="h-full flex flex-col justify-center px-16 py-12">
      <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-transparent via-amber-400 to-transparent" />
      <div className="mb-8">
        <div className="text-amber-400 text-[11px] font-bold tracking-[0.25em] uppercase mb-3">06 / Качество</div>
        <h2 className="text-[48px] font-black text-white leading-none tracking-tight">
          КОНТРОЛЬ<br /><span className="text-amber-400">КАЧЕСТВА</span>
        </h2>
      </div>
      <div className="relative">
        {/* Line */}
        <div className="absolute left-[22px] top-4 bottom-4 w-px bg-amber-400/20" />
        <div className="space-y-5">
          {steps.map((s, i) => (
            <div key={i} className="flex gap-5 items-start">
              <div className="w-11 h-11 rounded-full border border-amber-400/40 bg-amber-400/10 flex items-center justify-center flex-shrink-0 z-10">
                <span className="text-amber-400 text-[11px] font-black">{String(i + 1).padStart(2, '0')}</span>
              </div>
              <div className="pt-2.5">
                <div className="text-white font-bold text-[14px] mb-0.5">{s.label}</div>
                <div className="text-white/50 text-[12px]">{s.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Slide7() {
  const cases = [
    {
      segment: 'Дизайн-студия',
      project: 'ЖК "Mainland", Москва',
      scope: '12 душевых ограждений + зеркала',
      volume: '≈ 180 000 ₽',
      result: 'Стали постоянным поставщиком. 4 объекта за год.',
    },
    {
      segment: 'Мебельная фабрика',
      project: 'Кухонные фасады, серийное производство',
      scope: 'Лакобель 4 мм, 80 листов/мес',
      volume: '≈ 95 000 ₽/мес',
      result: 'Заменили московского поставщика. Сроки ±2 дня.',
    },
    {
      segment: 'Строительная компания',
      project: 'Бизнес-центр, Балашиха',
      scope: '240 м² лофт-перегородок',
      volume: '≈ 1 200 000 ₽',
      result: 'Сдали в срок. Повторный заказ на 2-й корпус.',
    },
    {
      segment: 'Алюминиевая компания',
      project: 'Офисные перегородки, МО',
      scope: 'Стекло 10 мм под нарезку, 50 ед/мес',
      volume: '≈ 120 000 ₽/мес',
      result: 'Работаем 8+ месяцев. Производственная кооперация.',
    },
  ]
  return (
    <div className="h-full flex flex-col justify-center px-16 py-12">
      <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-transparent via-amber-400 to-transparent" />
      <div className="mb-8">
        <div className="text-amber-400 text-[11px] font-bold tracking-[0.25em] uppercase mb-3">07 / Кейсы</div>
        <h2 className="text-[48px] font-black text-white leading-none tracking-tight">
          РЕАЛЬНЫЕ<br /><span className="text-amber-400">РЕЗУЛЬТАТЫ</span>
        </h2>
      </div>
      <div className="grid grid-cols-2 gap-4">
        {cases.map((c, i) => (
          <div key={i} className="bg-white/[0.04] border border-white/10 rounded-xl p-5 hover:border-amber-400/40 transition-all">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-400/10 text-amber-400 border border-amber-400/20 uppercase tracking-wide">
                {c.segment}
              </span>
              <span className="text-amber-400 font-black text-[15px]">{c.volume}</span>
            </div>
            <div className="text-white font-semibold text-[13px] mb-1">{c.project}</div>
            <div className="text-white/40 text-[11px] mb-3">{c.scope}</div>
            <div className="flex items-start gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1.5 flex-shrink-0" />
              <div className="text-white/70 text-[12px]">{c.result}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Slide8() {
  const terms = [
    { icon: '💳', title: 'Оплата', desc: '50% предоплата / 50% перед отгрузкой. Для постоянных партнёров — отсрочка до 14 дней.' },
    { icon: '📄', title: 'Документы', desc: 'УПД, счёт, сертификат соответствия. Работаем с ИП и ООО на ОСНО и УСН.' },
    { icon: '🚚', title: 'Доставка', desc: 'Доставка по Москве и МО. Самовывоз со склада. Упаковка включена.' },
    { icon: '📐', title: 'Минимальный заказ', desc: 'От 1 изделия. Без ограничений по минимальному объёму. Серийные заказы — по договору.' },
    { icon: '⏱️', title: 'Срок производства', desc: 'Стандарт: 3–7 рабочих дней. Срочно: обсуждается индивидуально.' },
    { icon: '🤝', title: 'Партнёрская программа', desc: 'Для дизайнеров и подрядчиков — фиксированный % с каждого реализованного объекта.' },
  ]
  return (
    <div className="h-full flex flex-col justify-center px-16 py-12">
      <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-transparent via-amber-400 to-transparent" />
      <div className="mb-8">
        <div className="text-amber-400 text-[11px] font-bold tracking-[0.25em] uppercase mb-3">08 / Условия</div>
        <h2 className="text-[48px] font-black text-white leading-none tracking-tight">
          УСЛОВИЯ<br /><span className="text-amber-400">СОТРУДНИЧЕСТВА</span>
        </h2>
      </div>
      <div className="grid grid-cols-3 gap-4">
        {terms.map((t, i) => (
          <div key={i} className="bg-white/[0.04] border border-white/10 rounded-xl p-5 hover:border-amber-400/40 transition-all">
            <div className="text-[28px] mb-3">{t.icon}</div>
            <div className="text-white font-bold text-[14px] mb-1.5">{t.title}</div>
            <div className="text-white/50 text-[12px] leading-relaxed">{t.desc}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Slide9() {
  const steps = [
    { num: '01', title: 'Заявка', desc: 'Пишите на WhatsApp или email. Опишите задачу — размеры, тип стекла, объём.' },
    { num: '02', title: 'Просчёт', desc: 'Считаем стоимость за 2–4 часа. Присылаем КП с характеристиками и ценой.' },
    { num: '03', title: 'Согласование', desc: 'Утверждаете чертёж и параметры. Подписываем договор или счёт.' },
    { num: '04', title: 'Производство', desc: 'Запускаем в работу. Уведомляем о готовности.' },
    { num: '05', title: 'Отгрузка', desc: 'Доставляем или организуем самовывоз. Подписываем документы.' },
    { num: '06', title: 'Партнёрство', desc: 'Становитесь постоянным клиентом. Приоритетные сроки и партнёрские условия.' },
  ]
  return (
    <div className="h-full flex flex-col justify-center px-16 py-12">
      <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-transparent via-amber-400 to-transparent" />
      <div className="mb-8">
        <div className="text-amber-400 text-[11px] font-bold tracking-[0.25em] uppercase mb-3">09 / Как начать</div>
        <h2 className="text-[48px] font-black text-white leading-none tracking-tight">
          КАК НАЧАТЬ<br /><span className="text-amber-400">РАБОТУ</span>
        </h2>
      </div>
      <div className="grid grid-cols-3 gap-4">
        {steps.map((s, i) => (
          <div key={i} className="relative bg-white/[0.04] border border-white/10 rounded-xl p-5 hover:border-amber-400/40 transition-all group">
            <div className="text-[36px] font-black text-amber-400/20 leading-none mb-3 group-hover:text-amber-400/40 transition-colors">
              {s.num}
            </div>
            <div className="text-white font-bold text-[14px] mb-1.5">{s.title}</div>
            <div className="text-white/50 text-[12px] leading-relaxed">{s.desc}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Slide10() {
  return (
    <div className="relative h-full flex flex-col justify-center items-center text-center px-16 overflow-hidden">
      <div className="absolute inset-0 opacity-[0.04]" style={{
        backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)',
        backgroundSize: '60px 60px',
      }} />
      <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-transparent via-amber-400 to-transparent" />
      {/* Corner accents */}
      <div className="absolute top-8 left-8 w-12 h-12 border-t-2 border-l-2 border-amber-400/30 rounded-tl-lg" />
      <div className="absolute top-8 right-8 w-12 h-12 border-t-2 border-r-2 border-amber-400/30 rounded-tr-lg" />
      <div className="absolute bottom-8 left-8 w-12 h-12 border-b-2 border-l-2 border-amber-400/30 rounded-bl-lg" />
      <div className="absolute bottom-8 right-8 w-12 h-12 border-b-2 border-r-2 border-amber-400/30 rounded-br-lg" />

      <div className="relative z-10 max-w-2xl">
        <div className="text-amber-400 text-[11px] font-bold tracking-[0.25em] uppercase mb-6">10 / Контакты</div>
        <h2 className="text-[56px] font-black text-white leading-none tracking-tight mb-4">
          НАЧНЁМ<br /><span className="text-amber-400">РАБОТАТЬ?</span>
        </h2>
        <p className="text-white/50 text-[16px] mb-12">
          Напишите нам — посчитаем вашу задачу бесплатно и без обязательств.
        </p>

        <div className="flex flex-col gap-4 items-center">
          <div className="flex gap-6">
            <a
              href="https://wa.me/79161234567"
              className="flex items-center gap-3 bg-emerald-500/10 border border-emerald-500/30 hover:border-emerald-400 hover:bg-emerald-500/20 text-emerald-400 px-6 py-3.5 rounded-xl font-semibold text-[14px] transition-all group"
            >
              <span className="text-[20px]">📱</span>
              WhatsApp
            </a>
            <a
              href="mailto:info@mglass.ru"
              className="flex items-center gap-3 bg-blue-500/10 border border-blue-500/30 hover:border-blue-400 hover:bg-blue-500/20 text-blue-400 px-6 py-3.5 rounded-xl font-semibold text-[14px] transition-all"
            >
              <span className="text-[20px]">✉️</span>
              Email
            </a>
            <a
              href="https://instagram.com/mglass.ru"
              className="flex items-center gap-3 bg-pink-500/10 border border-pink-500/30 hover:border-pink-400 hover:bg-pink-500/20 text-pink-400 px-6 py-3.5 rounded-xl font-semibold text-[14px] transition-all"
            >
              <span className="text-[20px]">📸</span>
              Instagram
            </a>
          </div>

          <div className="mt-6 flex items-center gap-8 text-white/30 text-[12px]">
            <span>mglass.ru</span>
            <div className="w-1 h-1 rounded-full bg-white/20" />
            <span>Москва и МО</span>
            <div className="w-1 h-1 rounded-full bg-white/20" />
            <span>ПН–СБ, 9:00–19:00</span>
          </div>
        </div>
      </div>
    </div>
  )
}

const SLIDE_COMPONENTS = [Slide1, Slide2, Slide3, Slide4, Slide5, Slide6, Slide7, Slide8, Slide9, Slide10]

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function B2BPresentationPage() {
  const [current, setCurrent] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const slideRefs = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const idx = slideRefs.current.indexOf(entry.target as HTMLDivElement)
            if (idx !== -1) setCurrent(idx)
          }
        })
      },
      { root: container, threshold: 0.6 }
    )

    slideRefs.current.forEach(ref => { if (ref) observer.observe(ref) })
    return () => observer.disconnect()
  }, [])

  function goTo(idx: number) {
    slideRefs.current[idx]?.scrollIntoView({ behavior: 'smooth' })
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') goTo(Math.min(current + 1, SLIDES.length - 1))
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') goTo(Math.max(current - 1, 0))
  }

  const SlideComponent = SLIDE_COMPONENTS[current]

  return (
    <div
      className="fixed inset-0 bg-[#0a0a09] outline-none z-[60]"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-6 py-3 bg-gradient-to-b from-black/60 to-transparent">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 bg-white rounded-[6px] flex items-center justify-center">
            <span className="text-[#0a0a09] text-[11px] font-black tracking-tight">MG</span>
          </div>
          <span className="text-white/60 text-[13px] font-semibold">MGlass · B2B Presentation</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-white/30 text-[12px]">{current + 1} / {SLIDES.length}</span>
          <button
            onClick={() => window.print()}
            className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white/60 hover:text-white text-[11px] font-semibold transition-all border border-white/10"
          >
            Печать
          </button>
        </div>
      </div>

      {/* Slide container (scroll-snap) */}
      <div
        ref={containerRef}
        className="h-full overflow-y-auto"
        style={{ scrollSnapType: 'y mandatory', scrollBehavior: 'smooth' }}
      >
        {SLIDE_COMPONENTS.map((SlideComp, i) => (
          <div
            key={i}
            ref={el => { slideRefs.current[i] = el }}
            className="relative h-screen"
            style={{ scrollSnapAlign: 'start' }}
          >
            <SlideComp />
          </div>
        ))}
      </div>

      {/* Right nav dots */}
      <div className="absolute right-5 top-1/2 -translate-y-1/2 z-20 flex flex-col gap-2.5">
        {SLIDES.map((s, i) => (
          <button
            key={i}
            onClick={() => goTo(i)}
            title={s.label}
            className="group relative flex items-center justify-end gap-2"
          >
            <span className={`text-[10px] font-semibold whitespace-nowrap transition-all duration-200 opacity-0 group-hover:opacity-100 ${
              current === i ? 'text-amber-400' : 'text-white/40'
            }`}>
              {s.label}
            </span>
            <div className={`rounded-full transition-all duration-200 ${
              current === i
                ? 'w-2.5 h-2.5 bg-amber-400'
                : 'w-1.5 h-1.5 bg-white/20 hover:bg-white/50'
            }`} />
          </button>
        ))}
      </div>

      {/* Bottom prev/next */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex items-center gap-4">
        <button
          onClick={() => goTo(Math.max(current - 1, 0))}
          disabled={current === 0}
          className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30 flex items-center justify-center transition-all border border-white/10"
        >
          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <div className="flex gap-1.5">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              className={`transition-all duration-200 rounded-full ${
                current === i ? 'w-5 h-1.5 bg-amber-400' : 'w-1.5 h-1.5 bg-white/20 hover:bg-white/40'
              }`}
            />
          ))}
        </div>

        <button
          onClick={() => goTo(Math.min(current + 1, SLIDES.length - 1))}
          disabled={current === SLIDES.length - 1}
          className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30 flex items-center justify-center transition-all border border-white/10"
        >
          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  )
}
