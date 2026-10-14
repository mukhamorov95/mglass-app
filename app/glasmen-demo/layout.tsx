import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getRole, isOwnerRole } from '@/lib/getRole'

export const metadata = { title: 'GLASMEN · демо' }

const NAV = [
  { href: '/glasmen-demo', label: 'Главная демо' },
  { href: '/glasmen-demo/quote', label: 'Расчёт' },
  { href: '/glasmen-demo/materials', label: 'Материалы' },
]

export default async function GlasmenDemoLayout({ children }: { children: React.ReactNode }) {
  const role = await getRole()
  if (!isOwnerRole(role)) redirect('/')

  return (
    <div className="min-h-screen bg-[#f5f5f3] text-[#111110]">
      <header className="z-30 border-b lg:sticky lg:top-0 border-[#e4e4e0] bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3">
          <Link href="/glasmen-demo" className="text-[15px] font-semibold tracking-tight">
            GLASMEN <span className="font-normal text-[#9a9a95]">· демо</span>
          </Link>
          <nav className="flex flex-wrap gap-1 text-[13px]">
            {NAV.map(n => (
              <Link key={n.href} href={n.href} className="rounded-md px-2.5 py-1.5 text-[#55554f] hover:bg-[#f5f5f3] hover:text-[#111110]">
                {n.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="border-t border-amber-200 bg-amber-50">
          <p className="mx-auto max-w-6xl px-4 py-2 text-[12px] leading-snug text-amber-900">
            Демо для владельца. Цены — наш действующий прайс; варианты лесенки — черновик, ждут решения 4. Сроки и правила стекла — черновик, ждут замера и технолога.
          </p>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 pb-16 pt-6">{children}</div>
    </div>
  )
}
