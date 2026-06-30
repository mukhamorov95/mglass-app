import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { canAccessRoute, normalizeRole, type Role, type B2BScope } from './lib/getRole'

const OWNER_BOOTSTRAP_EMAIL = 'admin@mglass.ru'

function normalizeB2BScope(v: unknown): B2BScope {
  return v === 'mglass_only' ? 'mglass_only' : null
}

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
    const cached      = request.cookies.get('user-role')?.value
    const cachedScope = request.cookies.get('user-b2b-scope')?.value
    let role: Role | null = normalizeRole(cached)
    // Empty-string cookie means "we already checked and there is no scope" —
    // distinct from "not checked yet" (undefined).
    let b2bScope: B2BScope | undefined =
      cachedScope === undefined ? undefined : normalizeB2BScope(cachedScope)

    if (!role || b2bScope === undefined) {
      const { data } = await supabase
        .from('users')
        .select('role, permissions')
        .eq('id', user.id)
        .single()
      role = normalizeRole(data?.role)
      // Bootstrap: known owner email gets admin rights even with no DB row.
      if (!role && user.email === OWNER_BOOTSTRAP_EMAIL) role = 'admin'
      const perms = (data?.permissions ?? null) as { b2b_client_scope?: unknown } | null
      b2bScope = normalizeB2BScope(perms?.b2b_client_scope)
      if (role) {
        supabaseResponse.cookies.set('user-role', role, {
          maxAge: 3600, path: '/', httpOnly: true, sameSite: 'lax',
        })
      }
      // Cache scope even when null so we don't hit the DB on every request.
      supabaseResponse.cookies.set('user-b2b-scope', b2bScope ?? '', {
        maxAge: 3600, path: '/', httpOnly: true, sameSite: 'lax',
      })
    }

    // Redirect production workers from the home page to their app
    if (role === 'production' && pathname === '/') {
      const url = request.nextUrl.clone()
      url.pathname = '/production-app'
      return NextResponse.redirect(url)
    }

    if (role && !canAccessRoute(role, pathname, { b2bScope: b2bScope ?? null })) {
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
