import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { createClient } from '@/lib/supabase-server'
import { getRole } from '@/lib/getRole'
import { Sidebar } from '@/components/Sidebar'
import CartProvider from '@/components/CartProvider'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'MGlass — Калькулятор',
  description: 'Система расчёта заказов MGlass',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const role = user ? await getRole() : null

  return (
    <html lang="ru" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-[#f8f8f7]">
        <CartProvider>
          {user ? (
            <div className="flex min-h-screen">
              <Sidebar userEmail={user.email ?? ''} role={role} />
              <main className="flex-1 min-w-0 pt-12 lg:pt-0">{children}</main>
            </div>
          ) : (
            <main className="min-h-screen">{children}</main>
          )}
        </CartProvider>
      </body>
    </html>
  )
}
