'use client'

import { useState } from 'react'
import Link from 'next/link'
import { PageHeader } from '@/components/ds'

const AI_TOOLS = [
  {
    href: '/objections',
    icon: '⚡',
    label: 'Работа с возражениями',
    desc: 'Скрипты ответов на типовые возражения',
    color: 'border-blue-100 bg-blue-50',
    labelColor: 'text-blue-700',
  },
  {
    href: '/product-finder',
    icon: '🎯',
    label: 'Подбор продукта',
    desc: 'AI подберёт оптимальный продукт под клиента',
    color: 'border-emerald-100 bg-emerald-50',
    labelColor: 'text-emerald-700',
  },
  {
    href: '/templates',
    icon: '✉️',
    label: 'Шаблоны переписки',
    desc: 'Готовые тексты для каждого этапа сделки',
    color: 'border-violet-100 bg-violet-50',
    labelColor: 'text-violet-700',
  },
  {
    href: '/deal-analysis',
    icon: '🔍',
    label: 'Анализ сделки',
    desc: 'Разбор ситуации и план действий по клиенту',
    color: 'border-orange-100 bg-orange-50',
    labelColor: 'text-orange-700',
  },
  {
    href: '/competitors',
    icon: '⚖️',
    label: 'Конкуренты',
    desc: 'Аргументы MGlass против ИКЕА, Леруа и других',
    color: 'border-rose-100 bg-rose-50',
    labelColor: 'text-rose-700',
  },
  {
    href: '/ai-assistant',
    icon: '💬',
    label: 'AI Ассистент',
    desc: 'Свободный чат — любые вопросы по продажам',
    color: 'border-slate-100 bg-slate-50',
    labelColor: 'text-slate-700',
  },
]

const TIPS = [
  'Используй «Анализ сделки» перед звонком клиенту — освежи план действий',
  'Шаблон «После замера» отправляй в день выезда, пока клиент ещё в настроении',
  'При сравнении с ИКЕА — акцент на монтаж и гарантию, цена вторична',
  'Возражение «дорого» — всегда уточняй, с чем сравнивает клиент',
  'КП без фоллоу-апа теряет 60% сделок. Напоминай на 1-й и 3-й день',
]

export default function MyDashboardPage() {
  const [tipIdx] = useState(() => Math.floor(Math.random() * TIPS.length))

  return (
    <div className="max-w-[860px] mx-auto px-6 py-8">
      <PageHeader
        title="AI Продажи — дашборд"
        subtitle="Все инструменты для работы с клиентами в одном месте"
      />

      {/* Совет дня */}
      <div className="mb-6 bg-[#fffbeb] border border-[#fde68a] rounded-xl px-4 py-3 flex items-start gap-3">
        <span className="text-[18px] mt-0.5">💡</span>
        <div>
          <p className="text-[11px] font-semibold text-[#92400e] uppercase tracking-widest mb-0.5">Совет дня</p>
          <p className="text-[13px] text-[#78350f] leading-relaxed">{TIPS[tipIdx]}</p>
        </div>
      </div>

      {/* Инструменты */}
      <div className="grid grid-cols-3 gap-3 mb-8">
        {AI_TOOLS.map(tool => (
          <Link key={tool.href} href={tool.href}
            className={`flex flex-col p-4 rounded-xl border ${tool.color} hover:shadow-sm transition-all`}>
            <span className="text-[24px] mb-2">{tool.icon}</span>
            <span className={`text-[13px] font-semibold mb-1 ${tool.labelColor}`}>{tool.label}</span>
            <span className="text-[12px] text-ink-soft leading-tight">{tool.desc}</span>
          </Link>
        ))}
      </div>

      {/* Быстрый доступ к калькуляторам */}
      <div>
        <p className="text-[11px] font-semibold text-muted uppercase tracking-widest mb-3">Быстрый расчёт</p>
        <div className="grid grid-cols-3 gap-2">
          {[
            { href: '/calculator/mirror', label: 'Зеркало с подсветкой' },
            { href: '/calculator/loft',   label: 'Лофт-перегородка' },
            { href: '/calculator/shower', label: 'Душевая перегородка' },
          ].map(item => (
            <Link key={item.href} href={item.href}
              className="flex items-center justify-center px-4 py-3 rounded-xl border border-line bg-surface text-[13px] text-ink-soft hover:border-faint hover:text-ink transition-colors text-center">
              {item.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
