import { describe, it, expect } from 'vitest'
import {
  auditAccess, auditStorage, bucketsInPolicy, summarizeStorage, formatReport, PUBLIC_BUCKETS_OK,
  type AccessSnapshot, type SnapshotBucket, type SnapshotPolicy, type StorageSnapshot,
} from '@/lib/security/accessAudit'

const bucket = (id: string, pub: boolean, extra: Partial<SnapshotBucket> = {}): SnapshotBucket =>
  ({ id, public: pub, file_size_limit: null, allowed_mime_types: null, objects: 0, ...extra })
const pol = (policy: string, cmd: string, roles: string[], using: string | null, check: string | null = null): SnapshotPolicy =>
  ({ table: 'objects', policy, cmd, roles, using, check })

// Снимок хранилища с прода 14.10.2026 (имена бакетов и политик, без файлов).
const PROD_1410: StorageSnapshot = {
  buckets: [
    bucket('b2b-attachments', false, { objects: 124, file_size_limit: 26214400, allowed_mime_types: ['application/pdf'] }),
    bucket('backups', false, { objects: 833 }),
    bucket('furniture-shower', true, { objects: 2, file_size_limit: 5242880, allowed_mime_types: ['image/png'] }),
    bucket('kp-photos', true, { objects: 15 }),
    bucket('kp-sources', false, { objects: 1 }),
    bucket('montage-media', false, { objects: 49 }),
    bucket('shower-models', true, { objects: 15, file_size_limit: 10000000 }),
    bucket('work-photos', true, { objects: 0 }),
  ],
  policies: [
    pol('Staff delete b2b attachments', 'd', ['authenticated'], "((bucket_id = 'b2b-attachments'::text) AND (NOT is_partner()))"),
    pol('Staff read b2b attachments', 'r', ['authenticated'], "((bucket_id = 'b2b-attachments'::text) AND (NOT is_partner()))"),
    pol('Staff upload b2b attachments', 'a', ['authenticated'], null, "((bucket_id = 'b2b-attachments'::text) AND (NOT is_partner()))"),
    pol('furniture-shower public read', 'r', ['PUBLIC'], "(bucket_id = 'furniture-shower'::text)"),
    pol('furniture-shower staff delete', 'd', ['authenticated'], "((bucket_id = 'furniture-shower'::text) AND (NOT is_partner()))"),
    pol('furniture-shower staff upload', 'a', ['authenticated'], null, "((bucket_id = 'furniture-shower'::text) AND (NOT is_partner()))"),
    pol('work_photos_public_read', 'r', ['PUBLIC'], "(bucket_id = 'work-photos'::text)"),
  ],
}

const codes = (f: { code: string; table: string }[]) => f.map(x => `${x.code}|${x.table}`).sort()

describe('публичный бакет вне списка разрешённых', () => {
  // Фикстура, которая обязана падать: если правило перестанет её ловить, тест красный.
  it('находка «важно», с числом файлов и подсказкой, как закрыть', () => {
    const f = auditStorage({ buckets: [bucket('deal-drawings', true, { objects: 7 })], policies: [] })
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ severity: 'high', code: 'storage_public_bucket', table: 'storage:deal-drawings' })
    expect(f[0].detail).toContain('файлов: 7')
    expect(f[0].detail).toContain('PUBLIC_BUCKETS_OK')
    expect(f[0].detail).toContain('createSignedUrl')
  })

  it('тот же бакет в списке разрешённых — не находка', () => {
    const [ok] = [...PUBLIC_BUCKETS_OK]
    expect(auditStorage({ buckets: [bucket(ok, true)], policies: [] })).toEqual([])
  })

  it('закрытый бакет без политик — не находка (работает только сервер)', () => {
    expect(auditStorage({ buckets: [bucket('backups', false, { objects: 833 })], policies: [] })).toEqual([])
  })

  it('доходит до общего прогона, отчёта в телеграм и не тонет среди «мелких»', () => {
    const s: AccessSnapshot = {
      policies: [], grants: [], rls: [], suspicious_columns: [],
      storage: { buckets: [bucket('deal-drawings', true)], policies: [] },
    }
    const f = auditAccess(s)
    expect(f[0].code).toBe('storage_public_bucket')
    expect(formatReport(f)).toContain('Бакет открыт по ссылке без входа: deal-drawings')
  })
})

describe('политики storage.objects, выданные anon/PUBLIC', () => {
  it('запись без входа — «важно» (так было в furniture-shower до 01.10)', () => {
    const f = auditStorage({
      buckets: [bucket('furniture-shower', true)],
      policies: [pol('furniture-shower upload', 'a', ['PUBLIC'], null, "(bucket_id = 'furniture-shower'::text)")],
    })
    expect(codes(f)).toEqual(['storage_public_write|storage:furniture-shower'])
    expect(f[0].severity).toBe('high')
    expect(f[0].detail).toContain('без TO')
  })

  it('«не партнёр» анонима не отсекает — запись всё равно без входа', () => {
    const f = auditStorage({
      buckets: [bucket('b2b-attachments', false)],
      policies: [pol('x', 'd', ['PUBLIC'], "((bucket_id = 'b2b-attachments'::text) AND (NOT is_partner()))")],
    })
    expect(f[0].code).toBe('storage_public_write')
  })

  it('явное TO anon называется ролью anon, а не «без TO»', () => {
    const f = auditStorage({
      buckets: [bucket('b2b-attachments', false)],
      policies: [pol('x', 'r', ['anon'], "(bucket_id = 'b2b-attachments'::text)")],
    })
    expect(f[0].code).toBe('storage_public_read')
    expect(f[0].detail).toContain('роли anon')
    expect(f[0].detail).not.toContain('без TO')
  })

  it('чтение закрытого бакета анонимом — «важно»', () => {
    const f = auditStorage({
      buckets: [bucket('montage-media', false)],
      policies: [pol('montage read', 'r', ['PUBLIC'], "(bucket_id = 'montage-media'::text)")],
    })
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ severity: 'high', code: 'storage_public_read', table: 'storage:montage-media' })
  })

  it('список файлов разрешённого публичного бакета — «мелочь»', () => {
    const f = auditStorage({
      buckets: [bucket('furniture-shower', true)],
      policies: [pol('furniture-shower public read', 'r', ['PUBLIC'], "(bucket_id = 'furniture-shower'::text)")],
    })
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ severity: 'low', code: 'storage_anon_list' })
  })

  it('список файлов НЕразрешённого публичного бакета — в той же находке, не второй строкой', () => {
    const f = auditStorage({
      buckets: [bucket('work-photos', true)],
      policies: [pol('work_photos_public_read', 'r', ['PUBLIC'], "(bucket_id = 'work-photos'::text)")],
    })
    expect(codes(f)).toEqual(['storage_public_bucket|storage:work-photos'])
    expect(f[0].detail).toContain('«work_photos_public_read»')
  })

  it('политика PUBLIC с проверкой сессии — «среднее»: анонима отсекает условие, но TO нет', () => {
    const f = auditStorage({
      buckets: [bucket('kp-sources', false)],
      policies: [pol('own files', 'r', ['PUBLIC'], "((bucket_id = 'kp-sources'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text))")],
    })
    expect(codes(f)).toEqual(['storage_policy_no_to|storage:kp-sources'])
    expect(f[0].severity).toBe('medium')
  })

  it('политика для authenticated с названным бакетом — не находка', () => {
    const f = auditStorage({
      buckets: [bucket('b2b-attachments', false)],
      policies: [pol('Staff read', 'r', ['authenticated'], "((bucket_id = 'b2b-attachments'::text) AND (NOT is_partner()))")],
    })
    expect(f).toEqual([])
  })
})

describe('политика, не называющая бакет', () => {
  it('для authenticated — «среднее»: действует на все бакеты, включая будущие', () => {
    const f = auditStorage({
      buckets: [bucket('a', false)],
      policies: [pol('any file', 'r', ['authenticated'], '(auth.uid() IS NOT NULL)')],
    })
    expect(codes(f)).toEqual(['storage_policy_all_buckets|storage:*'])
  })

  it('для PUBLIC без проверки сессии — чтение всех бакетов без входа, «важно»', () => {
    const f = auditStorage({ buckets: [bucket('a', false)], policies: [pol('all', 'r', ['PUBLIC'], 'true')] })
    expect(f[0]).toMatchObject({ severity: 'high', code: 'storage_public_read', table: 'storage:*' })
  })
})

describe('какие бакеты называет условие', () => {
  it('= и = ANY (ARRAY[…]) — как печатает pg_get_expr', () => {
    expect(bucketsInPolicy(pol('p', 'r', ['authenticated'], "(bucket_id = 'x'::text)"))).toEqual(['x'])
    expect(bucketsInPolicy(pol('p', 'r', ['authenticated'],
      "(bucket_id = ANY (ARRAY['b'::text, 'a'::text]))"))).toEqual(['a', 'b'])
    expect(bucketsInPolicy(pol('p', 'a', ['authenticated'], null, "(bucket_id = 'y'::text)"))).toEqual(['y'])
  })
  it('<> — не название бакета', () => {
    expect(bucketsInPolicy(pol('p', 'r', ['authenticated'], "(bucket_id <> 'x'::text)"))).toBeNull()
  })
})

describe('пустота — это сломанный прибор, а не чистое хранилище', () => {
  it('нет раздела storage (миграция не накачена) — находка', () => {
    expect(codes(auditStorage(undefined))).toEqual(['storage_not_scanned|storage'])
  })
  it('ноль бакетов — находка', () => {
    expect(codes(auditStorage({ buckets: [], policies: [] }))).toEqual(['storage_empty_snapshot|storage'])
  })
  it('старый снимок без storage в общем прогоне не молчит', () => {
    const f = auditAccess({ policies: [], grants: [], rls: [], suspicious_columns: [] })
    expect(codes(f)).toEqual(['storage_not_scanned|storage'])
  })
})

describe('живой снимок 14.10.2026', () => {
  it('kp-photos и work-photos — важно; список furniture-shower — мелочь; остальное чисто', () => {
    const f = auditStorage(PROD_1410)
    expect(codes(f)).toEqual([
      'storage_anon_list|storage:furniture-shower',
      'storage_public_bucket|storage:kp-photos',
      'storage_public_bucket|storage:work-photos',
    ])
  })

  it('сводка: у каждого бакета свои политики, разрешённость и лимиты', () => {
    const s = summarizeStorage(PROD_1410)!
    expect(s).toHaveLength(8)
    const fs = s.find(b => b.id === 'furniture-shower')!
    expect(fs.allowListed).toBe(true)
    expect(fs.policies.map(p => p.cmd).sort()).toEqual(['a', 'd', 'r'])
    expect(s.find(b => b.id === 'kp-photos')).toMatchObject({ allowListed: false, policies: [] })
    expect(summarizeStorage(undefined)).toBeNull()
  })
})
