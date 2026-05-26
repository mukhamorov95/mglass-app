// AmoCRM API v4 client — read-only, no writes to CRM cards.
// Uses existing env vars: AMO_SUBDOMAIN, AMO_CLIENT_ID, AMO_CLIENT_SECRET, AMO_ACCESS_TOKEN.

function domain() {
  const sub = process.env.AMO_SUBDOMAIN ?? ''
  return sub.includes('.') ? sub : `${sub}.amocrm.ru`
}

async function getAccessToken(): Promise<string> {
  // Current access token is long-lived (expires 2029). Use it directly.
  // If expired, refresh using OAuth2.
  const current = process.env.AMO_ACCESS_TOKEN
  if (current) return current

  // Fallback: refresh via OAuth2 (requires AMO_REFRESH_TOKEN)
  const refreshToken = process.env.AMO_REFRESH_TOKEN
  if (!refreshToken) throw new Error('AMO_ACCESS_TOKEN and AMO_REFRESH_TOKEN are both missing')

  const res = await fetch(`https://${domain()}/oauth2/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id:     process.env.AMO_CLIENT_ID,
      client_secret: process.env.AMO_CLIENT_SECRET,
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
      redirect_uri:  process.env.AMO_REDIRECT_URI ?? 'https://localhost',
    }),
  })
  if (!res.ok) throw new Error(`AmoCRM token refresh failed: ${res.status}`)
  const json = await res.json()
  return json.access_token as string
}

export async function amoGet<T = unknown>(
  path: string,
  params: Record<string, string> = {},
): Promise<T | null> {
  const token = await getAccessToken()
  const url   = new URL(`https://${domain()}/api/v4${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 204 || res.status === 404) return null
  if (!res.ok) throw new Error(`AmoCRM GET ${path} → ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

export async function amoGetAll<T>(
  path: string,
  params: Record<string, string>,
  embedded_key: string,
): Promise<T[]> {
  const results: T[] = []
  let page = 1
  while (true) {
    const data = await amoGet<{ _embedded: Record<string, T[]>; _links?: { next?: unknown } }>(
      path, { ...params, page: String(page), limit: '250' },
    )
    const items = data?._embedded?.[embedded_key] ?? []
    results.push(...items)
    if (!data?._links?.next || items.length < 250) break
    page++
    await new Promise(r => setTimeout(r, 150))
  }
  return results
}

// ── Typed helpers ──────────────────────────────────────────────────────────────

export type AmoUser   = { id: number; name: string; email: string }
export type AmoLead   = {
  id: number; name: string; status_id: number; pipeline_id: number
  responsible_user_id: number; created_at: number; updated_at: number; closed_at: number | null
}
export type AmoEvent  = {
  id: string; type: string; entity_id: number; entity_type: string
  created_by: number; created_at: number
  value_after?: Array<{ lead_status?: { id: number; name: string } }>
}
export type AmoStage    = { id: number; name: string; sort: number }
export type AmoPipeline = { id: number; name: string; _embedded: { statuses: AmoStage[] } }

export const getUsers = () =>
  amoGet<{ _embedded: { users: AmoUser[] } }>('/users').then(d => d?._embedded?.users ?? [])

export const getPipelines = () =>
  amoGet<{ _embedded: { pipelines: AmoPipeline[] } }>('/pipelines').then(d => d?._embedded?.pipelines ?? [])

export const getLeads  = (params: Record<string, string>) =>
  amoGetAll<AmoLead>('/leads', params, 'leads')

export const getEvents = (params: Record<string, string>) =>
  amoGetAll<AmoEvent>('/events', params, 'events')

export const getDomain = domain
