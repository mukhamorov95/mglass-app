// Браузер не должен ходить на *.supabase.co напрямую: у части провайдеров адрес режется
// (#173), поэтому всё идёт через same-origin /supabase/* (rewrite в next.config.ts).
// Сервер же получает от Supabase абсолютные ссылки — подписанные на файл, публичные на
// картинку. Прежде чем отдать такую ссылку браузеру, переводим её на /supabase.
//
// Путь относительный: адрес приложения бывает разным (vercel.app, свой домен за российским
// входом), браузер подставит тот, на котором открыт.
export function viaSupabaseProxy(url: string, supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''): string {
  const base = supabaseUrl.replace(/\/+$/, '')
  if (base && url.startsWith(base + '/')) return '/supabase' + url.slice(base.length)
  return url
}
