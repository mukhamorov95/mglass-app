import Link from 'next/link'

const SECTIONS = [
  {
    title: 'Контент и видео',
    color: 'border-blue-200',
    items: [
      { href: '/marketing/content', emoji: '📅', label: 'Контент-план',   desc: 'Темы, платформы, хуки, CTA, статус публикации' },
      { href: '/marketing/videos',  emoji: '🎬', label: 'Video Factory',  desc: 'Сценарии Reels/Shorts: хук, структура, кадры, диктор' },
    ],
  },
  {
    title: 'Партнёры и акции',
    color: 'border-emerald-200',
    items: [
      { href: '/marketing/partners', emoji: '🤝', label: 'Партнёры',      desc: 'Дизайнеры, прорабы, бригады — учёт рефералов и выплат' },
      { href: '/marketing/promos',   emoji: '🎁', label: 'Promo Center',  desc: 'Акции, бонусы, сезонные предложения без ущерба марже' },
    ],
  },
  {
    title: 'Операции',
    color: 'border-amber-200',
    items: [
      { href: '/marketing/tasks', emoji: '✅', label: 'Задачи',           desc: 'B2C / B2B / партнёры / контент — приоритеты и сроки' },
      { href: '/marketing/ai',   emoji: '🤖', label: 'AI-маркетолог',    desc: 'Сценарии, посты, идеи, WhatsApp-статусы, гипотезы' },
    ],
  },
]

const STRATEGY = [
  { icon: '🎯', title: 'Год 1', desc: 'Стабилизировать лидогенерацию, запустить партнёрку, контент-машину, B2B упаковку' },
  { icon: '🚀', title: 'Год 2', desc: 'Масштабировать B2B, усилить дилеров, бренд готовой продукции, регулярные кампании' },
  { icon: '🏆', title: 'Год 3', desc: 'Федеральное масштабирование, дилерская сеть, бренд готовых серий (Aura и др.)' },
]

const CHANNELS = [
  { icon: '👤', label: 'Дизайнеры', desc: 'Главный умножитель лидов — 1 дизайнер = 10+ клиентов/год' },
  { icon: '🔨', label: 'Прорабы', desc: 'Постоянный поток объектов, рекомендуют по проектам' },
  { icon: '📱', label: 'Reels/Shorts', desc: 'Органический охват: производство, до/после, советы' },
  { icon: '📢', label: 'Яндекс Директ', desc: 'Платный трафик на горячий спрос' },
  { icon: '🛒', label: 'Авито', desc: 'B2C и B2B лиды на готовые решения' },
  { icon: '💬', label: 'Telegram', desc: 'Канал для дизайнеров, прорабов, B2B-партнёров' },
]

export default function MarketingCenterPage() {
  return (
    <div className="max-w-5xl mx-auto px-6 py-8">

      {/* Header */}
      <div className="mb-8">
        <p className="text-[11px] font-bold text-[#9a9a95] uppercase tracking-wider mb-1">Маркетинг</p>
        <h1 className="text-[28px] font-bold text-[#111110] tracking-tight">Marketing Center</h1>
        <p className="text-[15px] text-[#6b6b66] mt-1">
          Контент-машина MGlass — лиды, партнёры, бренд и рост до 1 млрд ₽
        </p>
      </div>

      {/* Quick links */}
      <div className="space-y-6 mb-10">
        {SECTIONS.map(section => (
          <div key={section.title}>
            <div className="flex items-center gap-3 mb-3">
              <h2 className="text-[13px] font-bold text-[#111110]">{section.title}</h2>
              <div className="flex-1 h-px bg-[#e4e4e0]" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {section.items.map(item => (
                <Link key={item.href} href={item.href}
                  className={`flex items-start gap-3 bg-white border-2 ${section.color} rounded-xl p-4 hover:shadow-md transition-all group`}>
                  <span className="text-xl mt-0.5 flex-shrink-0">{item.emoji}</span>
                  <div>
                    <p className="text-[14px] font-semibold text-[#111110] group-hover:text-blue-600 transition-colors">{item.label}</p>
                    <p className="text-[12px] text-[#6b6b66] mt-0.5 leading-snug">{item.desc}</p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Strategy timeline */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-4">
          <h2 className="text-[13px] font-bold text-[#111110]">Стратегия роста → 1 млрд ₽</h2>
          <div className="flex-1 h-px bg-[#e4e4e0]" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {STRATEGY.map(s => (
            <div key={s.title} className="bg-white border border-[#e4e4e0] rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">{s.icon}</span>
                <span className="text-[14px] font-semibold text-[#111110]">{s.title}</span>
              </div>
              <p className="text-[12px] text-[#6b6b66] leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Channels */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <h2 className="text-[13px] font-bold text-[#111110]">Ключевые каналы</h2>
          <div className="flex-1 h-px bg-[#e4e4e0]" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {CHANNELS.map(c => (
            <div key={c.label} className="bg-[#fafaf8] border border-[#e4e4e0] rounded-xl p-3">
              <div className="flex items-center gap-2 mb-1">
                <span>{c.icon}</span>
                <span className="text-[13px] font-semibold text-[#111110]">{c.label}</span>
              </div>
              <p className="text-[12px] text-[#6b6b66]">{c.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
