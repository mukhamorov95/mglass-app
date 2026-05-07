'use client'

import { useState } from 'react'

type Tab = 'overview' | 'services' | 'env' | 'diagnostics' | 'instructions'

// ─── Data ────────────────────────────────────────────────────────────────────

const SERVICES = [
  {
    id: 'vercel',
    icon: '▲',
    name: 'Vercel',
    category: 'Frontend / Deploy',
    color: 'bg-black text-white',
    badge: 'bg-slate-100 text-slate-700',
    status: 'online' as const,
    description: 'Хостинг и деплой платформы MGlass. Каждый push в GitHub → автоматический деплой.',
    responsible: ['Сайт и веб-приложение', 'Автодеплой из GitHub', 'ENV переменные (production)', 'Логи сборки'],
    links: [
      { label: 'Dashboard', url: 'https://vercel.com/dashboard' },
      { label: 'Deployments', url: 'https://vercel.com/mukhamorov95-1222/mglass-app/deployments' },
      { label: 'Settings / ENV', url: 'https://vercel.com/mukhamorov95-1222/mglass-app/settings/environment-variables' },
    ],
    envVars: ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'AMO_SUBDOMAIN', 'AMO_ACCESS_TOKEN', 'AMO_VLADISLAV_USER_ID', 'WAZZUP_API_KEY'],
    dependsOn: ['GitHub', 'Supabase'],
  },
  {
    id: 'supabase',
    icon: '🗄',
    name: 'Supabase',
    category: 'Database / Backend',
    color: 'bg-emerald-600 text-white',
    badge: 'bg-emerald-50 text-emerald-700',
    status: 'online' as const,
    description: 'Главная база данных MGlass. Хранит все данные: расчёты, материалы, пользователей, AI-диалоги.',
    responsible: ['Все таблицы и данные', 'Аутентификация пользователей', 'Realtime подписки', 'Storage (изображения)', 'API (PostgREST)'],
    links: [
      { label: 'Dashboard', url: 'https://app.supabase.com/project/qbypyrzkguwlelyjehbj' },
      { label: 'SQL Editor', url: 'https://app.supabase.com/project/qbypyrzkguwlelyjehbj/sql' },
      { label: 'Table Editor', url: 'https://app.supabase.com/project/qbypyrzkguwlelyjehbj/editor' },
      { label: 'Auth / Users', url: 'https://app.supabase.com/project/qbypyrzkguwlelyjehbj/auth/users' },
    ],
    envVars: ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'],
    dependsOn: [],
  },
  {
    id: 'github',
    icon: '⌥',
    name: 'GitHub',
    category: 'Git Repository',
    color: 'bg-[#24292f] text-white',
    badge: 'bg-gray-100 text-gray-700',
    status: 'online' as const,
    description: 'Хранилище исходного кода. Все изменения кода → push в GitHub → Vercel деплоит автоматически.',
    responsible: ['Весь исходный код MGlass', 'История изменений (git log)', 'Бекап кода', 'Триггер деплоя в Vercel'],
    links: [
      { label: 'Repository', url: 'https://github.com/mukhamorov95/mglass-app' },
      { label: 'Commits', url: 'https://github.com/mukhamorov95/mglass-app/commits' },
      { label: 'Actions', url: 'https://github.com/mukhamorov95/mglass-app/actions' },
    ],
    envVars: [],
    dependsOn: [],
  },
  {
    id: 'anthropic',
    icon: '◈',
    name: 'Anthropic (Claude)',
    category: 'AI — основной',
    color: 'bg-orange-600 text-white',
    badge: 'bg-orange-50 text-orange-700',
    status: 'online' as const,
    description: 'Основной AI-движок MGlass. Claude Sonnet обрабатывает переписку, генерирует КП, распознаёт параметры.',
    responsible: ['Telegram Assistant — ответы и расчёты', 'WhatsApp бот (Wazzup)', 'Генератор КП', 'AI Ассистент в браузере', 'Распознавание параметров изделий'],
    links: [
      { label: 'Console', url: 'https://console.anthropic.com' },
      { label: 'API Keys', url: 'https://console.anthropic.com/settings/keys' },
      { label: 'Usage', url: 'https://console.anthropic.com/settings/usage' },
    ],
    envVars: ['ANTHROPIC_API_KEY'],
    dependsOn: [],
  },
  {
    id: 'openai',
    icon: '◎',
    name: 'OpenAI (Whisper)',
    category: 'AI — голос',
    color: 'bg-teal-600 text-white',
    badge: 'bg-teal-50 text-teal-700',
    status: 'online' as const,
    description: 'Используется только для транскрибации голосовых сообщений (Whisper). Голосовой ввод в Telegram.',
    responsible: ['Распознавание голоса в Telegram-боте', 'Транскрибация аудио файлов'],
    links: [
      { label: 'Dashboard', url: 'https://platform.openai.com' },
      { label: 'API Keys', url: 'https://platform.openai.com/api-keys' },
      { label: 'Usage', url: 'https://platform.openai.com/usage' },
    ],
    envVars: ['OPENAI_API_KEY'],
    dependsOn: [],
  },
  {
    id: 'telegram',
    icon: '✈',
    name: 'Telegram Bot',
    category: 'Мобильный интерфейс',
    color: 'bg-blue-500 text-white',
    badge: 'bg-blue-50 text-blue-700',
    status: 'online' as const,
    description: 'Мобильный AI-ассистент для менеджеров. Голосовые команды, быстрые расчёты, управление лидами.',
    responsible: ['Голосовой ввод расчётов', 'Быстрый расчёт цены', 'Управление AI-лидами', 'Мобильное управление без браузера'],
    links: [
      { label: 'BotFather', url: 'https://t.me/BotFather' },
      { label: 'Открыть бота', url: 'https://t.me/mglass_assistant_bot' },
      { label: 'Webhook URL', url: 'https://mglass.vercel.app/api/telegram/webhook' },
    ],
    envVars: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET'],
    dependsOn: ['Anthropic', 'OpenAI', 'Supabase'],
  },
  {
    id: 'wazzup',
    icon: '💬',
    name: 'Wazzup (WhatsApp)',
    category: 'WhatsApp интеграция',
    color: 'bg-green-600 text-white',
    badge: 'bg-green-50 text-green-700',
    status: 'online' as const,
    description: 'WhatsApp-интеграция. AI автоматически отвечает клиентам от лица Владислава.',
    responsible: ['Приём сообщений от клиентов в WhatsApp', 'Отправка ответов AI', 'Автоматический диалог с клиентами'],
    links: [
      { label: 'Dashboard', url: 'https://wazzup24.com' },
      { label: 'Webhook URL', url: 'https://mglass.vercel.app/api/wazzup/webhook' },
    ],
    envVars: ['WAZZUP_API_KEY'],
    dependsOn: ['Anthropic', 'Supabase', 'AmoCRM'],
  },
  {
    id: 'amocrm',
    icon: '📊',
    name: 'AmoCRM',
    category: 'CRM',
    color: 'bg-violet-600 text-white',
    badge: 'bg-violet-50 text-violet-700',
    status: 'online' as const,
    description: 'CRM для управления лидами, воронкой продаж и коммуникациями с клиентами.',
    responsible: ['Лиды и сделки', 'Воронка продаж', 'История переписки', 'Задачи менеджерам', 'Аналитика продаж'],
    links: [
      { label: 'AmoCRM', url: 'https://mglass.amocrm.ru' },
      { label: 'API Settings', url: 'https://mglass.amocrm.ru/settings/integration' },
    ],
    envVars: ['AMO_SUBDOMAIN', 'AMO_ACCESS_TOKEN', 'AMO_VLADISLAV_USER_ID'],
    dependsOn: [],
  },
]

const ENV_VARS = [
  { name: 'NEXT_PUBLIC_SUPABASE_URL',   desc: 'URL Supabase проекта',             service: 'Supabase',   secret: false, critical: true },
  { name: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', desc: 'Публичный ключ Supabase',       service: 'Supabase',   secret: false, critical: true },
  { name: 'SUPABASE_SERVICE_ROLE_KEY',  desc: 'Серверный ключ Supabase (полный доступ)', service: 'Supabase', secret: true, critical: true },
  { name: 'ANTHROPIC_API_KEY',          desc: 'API ключ Anthropic Claude',        service: 'Anthropic',  secret: true, critical: true },
  { name: 'OPENAI_API_KEY',             desc: 'API ключ OpenAI (Whisper / голос)', service: 'OpenAI',    secret: true, critical: false },
  { name: 'TELEGRAM_BOT_TOKEN',         desc: 'Токен Telegram бота',             service: 'Telegram',   secret: true, critical: true },
  { name: 'TELEGRAM_WEBHOOK_SECRET',    desc: 'Секрет для проверки webhook Telegram', service: 'Telegram', secret: true, critical: false },
  { name: 'AMO_SUBDOMAIN',              desc: 'Поддомен AmoCRM (mglass)',         service: 'AmoCRM',     secret: false, critical: false },
  { name: 'AMO_ACCESS_TOKEN',           desc: 'Токен доступа AmoCRM API',        service: 'AmoCRM',     secret: true, critical: false },
  { name: 'AMO_VLADISLAV_USER_ID',      desc: 'ID Владислава в AmoCRM',          service: 'AmoCRM',     secret: false, critical: false },
  { name: 'WAZZUP_API_KEY',             desc: 'API ключ Wazzup (WhatsApp)',       service: 'Wazzup',     secret: true, critical: false },
]

const TROUBLESHOOTING = [
  {
    id: 'site',
    title: '🌐 Не работает сайт',
    steps: [
      { step: 'Открой Vercel Dashboard', url: 'https://vercel.com/dashboard', action: 'Проверь статус последнего деплоя — должно быть "Ready"' },
      { step: 'Посмотри Build Logs', url: 'https://vercel.com/mukhamorov95-1222/mglass-app/deployments', action: 'Найди красный деплой → клик → "Build Logs" → ищи ошибку' },
      { step: 'Проверь ENV переменные', url: 'https://vercel.com/mukhamorov95-1222/mglass-app/settings/environment-variables', action: 'Все переменные из таблицы ENV должны быть заполнены' },
      { step: 'Проверь Supabase', url: 'https://app.supabase.com', action: 'Проект должен быть активен, не на паузе' },
    ],
  },
  {
    id: 'telegram',
    title: '🤖 Не работает Telegram бот',
    steps: [
      { step: 'Отправь боту /health', url: 'https://t.me/mglass_assistant_bot', action: 'Бот должен ответить статусом всех компонентов' },
      { step: 'Проверь webhook', url: 'https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/getWebhookInfo', action: 'URL должен совпадать с production URL: mglass.vercel.app/api/telegram/webhook' },
      { step: 'Проверь Vercel Logs', url: 'https://vercel.com/mukhamorov95-1222/mglass-app/logs', action: 'Ищи [TG] строки — они покажут где завис запрос' },
      { step: 'Проверь TELEGRAM_BOT_TOKEN', url: null, action: 'Токен должен быть в ENV Variables Vercel' },
      { step: 'Проверь ANTHROPIC_API_KEY', url: null, action: 'Без него бот не сможет обрабатывать запросы' },
    ],
  },
  {
    id: 'calc',
    title: '🧮 Не работают расчёты',
    steps: [
      { step: 'Открой Supabase Table Editor', url: 'https://app.supabase.com/project/qbypyrzkguwlelyjehbj/editor', action: 'Проверь таблицы: materials, services, financial_settings — должны быть с данными' },
      { step: 'Проверь таблицу materials', url: 'https://app.supabase.com/project/qbypyrzkguwlelyjehbj/editor', action: 'Фильтр active=true — должны быть материалы с category: зеркало, стекло' },
      { step: 'Открой калькулятор', url: 'https://mglass.vercel.app/calculator/mirror', action: 'Открой DevTools (F12) → Console — ищи ошибки красным' },
      { step: 'Проверь SUPABASE_SERVICE_ROLE_KEY', url: null, action: 'Без него API-маршруты не могут читать данные' },
    ],
  },
  {
    id: 'whatsapp',
    title: '💬 Не работает WhatsApp бот',
    steps: [
      { step: 'Проверь Wazzup Dashboard', url: 'https://wazzup24.com', action: 'Канал должен быть активен (зелёный статус)' },
      { step: 'Проверь webhook в Wazzup', url: 'https://wazzup24.com', action: 'Настройки → Webhook → URL: mglass.vercel.app/api/wazzup/webhook' },
      { step: 'Проверь Vercel Logs', url: 'https://vercel.com/mukhamorov95-1222/mglass-app/logs', action: 'Ищи "Wazzup webhook error" в логах' },
      { step: 'Проверь WAZZUP_API_KEY и ANTHROPIC_API_KEY', url: null, action: 'Оба ключа нужны для работы бота' },
    ],
  },
  {
    id: 'auth',
    title: '🔐 Проблемы со входом',
    steps: [
      { step: 'Открой Supabase Auth', url: 'https://app.supabase.com/project/qbypyrzkguwlelyjehbj/auth/users', action: 'Найди пользователя — должен быть active, не banned' },
      { step: 'Проверь таблицу users', url: 'https://app.supabase.com/project/qbypyrzkguwlelyjehbj/editor', action: 'user должен быть в таблице users с role = admin или manager' },
      { step: 'Сбрось пароль через Supabase', url: 'https://app.supabase.com/project/qbypyrzkguwlelyjehbj/auth/users', action: 'Найди пользователя → "Send password reset"' },
    ],
  },
]

// ─── Components ───────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: 'online' | 'offline' | 'warning' }) {
  const colors = { online: 'bg-emerald-500', offline: 'bg-red-500', warning: 'bg-amber-500' }
  const labels = { online: 'online', offline: 'offline', warning: 'warning' }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full ${colors[status]}`} />
      <span className="text-[12px] text-[#6b6b66]">{labels[status]}</span>
    </span>
  )
}

function ExternalLink({ url, label }: { url: string; label: string }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-[12px] text-blue-600 hover:text-blue-800 hover:underline transition-colors">
      {label}
      <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
      </svg>
    </a>
  )
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

function OverviewTab() {
  return (
    <div className="space-y-8">
      {/* Status grid */}
      <div>
        <h2 className="text-[13px] font-semibold text-[#111110] mb-3 uppercase tracking-wide">Статус сервисов</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {SERVICES.map(s => (
            <div key={s.id} className="bg-white border border-[#e4e4e0] rounded-xl p-4">
              <div className="flex items-start justify-between mb-2">
                <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-[15px] font-bold ${s.color}`}>
                  {s.icon}
                </span>
                <StatusDot status={s.status} />
              </div>
              <p className="text-[13px] font-semibold text-[#111110] mt-1">{s.name}</p>
              <p className="text-[11px] text-[#8a8a85] mt-0.5">{s.category}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Dependency flow */}
      <div>
        <h2 className="text-[13px] font-semibold text-[#111110] mb-3 uppercase tracking-wide">Как всё связано</h2>
        <div className="bg-white border border-[#e4e4e0] rounded-xl p-6">
          <div className="flex flex-col items-center gap-0">

            {/* Row 1: GitHub */}
            <FlowBox label="GitHub" sub="Код проекта" color="bg-[#24292f] text-white" />
            <FlowArrow label="push → autodeploy" />

            {/* Row 2: Vercel */}
            <FlowBox label="Vercel" sub="Деплой / Хостинг" color="bg-black text-white" />
            <FlowArrow label="обрабатывает запросы" />

            {/* Row 3: MGlass App */}
            <div className="bg-blue-600 text-white rounded-xl px-6 py-3 text-center shadow-sm">
              <p className="text-[13px] font-bold">MGlass App</p>
              <p className="text-[11px] opacity-75">mglass.vercel.app</p>
            </div>

            {/* Row 4: split into 3 */}
            <div className="flex items-start gap-4 mt-0">
              <div className="flex flex-col items-center">
                <FlowArrow label="" />
                <FlowBox label="Supabase" sub="База данных" color="bg-emerald-600 text-white" />
              </div>
              <div className="flex flex-col items-center">
                <FlowArrow label="" />
                <FlowBox label="Anthropic" sub="Основной AI" color="bg-orange-600 text-white" />
              </div>
              <div className="flex flex-col items-center">
                <FlowArrow label="" />
                <FlowBox label="OpenAI" sub="Голос Whisper" color="bg-teal-600 text-white" />
              </div>
            </div>

            {/* Row 5: channels */}
            <div className="flex items-start gap-4 mt-1">
              <div className="flex flex-col items-center">
                <FlowArrow label="" />
                <FlowBox label="Telegram Bot" sub="Мобильный ввод" color="bg-blue-500 text-white" />
              </div>
              <div className="flex flex-col items-center">
                <FlowArrow label="" />
                <FlowBox label="Wazzup" sub="WhatsApp" color="bg-green-600 text-white" />
              </div>
              <div className="flex flex-col items-center">
                <FlowArrow label="" />
                <FlowBox label="AmoCRM" sub="CRM / лиды" color="bg-violet-600 text-white" />
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* Quick links */}
      <div>
        <h2 className="text-[13px] font-semibold text-[#111110] mb-3 uppercase tracking-wide">Быстрые ссылки</h2>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {[
            { label: 'Vercel Dashboard', url: 'https://vercel.com/dashboard', icon: '▲', color: 'bg-slate-800' },
            { label: 'Supabase Dashboard', url: 'https://app.supabase.com/project/qbypyrzkguwlelyjehbj', icon: '🗄', color: 'bg-emerald-600' },
            { label: 'GitHub Repo', url: 'https://github.com/mukhamorov95/mglass-app', icon: '⌥', color: 'bg-[#24292f]' },
            { label: 'Anthropic Console', url: 'https://console.anthropic.com', icon: '◈', color: 'bg-orange-600' },
            { label: 'Telegram Bot', url: 'https://t.me/mglass_assistant_bot', icon: '✈', color: 'bg-blue-500' },
            { label: 'AmoCRM', url: 'https://mglass.amocrm.ru', icon: '📊', color: 'bg-violet-600' },
          ].map(link => (
            <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-3 bg-white border border-[#e4e4e0] rounded-xl p-4 hover:border-[#111110] hover:shadow-sm transition-all group">
              <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-[13px] font-bold text-white flex-shrink-0 ${link.color}`}>
                {link.icon}
              </span>
              <span className="text-[13px] font-medium text-[#111110] group-hover:text-blue-600">{link.label}</span>
              <svg className="w-3.5 h-3.5 text-[#c4c4be] ml-auto group-hover:text-blue-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}

function FlowBox({ label, sub, color }: { label: string; sub: string; color: string }) {
  return (
    <div className={`${color} rounded-xl px-5 py-2.5 text-center shadow-sm min-w-[120px]`}>
      <p className="text-[12px] font-bold">{label}</p>
      <p className="text-[10px] opacity-70 mt-0.5">{sub}</p>
    </div>
  )
}

function FlowArrow({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center my-1">
      <div className="w-px h-4 bg-[#e4e4e0]" />
      <svg className="w-3 h-3 text-[#c4c4be] -mt-1" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 16l-6-6h12z" />
      </svg>
      {label && <p className="text-[10px] text-[#9a9a95] -mt-0.5">{label}</p>}
    </div>
  )
}

function ServicesTab() {
  const [expanded, setExpanded] = useState<string | null>(null)

  return (
    <div className="space-y-4">
      {SERVICES.map(s => (
        <div key={s.id} className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
          <button
            onClick={() => setExpanded(expanded === s.id ? null : s.id)}
            className="w-full flex items-center gap-4 p-5 hover:bg-[#f8f8f7] transition-colors text-left">
            <span className={`w-10 h-10 rounded-xl flex items-center justify-center text-[16px] font-bold flex-shrink-0 ${s.color}`}>
              {s.icon}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-[14px] font-semibold text-[#111110]">{s.name}</p>
                <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${s.badge}`}>{s.category}</span>
              </div>
              <p className="text-[12px] text-[#6b6b66] mt-0.5 line-clamp-1">{s.description}</p>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              <StatusDot status={s.status} />
              <svg className={`w-4 h-4 text-[#c4c4be] transition-transform ${expanded === s.id ? 'rotate-180' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </button>

          {expanded === s.id && (
            <div className="border-t border-[#f0f0ec] p-5 space-y-5">
              <p className="text-[13px] text-[#6b6b66]">{s.description}</p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* Отвечает за */}
                <div>
                  <p className="text-[11px] font-bold text-[#9a9a95] uppercase tracking-wider mb-2">Отвечает за</p>
                  <ul className="space-y-1">
                    {s.responsible.map((r, i) => (
                      <li key={i} className="flex items-start gap-2 text-[13px] text-[#6b6b66]">
                        <span className="text-[#c4c4be] mt-0.5">—</span>
                        {r}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Ссылки */}
                {s.links.length > 0 && (
                  <div>
                    <p className="text-[11px] font-bold text-[#9a9a95] uppercase tracking-wider mb-2">Ссылки</p>
                    <div className="space-y-2">
                      {s.links.map((link, i) => (
                        <div key={i}>
                          <ExternalLink url={link.url} label={link.label} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* ENV */}
              {s.envVars.length > 0 && (
                <div>
                  <p className="text-[11px] font-bold text-[#9a9a95] uppercase tracking-wider mb-2">Переменные окружения</p>
                  <div className="flex flex-wrap gap-2">
                    {s.envVars.map(v => (
                      <code key={v} className="text-[11px] bg-[#f0f0ec] text-[#6b6b66] px-2 py-1 rounded-md font-mono">{v}</code>
                    ))}
                  </div>
                </div>
              )}

              {/* Dependencies */}
              {s.dependsOn.length > 0 && (
                <div>
                  <p className="text-[11px] font-bold text-[#9a9a95] uppercase tracking-wider mb-2">Зависит от</p>
                  <div className="flex flex-wrap gap-2">
                    {s.dependsOn.map(d => (
                      <span key={d} className="text-[11px] bg-amber-50 text-amber-700 px-2 py-1 rounded-md font-medium">{d}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function EnvTab() {
  return (
    <div className="space-y-4">
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
        <p className="text-[13px] font-semibold text-amber-800 mb-1">⚠️ Где настроены переменные</p>
        <p className="text-[13px] text-amber-700">
          Все переменные хранятся в <strong>Vercel → Settings → Environment Variables</strong>.
          Локально — в файле <code className="bg-amber-100 px-1 rounded font-mono text-[12px]">.env.local</code> (не в git).
          Никогда не публикуй секретные ключи в коде или GitHub.
        </p>
        <div className="mt-2">
          <ExternalLink url="https://vercel.com/mukhamorov95-1222/mglass-app/settings/environment-variables" label="Открыть ENV в Vercel" />
        </div>
      </div>

      <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#f0f0ec] bg-[#f8f8f7]">
              <th className="text-left text-[11px] font-bold text-[#9a9a95] uppercase tracking-wider px-4 py-3">Переменная</th>
              <th className="text-left text-[11px] font-bold text-[#9a9a95] uppercase tracking-wider px-4 py-3">Назначение</th>
              <th className="text-left text-[11px] font-bold text-[#9a9a95] uppercase tracking-wider px-4 py-3">Сервис</th>
              <th className="text-left text-[11px] font-bold text-[#9a9a95] uppercase tracking-wider px-4 py-3">Тип</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f0f0ec]">
            {ENV_VARS.map(v => (
              <tr key={v.name} className="hover:bg-[#f8f8f7] transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <code className="text-[11px] font-mono text-[#111110] bg-[#f0f0ec] px-2 py-1 rounded">{v.name}</code>
                    {v.critical && <span className="text-[10px] bg-red-50 text-red-600 px-1.5 py-0.5 rounded font-semibold">критично</span>}
                  </div>
                </td>
                <td className="px-4 py-3 text-[13px] text-[#6b6b66]">{v.desc}</td>
                <td className="px-4 py-3">
                  <span className="text-[12px] text-[#6b6b66] font-medium">{v.service}</span>
                </td>
                <td className="px-4 py-3">
                  {v.secret
                    ? <span className="text-[11px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-medium">🔐 секрет</span>
                    : <span className="text-[11px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded font-medium">📢 публичный</span>
                  }
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function DiagnosticsTab() {
  const [expanded, setExpanded] = useState<string | null>('site')

  return (
    <div className="space-y-3">
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <p className="text-[13px] text-blue-800">
          <strong>Первый шаг при любой проблеме:</strong> открой{' '}
          <a href="https://vercel.com/mukhamorov95-1222/mglass-app/logs" target="_blank" rel="noopener noreferrer" className="font-semibold underline">
            Vercel Logs
          </a>{' '}
          — там видны все серверные ошибки в реальном времени.
        </p>
      </div>

      {TROUBLESHOOTING.map(section => (
        <div key={section.id} className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
          <button
            onClick={() => setExpanded(expanded === section.id ? null : section.id)}
            className="w-full flex items-center justify-between p-5 hover:bg-[#f8f8f7] transition-colors text-left">
            <p className="text-[14px] font-semibold text-[#111110]">{section.title}</p>
            <svg className={`w-4 h-4 text-[#c4c4be] flex-shrink-0 transition-transform ${expanded === section.id ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {expanded === section.id && (
            <div className="border-t border-[#f0f0ec] p-5">
              <ol className="space-y-3">
                {section.steps.map((step, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="w-6 h-6 rounded-full bg-[#f0f0ec] text-[#6b6b66] flex items-center justify-center text-[11px] font-bold flex-shrink-0 mt-0.5">
                      {i + 1}
                    </span>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] font-semibold text-[#111110]">{step.step}</span>
                        {step.url && <ExternalLink url={step.url} label="открыть" />}
                      </div>
                      <p className="text-[12px] text-[#6b6b66] mt-0.5">{step.action}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function InstructionsTab() {
  const [section, setSection] = useState<string>('deploy')

  const sections = [
    { id: 'deploy', label: '🚀 Обновление системы' },
    { id: 'backup', label: '💾 Backup и восстановление' },
    { id: 'ai', label: '🧠 AI Memory / Knowledge' },
    { id: 'risks', label: '⚠️ Риски и рекомендации' },
  ]

  return (
    <div className="flex gap-6">
      {/* Sidebar */}
      <div className="w-48 flex-shrink-0 space-y-1">
        {sections.map(s => (
          <button key={s.id} onClick={() => setSection(s.id)}
            className={`w-full text-left px-3 py-2 rounded-lg text-[13px] transition-colors ${
              section === s.id
                ? 'bg-[#111110] text-white font-semibold'
                : 'text-[#6b6b66] hover:bg-[#f0f0ec] hover:text-[#111110]'
            }`}>
            {s.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {section === 'deploy' && (
          <div className="space-y-4">
            <h2 className="text-[16px] font-bold text-[#111110]">Как обновляется система</h2>
            <p className="text-[13px] text-[#6b6b66]">
              MGlass работает на автоматическом CI/CD — изменения в коде автоматически деплоятся на production.
            </p>

            <div className="space-y-3">
              {[
                { num: 1, title: 'Изменение кода локально', desc: 'Разработчик вносит изменения в файлы проекта на своём компьютере', icon: '💻' },
                { num: 2, title: 'Commit', desc: 'git commit -m "описание изменений" — сохраняет изменения с описанием', icon: '📝' },
                { num: 3, title: 'Push в GitHub', desc: 'git push origin main — загружает код в репозиторий GitHub', icon: '⬆️' },
                { num: 4, title: 'Vercel автодеплой', desc: 'Vercel автоматически замечает push и запускает сборку проекта (~2-3 мин)', icon: '⚡' },
                { num: 5, title: 'Production обновлён', desc: 'После успешной сборки — mglass.vercel.app обновляется автоматически', icon: '✅' },
              ].map(step => (
                <div key={step.num} className="flex items-start gap-4 bg-white border border-[#e4e4e0] rounded-xl p-4">
                  <span className="text-[20px] flex-shrink-0">{step.icon}</span>
                  <div>
                    <p className="text-[13px] font-semibold text-[#111110]">{step.num}. {step.title}</p>
                    <p className="text-[12px] text-[#6b6b66] mt-0.5">{step.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="bg-[#f8f8f7] border border-[#e4e4e0] rounded-xl p-4 space-y-2">
              <p className="text-[13px] font-semibold text-[#111110]">Где смотреть статус деплоя</p>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <ExternalLink url="https://vercel.com/mukhamorov95-1222/mglass-app/deployments" label="Список деплоев" />
                  <span className="text-[12px] text-[#8a8a85]">— видно Ready / Error</span>
                </div>
                <div className="flex items-center gap-2">
                  <ExternalLink url="https://vercel.com/mukhamorov95-1222/mglass-app/logs" label="Runtime Logs" />
                  <span className="text-[12px] text-[#8a8a85]">— ошибки в реальном времени</span>
                </div>
              </div>
              <p className="text-[13px] font-semibold text-[#111110] mt-3">Как откатить версию</p>
              <p className="text-[12px] text-[#6b6b66]">
                Vercel Dashboard → Deployments → найди предыдущий "Ready" деплой → нажми три точки → "Promote to Production".
                Откат занимает ~30 секунд.
              </p>
            </div>
          </div>
        )}

        {section === 'backup' && (
          <div className="space-y-4">
            <h2 className="text-[16px] font-bold text-[#111110]">Backup и восстановление</h2>

            <div className="grid grid-cols-1 gap-4">
              {[
                {
                  title: '📦 Код проекта',
                  status: 'Автоматически',
                  statusColor: 'bg-emerald-50 text-emerald-700',
                  items: [
                    'GitHub хранит полную историю всех изменений',
                    'Каждый commit = точка восстановления',
                    'Для восстановления: git checkout [commit-hash]',
                  ],
                  link: { label: 'GitHub Commits', url: 'https://github.com/mukhamorov95/mglass-app/commits' },
                },
                {
                  title: '🗄 База данных (Supabase)',
                  status: 'Ручной backup',
                  statusColor: 'bg-amber-50 text-amber-700',
                  items: [
                    'Supabase Pro план: автоматические daily backups',
                    'Free план: нет автобекапов — нужно делать вручную',
                    'SQL Editor → выгрузить нужные таблицы через SELECT',
                    'Или: Supabase Dashboard → Settings → Database → Backups',
                  ],
                  link: { label: 'Supabase Backups', url: 'https://app.supabase.com/project/qbypyrzkguwlelyjehbj/settings/database' },
                },
                {
                  title: '🔑 ENV переменные / Ключи',
                  status: 'Хранить отдельно!',
                  statusColor: 'bg-red-50 text-red-700',
                  items: [
                    'Храни копию .env.local в защищённом месте (1Password, Bitwarden)',
                    'Vercel хранит переменные, но к ним нет прямого экспорта',
                    'Если потеряешь ключ — придётся пересоздавать в каждом сервисе',
                  ],
                  link: { label: 'ENV в Vercel', url: 'https://vercel.com/mukhamorov95-1222/mglass-app/settings/environment-variables' },
                },
              ].map(item => (
                <div key={item.title} className="bg-white border border-[#e4e4e0] rounded-xl p-5">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[14px] font-semibold text-[#111110]">{item.title}</p>
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${item.statusColor}`}>{item.status}</span>
                  </div>
                  <ul className="space-y-1.5 mb-3">
                    {item.items.map((i, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-[13px] text-[#6b6b66]">
                        <span className="text-[#c4c4be] mt-0.5 flex-shrink-0">—</span>
                        {i}
                      </li>
                    ))}
                  </ul>
                  <ExternalLink url={item.link.url} label={item.link.label} />
                </div>
              ))}
            </div>
          </div>
        )}

        {section === 'ai' && (
          <div className="space-y-4">
            <h2 className="text-[16px] font-bold text-[#111110]">AI Memory / Knowledge Base</h2>
            <p className="text-[13px] text-[#6b6b66]">Где хранятся знания AI и как ими управлять.</p>

            <div className="space-y-3">
              {[
                {
                  title: '🤖 Системный промпт ботов',
                  location: 'app/api/wazzup/webhook/route.ts → константа SYSTEM',
                  desc: 'Личность Владислава, правила общения, стиль ответов, приёмы продаж. Изменяется в коде.',
                  editWhere: 'В коде → деплой',
                },
                {
                  title: '📚 Дополнительные знания AI',
                  location: 'Supabase → таблица ai_settings, ключ bot_extra_knowledge',
                  desc: 'Часто задаваемые вопросы, актуальные цены, новые продукты. Обновляется без деплоя — прямо из таблицы.',
                  editWhere: 'Supabase → ai_settings',
                },
                {
                  title: '📝 Задачи для улучшения AI',
                  location: 'Supabase → таблица ai_training_tasks',
                  desc: 'Задачи от менеджеров через Telegram-бот ("Задача AI" в меню). Помогает понять что улучшить.',
                  editWhere: 'Telegram бот → "Задача AI"',
                },
                {
                  title: '💬 История AI-диалогов',
                  location: 'Supabase → таблица ai_conversations',
                  desc: 'Все сообщения WhatsApp-бота. Используется как контекст (последние 20 сообщений).',
                  editWhere: 'Supabase → ai_conversations (только просмотр)',
                },
                {
                  title: '📋 Параметры парсинга (Telegram)',
                  location: 'app/api/telegram/webhook/route.ts → PARSE_SYSTEM + PARSE_TOOL',
                  desc: 'Правила как AI распознаёт параметры изделий из текста/голоса. Изменяется в коде.',
                  editWhere: 'В коде → деплой',
                },
              ].map(item => (
                <div key={item.title} className="bg-white border border-[#e4e4e0] rounded-xl p-4">
                  <p className="text-[13px] font-semibold text-[#111110] mb-1">{item.title}</p>
                  <p className="text-[12px] text-[#6b6b66] mb-2">{item.desc}</p>
                  <div className="flex flex-wrap gap-3">
                    <div>
                      <span className="text-[10px] text-[#9a9a95] uppercase font-bold">Где лежит:</span>
                      <code className="block text-[11px] font-mono text-[#6b6b66] bg-[#f0f0ec] px-2 py-1 rounded mt-1">{item.location}</code>
                    </div>
                    <div>
                      <span className="text-[10px] text-[#9a9a95] uppercase font-bold">Как изменить:</span>
                      <p className="text-[12px] text-blue-600 font-medium mt-1">{item.editWhere}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {section === 'risks' && (
          <div className="space-y-4">
            <h2 className="text-[16px] font-bold text-[#111110]">Риски и рекомендации</h2>

            <div className="space-y-3">
              {[
                { severity: 'high', title: 'Нет мониторинга uptime', desc: 'Сайт может упасть и никто не узнает сразу.', fix: 'Подключить UptimeRobot (бесплатно) — отправит SMS/email при падении. uptimerobot.com', status: '❌ не настроено' },
                { severity: 'high', title: 'Нет backup базы данных', desc: 'Supabase Free не делает автоматические бекапы.', fix: 'Апгрейд до Supabase Pro ($25/мес) или ручной экспорт данных раз в неделю', status: '❌ не настроено' },
                { severity: 'medium', title: 'Нет error tracking', desc: 'Ошибки в коде не фиксируются централизованно, только в Vercel Logs.', fix: 'Подключить Sentry.io — бесплатно для малых проектов. Покажет все ошибки с трейсами.', status: '⚠️ не настроено' },
                { severity: 'medium', title: 'Нет кастомного домена', desc: 'Сайт работает на mglass.vercel.app — не профессионально.', fix: 'Купить домен mglass.ru или mglass.pro → подключить в Vercel Settings → Domains', status: '⚠️ не настроено' },
                { severity: 'low', title: 'Отсутствует audit log', desc: 'Нет записей кто что изменил в системе.', fix: 'Добавить таблицу audit_log в Supabase с триггерами на ключевые таблицы', status: '⚠️ можно позже' },
                { severity: 'low', title: 'Ротация API ключей', desc: 'API ключи не ротируются.', fix: 'Раз в 6 месяцев обновлять ключи Anthropic, OpenAI, Telegram → обновить в Vercel ENV', status: '⚠️ можно позже' },
              ].map(risk => (
                <div key={risk.title} className={`bg-white border rounded-xl p-4 ${
                  risk.severity === 'high' ? 'border-red-200' : risk.severity === 'medium' ? 'border-amber-200' : 'border-[#e4e4e0]'
                }`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-[13px] font-semibold text-[#111110]">{risk.title}</p>
                        <span className={`text-[11px] px-2 py-0.5 rounded font-medium ${
                          risk.severity === 'high' ? 'bg-red-50 text-red-600' :
                          risk.severity === 'medium' ? 'bg-amber-50 text-amber-700' :
                          'bg-gray-50 text-gray-600'
                        }`}>{risk.status}</span>
                      </div>
                      <p className="text-[12px] text-[#6b6b66] mb-2">{risk.desc}</p>
                      <p className="text-[12px] text-[#111110]"><strong>Как исправить:</strong> {risk.fix}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function InfrastructurePage() {
  const [tab, setTab] = useState<Tab>('overview')

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview',     label: '🗺️ Карта системы' },
    { id: 'services',     label: '🛠️ Сервисы' },
    { id: 'env',          label: '🔑 ENV' },
    { id: 'diagnostics',  label: '🚨 Диагностика' },
    { id: 'instructions', label: '📚 Инструкции' },
  ]

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-[20px] font-semibold text-[#111110]">Технический центр</h1>
        <p className="text-[13px] text-[#8a8a85] mt-0.5">Карта инфраструктуры MGlass — сервисы, ключи, диагностика, инструкции</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-[#f0f0ec] rounded-xl p-1 overflow-x-auto">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex-shrink-0 px-4 py-2 rounded-lg text-[13px] font-medium transition-all ${
              tab === t.id
                ? 'bg-white text-[#111110] shadow-sm'
                : 'text-[#6b6b66] hover:text-[#111110]'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'overview'     && <OverviewTab />}
      {tab === 'services'     && <ServicesTab />}
      {tab === 'env'          && <EnvTab />}
      {tab === 'diagnostics'  && <DiagnosticsTab />}
      {tab === 'instructions' && <InstructionsTab />}
    </div>
  )
}
