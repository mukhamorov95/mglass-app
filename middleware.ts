import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { canAccessRoute, normalizeRole, type Role, type B2BScope } from './lib/getRole'
import { classifyDevice } from './lib/deviceClass'

const OWNER_BOOTSTRAP_EMAIL = 'admin@mglass.ru'

function normalizeB2BScope(v: unknown): B2BScope {
  return v === 'mglass_only' ? 'mglass_only' : null
}

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  // Редирект ОБЯЗАН уносить с собой куки, которые @supabase/ssr записал в
  // supabaseResponse при рефреше токена: refresh token ротируется (старый
  // гасится), и потерять новые куки = убить сессию пользователя. Симптом:
  // «утром работает, днём выкидывает на логин».
  const redirect = (url: URL) => {
    const res = NextResponse.redirect(url)
    supabaseResponse.cookies.getAll().forEach(c => res.cookies.set(c))
    return res
  }

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

  const { data: { user }, error: authError } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname
  const isLoginPage   = pathname === '/login'
  const isAccessDenied = pathname === '/access-denied'
  const isDeviceLimit  = pathname === '/device-limit'
  const isWebhook = pathname.startsWith('/api/wazzup/') ||
                    pathname.startsWith('/api/amo/webhook') ||
                    pathname.startsWith('/api/cron/') ||
                    pathname.startsWith('/api/telegram/') ||
                    pathname.startsWith('/api/avito/webhook') ||
                    pathname.startsWith('/api/onlinepbx/')

  // Транзиентный сбой Auth (таймаут/5xx/рейт-лимит) ≠ «нет сессии»: пропускаем
  // запрос как есть — сессия скорее всего жива, редирект на /login затёр бы её
  const authTransient = !!authError && (authError.status == null || authError.status === 0 || authError.status === 429 || authError.status >= 500)
  if (!user && authTransient && !isLoginPage) {
    return supabaseResponse
  }

  if (!user && !isLoginPage && !isWebhook) {
    const url = request.nextUrl.clone()
    // Голый redirect БЕЗ переноса кук: при гонке ротации refresh-токена
    // (параллельные запросы с планшета) проигравший нёс бы сюда ОЧИЩЕННЫЕ куки
    // и затирал свежую сессию, которую только что записал победитель
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  if (user && isLoginPage) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return redirect(url)
  }

  // Лимит устройств: 1 телефон + 1 ПК на аккаунт. Если для класса устройства
  // зарегистрировано ДРУГОЕ активное устройство — этот вход вытеснен (kick-old
  // при новом логине) → страница /device-limit. Проверка кэшируется кукой
  // device-ok на 5 минут; ошибки БД (нет таблицы и т.п.) — fail-open.
  if (user && !isLoginPage && !isAccessDenied && !isDeviceLimit && !isWebhook && !pathname.startsWith('/api/')) {
    const deviceId = request.cookies.get('device-id')?.value
    const okFor    = request.cookies.get('device-ok')?.value
    if (!deviceId) {
      // первое посещение: выдать идентификатор; регистрация произойдёт при логине
      supabaseResponse.cookies.set('device-id', crypto.randomUUID(), {
        maxAge: 60 * 60 * 24 * 400, path: '/', httpOnly: true, sameSite: 'lax',
      })
    } else if (okFor !== deviceId) {
      try {
        const cls = classifyDevice(request.headers.get('user-agent'))
        const { data: reg } = await supabase.from('user_devices')
          .select('device_id')
          .eq('user_id', user.id).eq('device_class', cls).is('revoked_at', null)
          .maybeSingle()
        if (reg && reg.device_id !== deviceId) {
          const url = request.nextUrl.clone()
          url.pathname = '/device-limit'
          return redirect(url)
        }
        // устройство совпадает или ещё не зарегистрировано (legacy-сессия) — пропускаем
        supabaseResponse.cookies.set('device-ok', deviceId, {
          maxAge: 300, path: '/', httpOnly: true, sameSite: 'lax',
        })
        // Тик активности (раз в ~5 мин на пользователя): «кто заходил сегодня»
        // в /admin/security. first_seen фиксируется INSERT'ом, last_seen обновляется.
        const nowIso = new Date().toISOString()
        await supabase.from('user_activity_days').upsert(
          { user_id: user.id, day: nowIso.slice(0, 10), last_seen: nowIso },
          { onConflict: 'user_id,day' },
        )
      } catch { /* fail-open: проверка безопасности не должна ронять приложение */ }
    }
  }

  // Role-based route protection
  if (user && !isLoginPage && !isAccessDenied && !isDeviceLimit && !isWebhook) {
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
      return redirect(url)
    }

    if (role && !canAccessRoute(role, pathname, { b2bScope: b2bScope ?? null })) {
      const url = request.nextUrl.clone()
      url.pathname = '/access-denied'
      return redirect(url)
    }
  }

  return supabaseResponse
}

export const config = {
  // manifest/webmanifest обязаны быть публичными: браузер запрашивает манифест
  // БЕЗ кук (credentials omit по спеке) — редирект на /login ломает установку PWA.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.json|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|webmanifest)$).*)'],
}
