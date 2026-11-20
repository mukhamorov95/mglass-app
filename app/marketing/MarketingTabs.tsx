import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getRole } from '@/lib/getRole'

const TABS = [
  { href: '/marketing', label: 'Статистика' },
  { href: '/marketing/objects', label: 'Объекты' },
  { href: '/marketing/agents', label: 'Агенты' },
  { href: '/marketing/sites', label: 'Сайты' },
]

export async function requireMarketing() {
  const role = await getRole()
  if (!role) redirect('/login')
  if (!['admin', 'ceo', 'seo'].includes(role)) redirect('/')
}

export function MarketingTabs({ active, sub }: { active: string; sub?: string }) {
  return (
    <header className="mb-6">
      <h1 className="text-2xl font-semibold text-[#111110]">Маркетинг</h1>
      {sub && <p className="mt-1 text-sm text-[#9a9a95]">{sub}</p>}
      <nav className="mt-4 flex gap-1 border-b border-[#e4e4e0]">
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${t.href === active ? 'border-[#111110] font-medium text-[#111110]' : 'border-transparent text-[#9a9a95] hover:text-[#111110]'}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
    </header>
  )
}
