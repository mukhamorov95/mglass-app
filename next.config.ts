import type { NextConfig } from 'next'
import { withSentryConfig } from '@sentry/nextjs'

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
  // Прокси Supabase через свой домен: у части сотрудников провайдер блокирует
  // *.supabase.co (ERR_CONNECTION_RESET), а mglass-app.vercel.app доступен всегда.
  // Браузерный клиент бьёт в /supabase/*, Vercel проксирует на реальный Supabase —
  // без VPN. (Realtime-вебсокеты сюда не попадают; критичный REST+auth — да.)
  async rewrites() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    if (!url) return []
    return [{ source: '/supabase/:path*', destination: `${url}/:path*` }]
  },
}

export default withSentryConfig(nextConfig, {
  org:     process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent:  true,
  disableLogger: true,
  automaticVercelMonitors: false,
})
