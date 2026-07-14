import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch (e) {
            // Set в RSC-рендере запрещён — рефреш кук берёт на себя middleware.
            // Логируем, чтобы потеря токена на непокрытых путях не была немой.
            console.warn('supabase-server: setAll отклонён (RSC render?)', e instanceof Error ? e.message : e)
          }
        },
      },
    }
  )
}
