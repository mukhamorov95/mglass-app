import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { createClient } from '@/lib/supabase-server'
import { getUserProfile, DEFAULT_PERMISSIONS } from '@/lib/getRole'
import { Sidebar } from '@/components/Sidebar'
import CartProvider from '@/components/CartProvider'
import { OrganizationProvider } from '@/lib/hooks/use-organization'
import type { OrgRole } from '@/lib/hooks/use-organization'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin', 'cyrillic'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin', 'cyrillic'] })

export const metadata: Metadata = {
  title: 'MGlass — CRM',
  description: 'Система управления заказами и CRM для MGlass',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'M-Glass',
  },
  // app/icon.png и app/favicon.ico Next раздаёт сам; apple-touch — явно (iOS не читает манифест)
  icons: { apple: '/apple-touch-icon.png' },
  formatDetection: { telephone: false },
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const profile = user ? await getUserProfile() : null
  const role = profile?.role ?? null
  const permissions = profile?.permissions ?? DEFAULT_PERMISSIONS

  // Seed org context server-side so client components never show a loading state
  let orgId = 1
  let orgRole: OrgRole = 'manager'
  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('organization_id, role')
      .eq('user_id', user.id)
      .single()
    if (profile) {
      orgId = profile.organization_id
      orgRole = (profile.role as OrgRole) ?? 'manager'
    }
  }

  return (
    <html lang="ru" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#111110" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
      </head>
      <body className="min-h-full bg-[#f8f8f7]">
        <OrganizationProvider initialOrgId={orgId} initialRole={orgRole}>
          <CartProvider>
            {user ? (
              <div className="flex min-h-screen">
                <Sidebar userEmail={user.email ?? ''} role={role} permissions={permissions} />
                <main className="flex-1 min-w-0 pt-12 lg:pt-0">{children}</main>
              </div>
            ) : (
              <main className="min-h-screen">{children}</main>
            )}
          </CartProvider>
        </OrganizationProvider>
      </body>
    </html>
  )
}
