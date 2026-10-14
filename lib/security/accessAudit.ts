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
//   • пароль/секрет хранится колонкой;
//   • (01.10) бакет хранилища открыт шире, чем думали, — см. auditStorage.

// У политик INSERT условие живёт в check, а не в using: первый прогон из-за
// этого объявил «запись без входа» там, где проверка была.
export type SnapshotPolicy = { table: string; policy: string; cmd: string; roles: string[]; using: string | null; check?: string | null }
export type SnapshotGrant = { table: string; grantee: string; privilege: string }
export type SnapshotRls = { table: string; enabled: boolean; policies: number }
export type SnapshotColumn = { table: string; column: string }

export type SnapshotBucket = {
  id: string
  public: boolean
  file_size_limit: number | null
  allowed_mime_types: string[] | null
  objects?: number
}
// Политики storage.objects — та же форма, что у таблиц (table = 'objects').
export type StorageSnapshot = { buckets: SnapshotBucket[]; policies: SnapshotPolicy[] }

export type AccessSnapshot = {
  policies: SnapshotPolicy[]
  grants: SnapshotGrant[]
  rls: SnapshotRls[]
  suspicious_columns: SnapshotColumn[]
  // Нет у снимков до 14.10.2026 и у функции, на которую не накатили миграцию
  // 20261014_security_snapshot_storage.sql, — тогда прогон говорит об этом находкой.
  storage?: StorageSnapshot
}

export type Severity = 'high' | 'medium' | 'low'
export type Finding = { severity: Severity; code: string; table: string; title: string; detail: string }

// Где лежат деньги и люди. Для них правила строже: тут и «RLS выключен» — высокий
// риск, а не замечание. Список ведём руками: он короткий и должен быть осознанным.
export const SENSITIVE_TABLES = new Set([
  'users', 'b2b_clients', 'b2b_client_legal_entities', 'b2b_orders', 'b2b_materials', 'b2b_inquiries',
  'materials', 'hardware_items', 'services', 'b2b_services', 'financial_settings',
  'supplier_price_rows', 'glass_price_matrix', 'purchase_orders', 'calculations',
  'commercial_proposals', 'deals', 'deal_payments', 'payments', 'manager_stats_daily',
  'manager_stats_monthly', 'manager_day_stats', 'manager_month_plans', 'margin_edits', 'coefficients', 'process_cost_inputs', 'production_settings',
  'security_audit_runs',   // сам отчёт прогона — список дыр
  'upd_registry',          // реестр выданных УПД: номера, даты, покупатели, суммы
  'upd_series',            // первый номер серии УПД на год — задаёт бухгалтер
  'manager_schedules', 'wazzup_outgoing_messages', 'manager_coaching',
  'b2b_rates',        // закалка, кромка, мин. цены — себестоимость B2B
  'coaching_effect',  // результат человека по дням
  'montage_media',    // подписи бригадиров: адрес, квартира, телефон клиента
  'review_requests',  // клиенты с телефонами для просьбы об отзыве
  'b2b_inquiry_notify', // кому уходят уведомления о заявках с телефонами клиентов
  'user_page_days',   // кто какие экраны открывает — поведение людей
  'lead_distribution', // кому отдали заявку и почему: загрузка людей, телефоны клиентов
  'measure_requests', // адреса и телефоны клиентов, гонорар замерщика и отметка о выплате
  'measurer_schedules', // рабочее время людей
  'measurer_days_off',  // отпуска и выходные людей с причиной
  'b2b_partner_settings', // наценка точки партнёра — его коммерческая тайна
  'activity_log',     // кто менял права, пароли, реквизиты покупателя — и кому это видно
  'cfo_settings',     // постоянные расходы и ставки фондов заказа (сдельная, % продаж)
  'margin_book_rows', // расходы и маржа каждого объекта из книги «Маржа»
  'cron_runs',        // тексты ошибок кронов: внутренние адреса, имена таблиц, куски ответов
  'shop_board_cards', 'shop_board_events', // поручения цеха: кто взял, кто сорвал срок, переписка
  'pbx_calls',        // все звонки АТС: телефоны клиентов, кто и сколько говорил
  'inbound_events',   // сырые вебхуки Wazzup/АТС: тексты клиентов, телефоны, имена
  'client_advances',  // авансы клиентов: суммы, кто и когда заплатил вперёд
])

// Новые таблицы без денег и людей — перечислены явно, с причиной. Тест
// __tests__/access/newTablesClassified.test.ts требует, чтобы каждая таблица из
// миграций с 23.09 стояла в одном из списков: «решили, что не чувствительная»
// отличается от «забыли» только записью здесь.
export const NOT_SENSITIVE_TABLES = new Set<string>([])

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

export function isClassifiedTable(table: string): boolean {
  return SENSITIVE_TABLES.has(table) || NOT_SENSITIVE_TABLES.has(table)
    || PUBLIC_BY_DESIGN.has(table) || PUBLIC_READ_OK.has(table)
}

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

// Условие записи называет, кого пускает: текущего пользователя (created_by =
// auth.uid()) или функцию-список ролей (is_owner(), can_edit_pricing()). «Не
// партнёр», «вошёл», «своя организация» — это весь штат: 30.09 так маржу, налог и
// закупку месяцами мог переписать любой сотрудник, а прогон молчал — он спрашивал
// только про анонима. ИЛИ с таким условием расширяет узкое до всех.
const CALLER_BOUND = /=\s*\(?\s*(select\s+)?auth\.uid\(\)|auth\.uid\(\)\s*(as\s+uid\s*\)\s*)?=|\b(is_owner|is_admin|can_edit_[a-z_]+)\(\)/i
const STAFF_WIDE = /not\s+is_partner\(\)|auth\.role\(\)|current_org_id\(\)|auth\.uid\(\)\s*(as\s+uid\s*\)\s*)?is\s+not\s+null/i
export function namesWhoWrites(expr: string | null | undefined): boolean {
  const e = expr ?? ''
  if (!CALLER_BOUND.test(e)) return false
  return !(/\bor\b/i.test(e) && STAFF_WIDE.test(e))
}

// Для INSERT решает WITH CHECK, для остальных — USING (без него Postgres берёт
// USING и как проверку новой строки).
const writeCondition = (p: SnapshotPolicy) => (p.cmd === 'a' ? p.check : p.using ?? p.check) ?? null

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

  // 6. Запись в таблицу с деньгами или людьми, открытая всему штату. Политики
  // складываются через ИЛИ, поэтому хватает одной широкой — строка на таблицу.
  // Выданное анониму уже в п. 2, здесь — вошедшие.
  const staffWide = new Map<string, SnapshotPolicy[]>()
  for (const p of s.policies ?? []) {
    if (!SENSITIVE_TABLES.has(p.table) || !WRITE_CMDS.has(p.cmd)) continue
    if (!p.roles.some(r => r === 'authenticated' || r === 'PUBLIC')) continue
    if (isPublicRole(p.roles) && !policyChecksSession(p)) continue
    if (namesWhoWrites(writeCondition(p))) continue
    staffWide.set(p.table, [...(staffWide.get(p.table) ?? []), p])
  }
  for (const [table, ps] of staffWide) {
    out.push({
      severity: 'high', code: 'staff_wide_write', table,
      title: `Запись открыта всему штату: ${table}`,
      detail: `Политики ${ps.map(p => `«${p.policy}»`).join(', ')} пускают на запись любого вошедшего сотрудника (условие «${writeCondition(ps[0]) ?? 'нет'}»). Назвать, кого пускать: функция-список ролей (can_edit_pricing(), is_owner()) или текущий пользователь (… = auth.uid()).`,
    })
  }

  out.push(...auditStorage(s.storage))

  const rank: Record<Severity, number> = { high: 0, medium: 1, low: 2 }
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || a.table.localeCompare(b.table))
}

// ── Хранилище ────────────────────────────────────────────────────────────────
// Две дыры 01.10.2026 жили в бакетах, а не в таблицах: b2b-attachments отдавал
// любому вошедшему (и партнёру) чертежи всех заказчиков, в furniture-shower
// загружать и удалять мог аноним. Прогон таблиц их не видел — бакеты он не читал.
// Публичный бакет отдаёт файл по прямой ссылке без входа и мимо всех политик,
// поэтому каждый такой бакет — решение, записанное здесь с причиной.
export const PUBLIC_BUCKETS_OK = new Set([
  'furniture-shower', // фото фурнитуры для 3D-конфигуратора на сайте; грузят только сотрудники (01.10)
  'shower-models',    // картинки моделей душевых М1…М12 для витрины и конфигуратора
  // kp-photos сюда не внесён: кроме фото для КП в него пишет /api/deals/[id]/files —
  // чертежи сделок. work-photos — пустой, код его не знает. Решает владелец.
])

// Какие бакеты называет условие политики. pg_get_expr печатает
// «bucket_id = 'x'::text» и «bucket_id = ANY (ARRAY['a'::text, 'b'::text])».
// null — бакет не назван, и правило действует на все бакеты, включая будущие.
export function bucketsInPolicy(p: SnapshotPolicy): string[] | null {
  const text = `${p.using ?? ''} ${p.check ?? ''}`
  const found = new Set<string>()
  for (const m of text.matchAll(/bucket_id\s*=\s*'([^']+)'/g)) found.add(m[1])
  for (const m of text.matchAll(/bucket_id\s*=\s*any\s*\(\s*array\s*\[([^\]]*)\]/gi)) {
    for (const q of m[1].matchAll(/'([^']+)'/g)) found.add(q[1])
  }
  return found.size ? [...found].sort() : null
}

// В каталоге политика без TO и политика TO public неотличимы — обе выданы PUBLIC.
const roleWord = (roles: string[]) => roles.includes('anon') && !roles.includes('PUBLIC')
  ? 'роли anon'
  : 'роли PUBLIC (так выглядит create policy без TO; в неё входит anon)'

export function auditStorage(st: StorageSnapshot | undefined): Finding[] {
  // Пустота — утверждение о приборе, пока не доказано обратное: молчание тут
  // выглядело бы как «в хранилище чисто».
  if (!st) return [{
    severity: 'medium', code: 'storage_not_scanned', table: 'storage',
    title: 'Хранилище не проверено: в снимке нет бакетов',
    detail: 'Функция security_access_snapshot не отдала раздел storage — на базу не накатили миграцию 20261014_security_snapshot_storage.sql. Пока её нет, прогон бакетов не видит, а дыры 01.10 были именно там.',
  }]
  if ((st.buckets ?? []).length === 0) return [{
    severity: 'medium', code: 'storage_empty_snapshot', table: 'storage',
    title: 'Снимок хранилища пуст: 0 бакетов',
    detail: 'Бакеты в проекте есть (14.10 — восемь). Пустой список значит сломанный снимок, а не чистое хранилище: проверить функцию security_access_snapshot.',
  }]

  const out: Finding[] = []
  const byId = new Map(st.buckets.map(b => [b.id, b]))
  const listedInPublic = new Map<string, string[]>()

  for (const p of st.policies ?? []) {
    const buckets = bucketsInPolicy(p)
    const label = buckets ? buckets.join(', ') : 'все бакеты'
    const key = `storage:${buckets ? buckets.join(',') : '*'}`

    if (isPublicRole(p.roles) && !policyChecksSession(p)) {
      if (WRITE_CMDS.has(p.cmd)) {
        out.push({
          severity: 'high', code: 'storage_public_write', table: key,
          title: `Запись в хранилище без входа: ${label} · ${p.policy}`,
          detail: `Политика выдана ${roleWord(p.roles)} и сессии не требует: загрузить, заменить или удалить файл может любой с публичным ключом со страницы сайта. Нужно TO authenticated и условие на роль.`,
        })
        continue
      }
      for (const b of buckets ?? ['*']) {
        const bucket = byId.get(b)
        if (bucket?.public && PUBLIC_BUCKETS_OK.has(b)) {
          out.push({
            severity: 'low', code: 'storage_anon_list', table: `storage:${b}`,
            title: `Аноним видит список файлов: ${b} · ${p.policy}`,
            detail: 'Файлы бакета открыты по ссылке осознанно (PUBLIC_BUCKETS_OK), но политика чтения отдаёт ещё и список всех имён — по нему находят то, на что ссылок не давали. Если сайт сам файлы не перечисляет, политику можно снять.',
          })
        } else if (bucket?.public) {
          listedInPublic.set(b, [...(listedInPublic.get(b) ?? []), p.policy])
        } else {
          const why = bucket ? 'Бакет закрыт, но политика'
            : b === '*' ? 'Условие не называет бакет, и политика'
            : 'Бакета с таким именем сейчас нет — откроется, как только его создадут: политика'
          out.push({
            severity: 'high', code: 'storage_public_read', table: `storage:${b}`,
            title: `Чтение хранилища без входа: ${b === '*' ? 'все бакеты' : b} · ${p.policy}`,
            detail: `${why} выдана ${roleWord(p.roles)} и сессии не требует — аноним видит и скачивает файлы. Нужно TO authenticated и условие на роль.`,
          })
        }
      }
      continue
    }

    if (p.roles.includes('PUBLIC')) {
      out.push({
        severity: 'medium', code: 'storage_policy_no_to', table: key,
        title: `Политика хранилища без TO: ${label} · ${p.policy}`,
        detail: `Выдана PUBLIC. Сегодня анонима отсекает условие «${p.using ?? p.check ?? '—'}», но одна правка условия откроет бакет без входа. Нужно явное TO authenticated.`,
      })
    }
    if (!buckets) {
      out.push({
        severity: 'medium', code: 'storage_policy_all_buckets', table: key,
        title: `Политика хранилища не называет бакет: ${p.policy}`,
        detail: 'В условии нет bucket_id = …, значит правило действует на все бакеты, включая будущие: новый бакет с чертежами откроется тем же, кому открыты фото витрины.',
      })
    }
  }

  for (const b of st.buckets) {
    if (!b.public || PUBLIC_BUCKETS_OK.has(b.id)) continue
    const listed = listedInPublic.get(b.id)
    out.push({
      severity: 'high', code: 'storage_public_bucket', table: `storage:${b.id}`,
      title: `Бакет открыт по ссылке без входа: ${b.id}`,
      detail: `Публичный бакет отдаёт любой файл по прямой ссылке без входа и мимо политик${b.objects != null ? ` (файлов: ${b.objects})` : ''}${listed ? `; политика ${listed.map(n => `«${n}»`).join(', ')} вдобавок отдаёт анониму список всех файлов` : ''}. Если так задумано — внести в PUBLIC_BUCKETS_OK с причиной; если нет — сделать бакет приватным и отдавать файлы подписанной ссылкой (createSignedUrl).`,
    })
  }
  return out
}

// Сводка по бакетам для /admin/security: кто что может, без выводов.
export type BucketSummary = SnapshotBucket & {
  allowListed: boolean
  policies: { policy: string; cmd: string; roles: string[] }[]
}
export function summarizeStorage(st: StorageSnapshot | undefined): BucketSummary[] | null {
  if (!st) return null
  return st.buckets.map(b => ({
    ...b,
    allowListed: PUBLIC_BUCKETS_OK.has(b.id),
    policies: (st.policies ?? [])
      .filter(p => { const bs = bucketsInPolicy(p); return !bs || bs.includes(b.id) })
      .map(p => ({ policy: p.policy, cmd: p.cmd, roles: p.roles })),
  }))
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
