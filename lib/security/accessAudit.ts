// Прогон «кто что видит»: выводы по снимку прав из базы.
//
// Снимок отдаёт SQL-функция security_access_snapshot (политики, гранты, RLS,
// подозрительные колонки). Здесь — правила, по которым он читается. Правила
// выведены из того, что реально нашлось 22.09.2026 и стоило дня работы:
//   • политика выдана роли PUBLIC → в неё входит anon, а предикат вида
//     `not is_partner()` анонима НЕ отсекает: is_partner() построен на EXISTS,
//     а EXISTS при пустом auth.uid() даёт false;
//   • у anon остались гранты на запись — тогда RLS единственные ворота;
//   • RLS включён, а политик нет → таблица молча отдаёт пусто (или, если ворота
//     не нужны, кто-то думает, что они есть);
//   • RLS вообще выключен на таблице с деньгами или людьми;
//   • пароль/секрет хранится колонкой.

// У политик INSERT условие живёт в check, а не в using: первый прогон из-за
// этого объявил «запись без входа» там, где проверка была.
export type SnapshotPolicy = { table: string; policy: string; cmd: string; roles: string[]; using: string | null; check?: string | null }
export type SnapshotGrant = { table: string; grantee: string; privilege: string }
export type SnapshotRls = { table: string; enabled: boolean; policies: number }
export type SnapshotColumn = { table: string; column: string }

export type AccessSnapshot = {
  policies: SnapshotPolicy[]
  grants: SnapshotGrant[]
  rls: SnapshotRls[]
  suspicious_columns: SnapshotColumn[]
}

export type Severity = 'high' | 'medium' | 'low'
export type Finding = { severity: Severity; code: string; table: string; title: string; detail: string }

// Где лежат деньги и люди. Для них правила строже: тут и «RLS выключен» — высокий
// риск, а не замечание. Список ведём руками: он короткий и должен быть осознанным.
export const SENSITIVE_TABLES = new Set([
  'users', 'b2b_clients', 'b2b_client_legal_entities', 'b2b_orders', 'b2b_materials',
  'materials', 'hardware_items', 'services', 'b2b_services', 'financial_settings',
  'supplier_price_rows', 'glass_price_matrix', 'purchase_orders', 'calculations',
  'commercial_proposals', 'deals', 'deal_payments', 'payments', 'manager_stats_daily',
  'manager_stats_monthly', 'coefficients', 'process_cost_inputs', 'production_settings',
  'security_audit_runs',   // сам отчёт прогона — список дыр
  'manager_schedules', 'wazzup_outgoing_messages', 'manager_coaching',
])

// Таблицы витрины: их публичность — замысел, а не упущение.
const PUBLIC_BY_DESIGN = new Set([
  'shower_models', 'shower_model_images', 'mirror_lighting_tabs', 'partner_types',
])

// Здесь публичное ЧТЕНИЕ разрешено осознанно (контент витрины), но запись —
// нет: правила про запись для этих таблиц продолжают работать. Разделение
// важно: иначе, добавив таблицу в исключения, мы заодно перестали бы замечать
// открытую на ней запись.
const PUBLIC_READ_OK = new Set([
  'site_work_photos',   // фото работ для сайта, отдаются только approved = true
])

const WRITE_PRIVILEGES = new Set(['INSERT', 'UPDATE', 'DELETE'])

const isPublicRole = (roles: string[]) => roles.some(r => r === 'PUBLIC' || r === 'anon')

// Политика, выданная PUBLIC, опасна не сама по себе, а когда её условие не
// требует сессии. Проверено на живой базе: предикаты с auth.uid() / auth.role()
// / is_owner() анонима отсекают (referral_clients отдал ему 0 строк), а
// «(NOT is_partner())» — нет: is_partner() построен на EXISTS, при пустом
// auth.uid() это false, значит NOT false = true. Без этой проверки прогон
// сыпал бы 21 находкой там, где настоящих единицы.
const SESSION_BOUND = /auth\.uid\(\)|auth\.role\(\)|is_owner\(\)|current_org_id\(\)|auth\.jwt\(\)/
export function requiresSession(expr: string | null | undefined): boolean {
  return SESSION_BOUND.test(expr ?? '')
}

// Политика проверяет сессию, если это видно хотя бы в одном из двух условий:
// USING (что видно) или WITH CHECK (что можно записать).
export function policyChecksSession(p: SnapshotPolicy): boolean {
  return requiresSession(p.using) || requiresSession(p.check)
}

// Читает — r и *; пишет — *, w (update), a (insert), d (delete).
const READ_CMDS = new Set(['r', '*'])
const WRITE_CMDS = new Set(['*', 'w', 'a', 'd'])

export function auditAccess(s: AccessSnapshot): Finding[] {
  const out: Finding[] = []

  // 1. Пароли и секреты колонками.
  for (const c of s.suspicious_columns ?? []) {
    out.push({
      severity: 'high', code: 'secret_column', table: c.table,
      title: `Секрет хранится колонкой: ${c.table}.${c.column}`,
      detail: 'Пароли и токены живут в Supabase Auth или в переменных окружения, а не в таблице: колонку читает каждый, кому видна строка.',
    })
  }

  // 2. Политики, выданные PUBLIC/anon, условие которых не требует сессии.
  // Открытость на чтение и на запись считаем ОТДЕЛЬНО: публичная витрина с
  // read-политикой не значит, что в таблицу можно писать (на этом прогон
  // ошибся в первый раз и обвинил site_work_photos и task_queue в записи).
  const openRead = new Set<string>()
  const openWrite = new Set<string>()
  for (const p of s.policies ?? []) {
    if (PUBLIC_BY_DESIGN.has(p.table) || !isPublicRole(p.roles)) continue
    if (policyChecksSession(p)) continue
    if (READ_CMDS.has(p.cmd)) openRead.add(p.table)
    if (WRITE_CMDS.has(p.cmd)) openWrite.add(p.table)
    const writes = p.cmd !== 'r'
    if (!writes && PUBLIC_READ_OK.has(p.table)) continue
    const sensitive = SENSITIVE_TABLES.has(p.table)
    out.push({
      severity: writes || sensitive ? 'high' : 'medium',
      code: writes ? 'public_write_policy' : 'public_read_policy',
      table: p.table,
      title: `${writes ? 'Запись' : 'Чтение'} без входа в систему: ${p.table} · ${p.policy}`,
      detail: `Политика выдана роли PUBLIC (в неё входит anon). Предикат «${p.using ?? '—'}» анонима не отсекает, если построен на is_partner(): EXISTS при пустом auth.uid() даёт false. Нужно TO authenticated.`,
    })
  }

  // 3. Состояние RLS: выключенный RLS — дыра сам по себе.
  const rlsOff = new Set<string>()
  for (const r of s.rls ?? []) {
    if (PUBLIC_BY_DESIGN.has(r.table)) continue
    if (!r.enabled) {
      rlsOff.add(r.table)
      out.push({
        severity: SENSITIVE_TABLES.has(r.table) ? 'high' : 'medium',
        code: 'rls_off', table: r.table,
        title: `RLS выключен: ${r.table}`,
        detail: 'Без RLS таблицу читает любой, у кого есть сессия и публичный ключ.',
      })
    }
  }

  // 4. Гранты анонима опасны там, где ворота и так открыты: политика без
  // проверки сессии или выключенный RLS. Сами по себе гранты — вторая линия:
  // в базе их сотни (дефолт Supabase), и поимённый список превратил бы отчёт
  // в шум. Их считаем одной строкой.
  const writeOpen = (t: string) => openWrite.has(t) || rlsOff.has(t)
  const readOpen  = (t: string) => openRead.has(t) || rlsOff.has(t)
  const anonWrites = (s.grants ?? []).filter(g => g.grantee === 'anon' && WRITE_PRIVILEGES.has(g.privilege) && !PUBLIC_BY_DESIGN.has(g.table))
  // Одна строка на таблицу, а не на каждое право: INSERT/UPDATE/DELETE по одной
  // таблице — это одна и та же дыра, и тремя строками она только топит остальное.
  const byTable = new Map<string, string[]>()
  for (const g of anonWrites) {
    if (!writeOpen(g.table)) continue
    byTable.set(g.table, [...(byTable.get(g.table) ?? []), g.privilege])
  }
  for (const [table, privs] of byTable) {
    out.push({
      severity: 'high', code: 'anon_write_open', table,
      title: `Аноним может писать в ${table}`,
      detail: `Права ${privs.sort().join(', ')} у anon, и ворота открыты (политика без проверки сессии или выключенный RLS). Снять грант и закрыть политику.`,
    })
  }
  const dormant = new Set(anonWrites.filter(g => !writeOpen(g.table)).map(g => g.table))
  if (dormant.size > 0) {
    out.push({
      severity: 'low', code: 'anon_write_grants_dormant', table: '—',
      title: `У анонима остались права записи на ${dormant.size} таблиц`,
      detail: 'Сейчас их держит RLS, но это вторая линия обороны, а не первая: при ослаблении любой политики они сработают. Снимать по мере ревизии: revoke insert, update, delete … from anon.',
    })
  }

  for (const g of s.grants ?? []) {
    if (g.grantee !== 'anon' || g.privilege !== 'SELECT') continue
    if (!SENSITIVE_TABLES.has(g.table) || !readOpen(g.table)) continue
    out.push({
      severity: 'high', code: 'anon_read_sensitive', table: g.table,
      title: `Аноним может читать ${g.table}`,
      detail: 'В этой таблице деньги или персональные данные, и ворота открыты. Публичный ключ лежит в коде страницы, искать его не надо.',
    })
  }

  // 5. RLS включён, а политик нет: чаще всего так и задумано (таблица только
  // для сервисного ключа), но иногда это экран, который молча показывает пусто.
  // Одной строкой, чтобы не топить важное.
  const silent = (s.rls ?? []).filter(r => r.enabled && r.policies === 0 && !PUBLIC_BY_DESIGN.has(r.table))
  if (silent.length > 0) {
    out.push({
      severity: 'low', code: 'rls_no_policies', table: '—',
      title: `RLS включён без политик: ${silent.length} таблиц`,
      detail: `Такая таблица отдаёт 200 и пустой массив — экран выглядит рабочим, просто «данных нет». Если чтение нужно с клиента, политики не хватает: ${silent.slice(0, 6).map(r => r.table).join(', ')}${silent.length > 6 ? '…' : ''}`,
    })
  }

  const rank: Record<Severity, number> = { high: 0, medium: 1, low: 2 }
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || a.table.localeCompare(b.table))
}

// Отчёт уходит в телеграм с parse_mode: HTML: один «<» в имени политики или
// в тексте ошибки — и Bot API отвергает сообщение целиком.
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function countBySeverity(f: Finding[]) {
  return {
    high: f.filter(x => x.severity === 'high').length,
    medium: f.filter(x => x.severity === 'medium').length,
    low: f.filter(x => x.severity === 'low').length,
  }
}

// Короткий отчёт владельцу: сначала сколько, потом что именно — но не всё
// подряд, иначе сообщение не читают. Полный список остаётся в базе.
export function formatReport(f: Finding[], prev?: Finding[] | null): string {
  const c = countBySeverity(f)
  if (f.length === 0) return '🔒 Прогон доступов: чисто. Ни одной находки.'

  const prevCodes = new Set((prev ?? []).map(x => `${x.code}|${x.table}`))
  const fresh = f.filter(x => !prevCodes.has(`${x.code}|${x.table}`))

  const lines = [`🔒 Прогон доступов: ${c.high} важных, ${c.medium} средних, ${c.low} мелких.`]
  if (prev && fresh.length) lines.push(`Новых с прошлого раза: ${fresh.length}.`)
  if (prev && !fresh.length) lines.push('Новых с прошлого раза нет.')
  lines.push('')
  for (const x of f.filter(x => x.severity === 'high').slice(0, 8)) lines.push(`• ${escapeHtml(x.title)}`)
  const restHigh = c.high - Math.min(c.high, 8)
  if (restHigh > 0) lines.push(`…и ещё ${restHigh} важных`)
  lines.push('', 'Полный список — «Безопасность» в админке.')
  return lines.join('\n')
}
