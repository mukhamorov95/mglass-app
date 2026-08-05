import { getRole, isOwnerRole } from '@/lib/getRole'
import { redirect } from 'next/navigation'
import type { CSSProperties } from 'react'
import PartnerNav from './PartnerNav'

// Кабинет партнёра: только роль 'partner' (и владельцы — для проверки).
// Тёмная премиальная тема кабинета задаётся CSS-переменными на корне —
// все страницы кабинета берут цвета отсюда (bg-[var(--p-...)] и т.д.).
const THEME: CSSProperties = {
  ['--p-bg' as string]: '#141413',
  ['--p-surface' as string]: '#1f1f1e',
  ['--p-surface2' as string]: '#262625',
  ['--p-ink' as string]: '#f4f4f1',
  ['--p-ink2' as string]: '#c8c8c3',
  ['--p-muted' as string]: '#8a8a85',
  ['--p-border' as string]: '#33332f',
  ['--p-acc' as string]: '#d3564a',
  ['--p-acc-ink' as string]: '#ffffff',
  ['--p-brand-lt' as string]: '#d0574a',
  ['--p-brand-dk' as string]: '#a1362a',
}

export default async function PartnerLayout({ children }: { children: React.ReactNode }) {
  const role = await getRole()
  if (!role || (role !== 'partner' && !isOwnerRole(role))) redirect('/')
  return (
    <div className="flex min-h-screen bg-[var(--p-bg)] text-[var(--p-ink)]" style={THEME}>
      <PartnerNav />
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}
