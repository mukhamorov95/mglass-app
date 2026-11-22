import 'server-only'
import { createServiceClient } from '@/lib/supabase-service'

// Токен Метрики: переменная окружения (если задана) или подключённый кнопкой
// «Подключить Метрику» — лежит в integration_tokens, читается только сервером.
export const METRIKA_CLIENT_ID = 'ac08b778b3af4cb68bf3c2e7bae5b58a'
export const METRIKA_REDIRECT = 'https://app.mglass.pro/marketing/traffic/connect'
export const metrikaAuthorizeUrl = () =>
  `https://oauth.yandex.ru/authorize?response_type=token&client_id=${METRIKA_CLIENT_ID}&redirect_uri=${encodeURIComponent(METRIKA_REDIRECT)}&force_confirm=yes`

export async function getMetrikaToken(): Promise<{ token: string | null; error: string | null }> {
  if (process.env.YANDEX_METRIKA_TOKEN) return { token: process.env.YANDEX_METRIKA_TOKEN, error: null }
  const { data, error } = await createServiceClient().from('integration_tokens').select('token').eq('key', 'yandex_metrika').maybeSingle()
  if (error) return { token: null, error: error.message }
  return { token: data?.token ?? null, error: null }
}
