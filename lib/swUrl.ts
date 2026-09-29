// Один адрес service worker на всё приложение: регистрации с разными адресами на одной
// области вытесняют друг друга. ?sb= — хост Supabase, ссылки на хранилище которого
// service worker переводит на прокси /supabase (public/sw.js).
export function swUrl(supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''): string {
  let host = ''
  try { host = new URL(supabaseUrl).host } catch { /* нет адреса — без подмены */ }
  return host ? `/sw.js?sb=${encodeURIComponent(host)}` : '/sw.js'
}
