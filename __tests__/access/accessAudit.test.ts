import { describe, it, expect } from 'vitest'
import { auditAccess, countBySeverity, escapeHtml, formatReport, namesWhoWrites, SENSITIVE_TABLES, type AccessSnapshot, type SnapshotPolicy } from '@/lib/security/accessAudit'

const empty: AccessSnapshot = { policies: [], grants: [], rls: [], suspicious_columns: [] }

describe('прогон доступов ловит то, что нашлось руками 22.09', () => {
  it('политика, выданная PUBLIC, — находка (так открылись справочники анониму)', () => {
    const f = auditAccess({
      ...empty,
      policies: [{ table: 'materials', policy: 'anon_read_materials', cmd: 'r', roles: ['PUBLIC'], using: '(NOT is_partner())' }],
    })
    expect(f).toHaveLength(1)
    expect(f[0].severity).toBe('high')          // materials — чувствительная таблица
    expect(f[0].code).toBe('public_read_policy')
    expect(f[0].detail).toContain('TO authenticated')
  })

  it('политика на ЗАПИСЬ для PUBLIC важнее чтения', () => {
    const f = auditAccess({
      ...empty,
      policies: [{ table: 'mirror_frame_rates', policy: 'mfr_update', cmd: 'w', roles: ['PUBLIC'], using: null }],
    })
    expect(f[0].code).toBe('public_write_policy')
    expect(f[0].severity).toBe('high')
  })

  it('политика для authenticated находкой не считается', () => {
    const f = auditAccess({
      ...empty,
      policies: [{ table: 'materials', policy: 'auth_read_materials', cmd: 'r', roles: ['authenticated'], using: '(NOT is_partner())' }],
    })
    expect(f).toEqual([])
  })

  // Гранты сами по себе — вторая линия: в базе их сотни (дефолт Supabase).
  // Опасны там, где ворота и так открыты.
  it('грант анониму опасен, когда политика не требует сессии', () => {
    const f = auditAccess({
      ...empty,
      policies: [{ table: 'materials', policy: 'anon_all_materials', cmd: '*', roles: ['PUBLIC'], using: '(NOT is_partner())' }],
      grants: [
        { table: 'materials', grantee: 'anon', privilege: 'UPDATE' },
        { table: 'materials', grantee: 'anon', privilege: 'SELECT' },
      ],
    })
    expect(f.map(x => x.code)).toContain('anon_write_open')
    expect(f.map(x => x.code)).toContain('anon_read_sensitive')
  })

  it('три права на одну таблицу — одна строка, а не три', () => {
    const f = auditAccess({
      ...empty,
      // политика на ВСЕ действия без проверки сессии — вот это открытая запись
      policies: [{ table: 'materials', policy: 'anon_all', cmd: '*', roles: ['PUBLIC'], using: '(NOT is_partner())' }],
      grants: ['INSERT', 'UPDATE', 'DELETE'].map(privilege => ({ table: 'materials', grantee: 'anon', privilege })),
    })
    const writes = f.filter(x => x.code === 'anon_write_open')
    expect(writes).toHaveLength(1)
    expect(writes[0].detail).toContain('DELETE, INSERT, UPDATE')
  })

  it('грант при закрытой политике — одна строка «спящих», а не сотня находок', () => {
    const f = auditAccess({
      ...empty,
      policies: [{ table: 'deals', policy: 'auth', cmd: '*', roles: ['PUBLIC'], using: '(auth.uid() IS NOT NULL)' }],
      grants: Array.from({ length: 40 }, (_, i) => ({ table: `t${i}`, grantee: 'anon', privilege: 'UPDATE' })),
    })
    const dormant = f.filter(x => x.code === 'anon_write_grants_dormant')
    expect(dormant).toHaveLength(1)
    expect(dormant[0].severity).toBe('low')
    expect(dormant[0].title).toContain('40')
  })

  it('пароль колонкой — всегда высокий риск', () => {
    const f = auditAccess({ ...empty, suspicious_columns: [{ table: 'users', column: 'password_plain' }] })
    expect(f[0].severity).toBe('high')
    expect(f[0].code).toBe('secret_column')
  })

  it('RLS включён без политик — одной строкой, это чаще замысел, чем дыра', () => {
    const f = auditAccess({ ...empty, rls: [
      { table: 'sheet_cuts', enabled: true, policies: 0 },
      { table: 'sheet_remnants', enabled: true, policies: 0 },
    ] })
    expect(f).toHaveLength(1)
    expect(f[0].code).toBe('rls_no_policies')
    expect(f[0].severity).toBe('low')
    expect(f[0].detail).toContain('sheet_cuts')
  })

  it('RLS выключен: на таблице с деньгами — важно, на прочей — среднее', () => {
    const f = auditAccess({
      ...empty,
      rls: [
        { table: 'calculations', enabled: false, policies: 0 },
        { table: 'some_log', enabled: false, policies: 0 },
      ],
    })
    expect(f.find(x => x.table === 'calculations')!.severity).toBe('high')
    expect(f.find(x => x.table === 'some_log')!.severity).toBe('medium')
  })

  it('витрина публична по замыслу — не шумим', () => {
    const f = auditAccess({
      ...empty,
      policies: [{ table: 'shower_models', policy: 'shower_models_read', cmd: 'r', roles: ['PUBLIC'], using: 'true' }],
      rls: [{ table: 'mirror_lighting_tabs', enabled: false, policies: 0 }],
    })
    expect(f).toEqual([])
  })

  it('находки идут по убыванию важности', () => {
    const f = auditAccess({
      ...empty,
      rls: [{ table: 'some_log', enabled: false, policies: 0 }, { table: 'calculations', enabled: false, policies: 0 }],
      suspicious_columns: [{ table: 'users', column: 'password_plain' }],
    })
    expect(f.map(x => x.severity)).toEqual(['high', 'high', 'medium'])
  })

  // Главная калибровка: предикат, который реально отсекает анонима, находкой
  // не считается. Иначе прогон дал бы 21 ложную находку на живой базе.
  it('политика PUBLIC с проверкой сессии — не находка', () => {
    const f = auditAccess({
      ...empty,
      policies: [
        { table: 'b2b_orders', policy: 'auth', cmd: '*', roles: ['PUBLIC'], using: "((auth.role() = 'authenticated') AND (NOT is_partner()))" },
        { table: 'referral_clients', policy: 'auth_read', cmd: 'r', roles: ['PUBLIC'], using: '((auth.uid() IS NOT NULL) AND (NOT is_partner()))' },
        { table: 'user_devices', policy: 'own', cmd: 'r', roles: ['PUBLIC'], using: '(auth.uid() = user_id)' },
      ],
    })
    // анонима отсекает; то, что b2b_orders пишет весь штат, — отдельный вопрос (п. 6)
    expect(f.filter(x => x.code !== 'staff_wide_write')).toEqual([])
    expect(f.map(x => x.table)).toEqual(['b2b_orders'])
  })

  it('а «только не партнёр» анонима не отсекает — находка', () => {
    const f = auditAccess({
      ...empty,
      policies: [{ table: 'task_queue', policy: 'task_queue_read', cmd: 'r', roles: ['PUBLIC'], using: '(NOT is_partner())' }],
    })
    expect(f).toHaveLength(1)
    expect(f[0].code).toBe('public_read_policy')
  })
})

describe('отчёт владельцу', () => {
  const f = auditAccess({ ...empty, suspicious_columns: [{ table: 'users', column: 'password_plain' }] })

  it('чисто — так и говорим', () => {
    expect(formatReport([])).toContain('чисто')
  })

  it('считает по важности и показывает находки', () => {
    expect(countBySeverity(f)).toEqual({ high: 1, medium: 0, low: 0 })
    expect(formatReport(f)).toContain('1 важных')
    expect(formatReport(f)).toContain('users.password_plain')
  })

  it('со вторым прогоном видно, что нового', () => {
    expect(formatReport(f, f)).toContain('Новых с прошлого раза нет')
    expect(formatReport(f, [])).toContain('Новых с прошлого раза: 1')
  })
})

// Ошибки первого живого прогона — теперь тесты.
describe('чего прогон НЕ должен говорить', () => {
  it('публичное чтение не делает таблицу открытой на запись', () => {
    // берём таблицу, для которой публичность НЕ объявлена замыслом
    const f = auditAccess({
      ...empty,
      policies: [{ table: 'some_catalog', policy: 'read', cmd: 'r', roles: ['anon', 'authenticated'], using: '(approved = true)' }],
      grants: ['INSERT', 'UPDATE', 'DELETE'].map(privilege => ({ table: 'some_catalog', grantee: 'anon', privilege })),
    })
    expect(f.filter(x => x.code === 'anon_write_open')).toHaveLength(0)
    expect(f.map(x => x.code)).toContain('public_read_policy')
  })

  it('у политики INSERT условие в check — это проверка сессии', () => {
    const f = auditAccess({
      ...empty,
      policies: [{
        table: 'user_activity_days', policy: 'activity_ins_own', cmd: 'a', roles: ['PUBLIC'],
        using: null, check: '((SELECT auth.uid()) = user_id)',
      }],
      grants: [{ table: 'user_activity_days', grantee: 'anon', privilege: 'INSERT' }],
    })
    expect(f.filter(x => x.severity === 'high')).toHaveLength(0)
  })

  it('владельческая политика на запись не открывает запись анониму', () => {
    const f = auditAccess({
      ...empty,
      policies: [
        { table: 'task_queue', policy: 'owner_write', cmd: '*', roles: ['PUBLIC'], using: 'is_owner()', check: 'is_owner()' },
        { table: 'task_queue', policy: 'read', cmd: 'r', roles: ['PUBLIC'], using: '(NOT is_partner())' },
      ],
      grants: [{ table: 'task_queue', grantee: 'anon', privilege: 'UPDATE' }],
    })
    expect(f.filter(x => x.code === 'anon_write_open')).toHaveLength(0)
    expect(f.filter(x => x.code === 'public_read_policy')).toHaveLength(1)
  })
})

describe('витрина, где чтение публично осознанно', () => {
  it('публичное чтение фото работ не считается находкой', () => {
    const f = auditAccess({
      ...empty,
      policies: [{ table: 'site_work_photos', policy: 'read', cmd: 'r', roles: ['anon'], using: '(approved = true)' }],
    })
    expect(f).toEqual([])
  })

  it('но открытая ЗАПИСЬ на той же таблице — по-прежнему находка', () => {
    const f = auditAccess({
      ...empty,
      policies: [{ table: 'site_work_photos', policy: 'all', cmd: '*', roles: ['anon'], using: 'true' }],
      grants: [{ table: 'site_work_photos', grantee: 'anon', privilege: 'INSERT' }],
    })
    expect(f.map(x => x.code)).toContain('public_write_policy')
    expect(f.map(x => x.code)).toContain('anon_write_open')
  })
})

// 30.09: маржу, налог и закупку мог переписать любой сотрудник (FOR ALL … USING
// (NOT is_partner())), а прогон молчал — спрашивал только про анонима. Условия ниже
// скопированы из живого снимка того дня.
describe('запись в таблицу с деньгами, открытая всему штату', () => {
  const wide = (table: string, using: string, cmd = '*', roles = ['authenticated']): SnapshotPolicy =>
    ({ table, policy: `p_${table}`, cmd, roles, using, check: cmd === 'a' ? using : null })

  it('«не партнёр», «вошёл», «своя организация» — весь штат', () => {
    expect(namesWhoWrites('(NOT is_partner())')).toBe(false)
    expect(namesWhoWrites("((( SELECT auth.role() AS role) = 'authenticated'::text) AND (NOT is_partner()))")).toBe(false)
    expect(namesWhoWrites('((organization_id = current_org_id()) AND (NOT is_partner()))')).toBe(false)
    expect(namesWhoWrites('true')).toBe(false)
    expect(namesWhoWrites(null)).toBe(false)
  })

  it('текущий пользователь или функция-список ролей — узко', () => {
    expect(namesWhoWrites('can_edit_pricing()')).toBe(true)
    expect(namesWhoWrites('(auth.uid() = user_id)')).toBe(true)
    expect(namesWhoWrites('(( SELECT auth.uid() AS uid) = manager_id)')).toBe(true)
    expect(namesWhoWrites('(auth.uid() IS NOT NULL)')).toBe(false)
    expect(namesWhoWrites('((created_by = ( SELECT auth.uid() AS uid)) OR is_admin())')).toBe(true)
    expect(namesWhoWrites("((created_by = auth.uid()) OR (manager_id = auth.uid()) OR (EXISTS ( SELECT 1 FROM users u WHERE ((u.id = auth.uid()) AND (u.role = ANY (ARRAY['admin'::text, 'ceo'::text]))))))")).toBe(true)
  })

  it('ИЛИ с широким условием расширяет узкое до всех', () => {
    expect(namesWhoWrites('((created_by = auth.uid()) OR (NOT is_partner()))')).toBe(false)
  })

  it('одна широкая политика на таблице — одна находка, с именами политик', () => {
    const f = auditAccess({
      ...empty,
      policies: [
        wide('materials', '(NOT is_partner())'),
        { ...wide('materials', '(NOT is_partner())'), policy: 'auth_write_materials' },
        wide('materials', '(NOT is_partner())', 'r'),
        wide('financial_settings', '(NOT is_partner())'),
      ],
    })
    const sw = f.filter(x => x.code === 'staff_wide_write')
    expect(sw.map(x => x.table)).toEqual(['financial_settings', 'materials'])
    expect(sw.every(x => x.severity === 'high')).toBe(true)
    expect(sw[1].detail).toContain('auth_write_materials')
  })

  it('узкие политики, чтение, служебная роль и нечувствительная таблица — не находка', () => {
    const f = auditAccess({
      ...empty,
      policies: [
        wide('calculations', '((created_by = ( SELECT auth.uid() AS uid)) OR is_admin())', 'w'),
        wide('b2b_rates', 'can_edit_pricing()', 'a'),
        wide('b2b_orders', '(NOT is_partner())', 'r'),
        wide('users', 'true', '*', ['service_role']),
        wide('task_queue', '(NOT is_partner())'),
      ],
    })
    expect(f.filter(x => x.code === 'staff_wide_write')).toEqual([])
  })

  it('PUBLIC с проверкой сессии — сюда; без проверки — уже в «записи без входа», не дважды', () => {
    const withSession = auditAccess({ ...empty, policies: [wide('b2b_clients', "((( SELECT auth.role() AS role) = 'authenticated'::text) AND (NOT is_partner()))", '*', ['PUBLIC'])] })
    expect(withSession.map(x => x.code)).toEqual(['staff_wide_write'])
    const anon = auditAccess({ ...empty, policies: [wide('b2b_clients', '(NOT is_partner())', '*', ['PUBLIC'])] })
    expect(anon.map(x => x.code)).toEqual(['public_write_policy'])
  })

  it('для INSERT решает WITH CHECK', () => {
    const f = auditAccess({ ...empty, policies: [{ table: 'deals', policy: 'ins', cmd: 'a', roles: ['authenticated'], using: null, check: '(NOT is_partner())' }] })
    expect(f.map(x => x.code)).toEqual(['staff_wide_write'])
  })
})

describe('отчёт не ломается и не утекает', () => {
  it('«<» в имени политики не рвёт HTML-разметку телеграма', () => {
    const f = auditAccess({
      ...empty,
      policies: [{ table: 'materials', policy: 'read <all>', cmd: 'r', roles: ['PUBLIC'], using: 'true' }],
    })
    const r = formatReport(f)
    expect(r).toContain('read &lt;all&gt;')
    expect(r).not.toContain('<all>')
  })

  it('escapeHtml экранирует & первым, чтобы не задвоить', () => {
    expect(escapeHtml('a < b & c > d')).toBe('a &lt; b &amp; c &gt; d')
  })

  it('сам отчёт прогона — чувствительная таблица', () => {
    expect(SENSITIVE_TABLES.has('security_audit_runs')).toBe(true)
  })
})
