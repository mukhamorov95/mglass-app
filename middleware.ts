import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { canAccessRoute, isOwnerRole, normalizeRole, type Role, type B2BScope } from './lib/getRole'
import { classifyDevice } from './lib/deviceClass'
import { OWNER_2FA_COOKIE, isOwner2faEnabled, owner2faSecret, verifyOwner2faCookie } from './lib/owner2faCookie'

const OWNER_BOOTSTRAP_EMAIL = 'admin@mglass.ru'

function normalizeB2BScope(v: unknown): B2BScope {
  if (v === 'mglass_only') return 'mglass_only'
  if (v === 'all_clients') return 'all_clients'
  return null
}

// Кэш роли/скоупа в куках привязан к id пользователя: `${userId}|${value}`.
// Это (1) не даёт чужой сессии на том же браузере унаследовать чужие права и
// (2) делает старые куки (без разделителя) недействительными на деплое —
// значит после смены прав в БД кука-миска заставит middleware перечитать базу,
// а не тянуть протухшее значение. Возвращаем value только если префикс = userId.
function readScoped(cookieValue: string | undefined, userId: string): string | undefined {
  if (cookieValue === undefined) return undefined
  const sep = cookieValue.indexOf('|')
  if (sep < 0) return undefined                       // старый формат → cache-miss
  if (cookieValue.slice(0, sep) !== userId) return undefined
  return cookieValue.slice(sep + 1)
}
const ROLE_COOKIES = ['user-role', 'user-b2b-scope', 'user-mgr-ws'] as const

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
                    pathname.startsWith('/api/onlinepbx/') ||
                    // Публичный приём заявок с сайта Mglass (антиспам — в самом роуте)
                    pathname.startsWith('/api/site/') ||
                    // ICS-фид календаря владельца: календарь не умеет логиниться,
                    // аутентификация — секрет в URL (проверяется в самом роуте)
                    pathname.startsWith('/api/vlad/calendar/')
  // Публичные демо-страницы дизайна (только вымышленные данные, без запросов к БД).
  const isPublicDemo = pathname.startsWith('/design/')

  // Транзиентный сбой Auth (таймаут/5xx/рейт-лимит) ≠ «нет сессии»: пропускаем
  // запрос как есть — сессия скорее всего жива, редирект на /login затёр бы её
  const authTransient = !!authError && (authError.status == null || authError.status === 0 || authError.status === 429 || authError.status >= 500)
  if (!user && authTransient && !isLoginPage) {
    return supabaseResponse
  }

  if (!user && !isLoginPage && !isWebhook && !isPublicDemo) {
    const url = request.nextUrl.clone()
    // Голый redirect БЕЗ переноса кук: при гонке ротации refresh-токена
    // (параллельные запросы с планшета) проигравший нёс бы сюда ОЧИЩЕННЫЕ куки
    // и затирал свежую сессию, которую только что записал победитель
    url.pathname = '/login'
    const res = NextResponse.redirect(url)
    // Разлогинились — гасим кэш роли/скоупа, чтобы следующий вход перечитал БД.
    for (const c of ROLE_COOKIES) res.cookies.delete(c)
    return res
  }

  // На странице логина тоже стираем кэш прав: единственный надёжный момент
  // инвалидации после «Выйти» (signOut чистит только куки авторизации).
  if (isLoginPage) {
    for (const c of ROLE_COOKIES) supabaseResponse.cookies.delete(c)
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
  if (user && !isLoginPage && !isAccessDenied && !isDeviceLimit && !isWebhook && !isPublicDemo && !pathname.startsWith('/api/')) {
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
  if (user && !isLoginPage && !isAccessDenied && !isDeviceLimit && !isWebhook && !isPublicDemo) {
    const cached      = readScoped(request.cookies.get('user-role')?.value, user.id)
    const cachedScope = readScoped(request.cookies.get('user-b2b-scope')?.value, user.id)
    const cachedMgr   = readScoped(request.cookies.get('user-mgr-ws')?.value, user.id)
    let role: Role | null = normalizeRole(cached)
    // Empty-string payload means "checked, no scope" — distinct from "not checked
    // yet" (undefined). readScoped returns undefined for another user's / old cookie.
    let b2bScope: B2BScope | undefined =
      cachedScope === undefined ? undefined : normalizeB2BScope(cachedScope)
    // '1'/'0' — проверено; undefined — ещё не читали (новая кука после деплоя).
    let mgrWs: boolean | undefined = cachedMgr === undefined ? undefined : cachedMgr === '1'

    if (!role || b2bScope === undefined || mgrWs === undefined) {
      const { data } = await supabase
        .from('users')
        .select('role, permissions')
        .eq('id', user.id)
        .single()
      role = normalizeRole(data?.role)
      // Bootstrap: known owner email gets admin rights even with no DB row.
      if (!role && user.email === OWNER_BOOTSTRAP_EMAIL) role = 'admin'
      const perms = (data?.permissions ?? null) as { b2b_client_scope?: unknown; manager_workspace?: unknown } | null
      b2bScope = normalizeB2BScope(perms?.b2b_client_scope)
      mgrWs = perms?.manager_workspace === true
      if (role) {
        supabaseResponse.cookies.set('user-role', `${user.id}|${role}`, {
          maxAge: 3600, path: '/', httpOnly: true, sameSite: 'lax',
        })
      }
      // Cache scope even when null so we don't hit the DB on every request.
      supabaseResponse.cookies.set('user-b2b-scope', `${user.id}|${b2bScope ?? ''}`, {
        maxAge: 3600, path: '/', httpOnly: true, sameSite: 'lax',
      })
      supabaseResponse.cookies.set('user-mgr-ws', `${user.id}|${mgrWs ? '1' : '0'}`, {
        maxAge: 3600, path: '/', httpOnly: true, sameSite: 'lax',
      })
    }

    // Второй фактор для владельца (owner-tier). Пока OWNER_2FA_ENABLED не задан —
    // не срабатывает вовсе (ноль риска локаута; сбросил флаг = сразу обычный вход).
    // Кука owner-2fa-ok подписана HMAC — подделать, зная только пароль, нельзя.
    // Выход на /login/2fa и сами роуты 2fa/* исключены, иначе не подтвердить код.
    if (isOwner2faEnabled() && role && isOwnerRole(role)) {
      const twofaExempt = pathname === '/login/2fa' || pathname.startsWith('/api/security/2fa/')
      if (!twofaExempt) {
        const passed = await verifyOwner2faCookie(request.cookies.get(OWNER_2FA_COOKIE)?.value, user.id, owner2faSecret())
        if (!passed) {
          if (pathname.startsWith('/api/')) {
            const res = NextResponse.json({ error: '2fa_required' }, { status: 401 })
            supabaseResponse.cookies.getAll().forEach(c => res.cookies.set(c))
            return res
          }
          const url = request.nextUrl.clone()
          url.pathname = '/login/2fa'
          return redirect(url)
        }
      }
    }

    // Redirect production workers from the home page to their app
    if (role === 'production' && pathname === '/') {
      const url = request.nextUrl.clone()
      url.pathname = '/production-app'
      return redirect(url)
    }

    if (role && !canAccessRoute(role, pathname, { b2bScope: b2bScope ?? null, managerWorkspace: mgrWs ?? false })) {
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
