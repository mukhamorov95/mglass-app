import { NextResponse } from 'next/server'
import { viaSupabaseProxy } from '@/lib/supabaseProxy'

// Редирект на файл хранилища (подписанная ссылка) — через прокси /supabase, а не на
// supabase.co. Location относительный, поэтому NextResponse.redirect (он требует
// абсолютный адрес) здесь не годится.
export function redirectToStorage(signedUrl: string): NextResponse {
  return new NextResponse(null, { status: 307, headers: { Location: viaSupabaseProxy(signedUrl) } })
}
