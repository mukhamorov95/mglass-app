import { AGENTS, type AgentStatus } from '@/lib/marketing/agents'
import { MarketingTabs, requireMarketing } from '../MarketingTabs'

const BADGE: Record<AgentStatus, string> = {
  'работает': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'вручную': 'bg-amber-50 text-amber-800 border-amber-200',
  'не начат': 'bg-[#f5f5f3] text-[#9a9a95] border-[#e4e4e0]',
}

const FLOW = ['Монтажи', 'Сборщик', 'Фоторедактор', 'Автор', 'Модератор', 'Владелец «да»', 'Публикатор', 'Аналитик']

export default async function MarketingAgentsPage() {
  await requireMarketing()
  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <MarketingTabs active="/marketing/agents" sub="Заказ → объект → публикация → заявки. Наружу ничего не уходит без «да» владельца" />

      <ol className="mb-6 flex flex-wrap items-center gap-1.5 text-xs">
        {FLOW.map((s, i) => (
          <li key={s} className="flex items-center gap-1.5">
            <span className={`rounded-full border px-2.5 py-1 ${s.includes('Владелец') ? 'border-[#111110] bg-[#111110] text-white' : 'border-[#e4e4e0] bg-white'}`}>{s}</span>
            {i < FLOW.length - 1 && <span className="text-[#9a9a95]">→</span>}
          </li>
        ))}
      </ol>

      <div className="grid gap-3 md:grid-cols-2">
        {AGENTS.map((a) => (
          <article key={a.key} className="rounded-xl border border-[#e4e4e0] bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold text-[#111110]">{a.name}</h2>
                <p className="text-sm text-[#111110]/80">{a.job}</p>
              </div>
              <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${BADGE[a.status]}`}>{a.status}</span>
            </div>
            <dl className="mt-3 grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1.5 text-sm">
              <dt className="text-[#9a9a95]">Когда</dt><dd>{a.trigger}</dd>
              <dt className="text-[#9a9a95]">Берёт</dt><dd>{a.input}</dd>
              <dt className="text-[#9a9a95]">Отдаёт</dt><dd>{a.output}</dd>
              <dt className="text-[#9a9a95]">Проверяет</dt><dd>{a.checks}</dd>
              <dt className="text-[#9a9a95]">Утверждает</dt><dd>{a.gate}</dd>
            </dl>
            <p className="mt-3 border-t border-[#e4e4e0] pt-2 text-xs text-[#9a9a95]">{a.statusNote}</p>
          </article>
        ))}
      </div>
      <p className="mt-4 text-xs text-[#9a9a95]">Порядок работы каждого агента — .claude/agents/marketing-*.md в репозитории; «вручную» — работу делает Claude в сессии по этому порядку.</p>
    </div>
  )
}
