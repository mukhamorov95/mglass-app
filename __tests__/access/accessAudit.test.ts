import { describe, it, expect } from 'vitest'
import { auditAccess, countBySeverity, formatReport, type AccessSnapshot } from '@/lib/security/accessAudit'

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
    expect(f).toEqual([])
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
