import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { canAccess, type Role } from './lib/getRole'

const VALID_ROLES: Role[] = ['admin', 'manager', 'production', 'seo', 'ceo', 'buyer', 'commercial']

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname
  const isLoginPage   = pathname === '/login'
  const isAccessDenied = pathname === '/access-denied'
  const isWebhook = pathname.startsWith('/api/wazzup/') ||
                    pathname.startsWith('/api/amo/webhook') ||
                    pathname.startsWith('/api/cron/') ||
                    pathname.startsWith('/api/telegram/')

  if (!user && !isLoginPage && !isWebhook) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  if (user && isLoginPage) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  // Role-based route protection
  if (user && !isLoginPage && !isAccessDenied && !isWebhook) {
    const cached = request.cookies.get('user-role')?.value
    let role: Role | null = (cached && VALID_ROLES.includes(cached as Role)) ? cached as Role : null

    if (!role) {
      const { data } = await supabase
        .from('users')
        .select('role')
        .eq('id', user.id)
        .single()
      const r = data?.role
      role = (r && VALID_ROLES.includes(r)) ? r as Role : null
      if (role) {
        supabaseResponse.cookies.set('user-role', role, {
          maxAge: 3600,
          path: '/',
          httpOnly: true,
          sameSite: 'lax',
        })
      }
    }

    // Redirect production workers from the home page to their app
    if (role === 'production' && pathname === '/') {
      const url = request.nextUrl.clone()
      url.pathname = '/production-app'
      return NextResponse.redirect(url)
    }

    if (role && !canAccess(role, pathname)) {
      const url = request.nextUrl.clone()
      url.pathname = '/access-denied'
      return NextResponse.redirect(url)
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
