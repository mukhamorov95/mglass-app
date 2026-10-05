import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { bookNames } from '@/lib/sales/bookNames'

// «Аналитика дохода» (manager_stats_daily / _monthly): менеджер читает только свои строки
// (supabase/migrations/20261006_manager_stats_own_rows.sql). Политику мерит настоящий
// Postgres (PGlite): таблицы, crm_caller() и is_partner() берутся из миграций репозитория,
// от Supabase — только роли anon/authenticated, auth.uid() из request.jwt.claims и
// гранты по умолчанию. Имена и суммы вымышленные, кроме имён книги из bookNames.ts.

const MIG = join(process.cwd(), 'supabase/migrations')
const file = (f: string) => readFileSync(join(MIG, f), 'utf8')
const OWN_ROWS = '20261006_manager_stats_own_rows.sql'

function fn(f: string, name: string): string {
  const m = file(f).match(new RegExp(`create or replace function public\\.${name}\\(\\)[\\s\\S]*?\\$\\$;`))
  if (!m) throw new Error(`${name} не найдена в ${f}`)
  return m[0]
}

const U = {
  admin: '00000000-0000-4000-8000-000000000001',
  semen: '00000000-0000-4000-8000-000000000002',
  dmitry: '00000000-0000-4000-8000-000000000003',
  yana: '00000000-0000-4000-8000-000000000004',
  newbie: '00000000-0000-4000-8000-000000000005',
  allDeals: '00000000-0000-4000-8000-000000000006',
  buyer: '00000000-0000-4000-8000-000000000007',
  workshop: '00000000-0000-4000-8000-000000000008',
  namesake: '00000000-0000-4000-8000-000000000009',
  measurer: '00000000-0000-4000-8000-00000000000a',
  partner: '00000000-0000-4000-8000-00000000000b',
  ceo: '00000000-0000-4000-8000-00000000000c',
  commercial: '00000000-0000-4000-8000-00000000000d',
  cfo: '00000000-0000-4000-8000-00000000000e',
}

const USERS: [string, string, string, boolean][] = [
  [U.admin, 'Администратор', 'admin', false],
  [U.semen, 'Семен', 'manager', false],
  [U.dmitry, 'Дмитрий', 'manager', false],
  [U.yana, 'Яна', 'manager', false],
  [U.newbie, 'Новичок', 'manager', false],
  [U.allDeals, 'Старший', 'manager', true],
  [U.buyer, 'Закупщик', 'buyer', true],
  [U.workshop, 'Мастер', 'production', false],
  // Тёзка менеджера в цеху: имя само по себе строк книги не открывает.
  [U.namesake, 'Александра', 'production', false],
  [U.measurer, 'Замерщик', 'measurer', false],
  [U.partner, 'Партнёр', 'partner', false],
  [U.ceo, 'Инвестор', 'ceo', false],
  [U.commercial, 'Коммерческий', 'commercial', false],
  [U.cfo, 'Финансист', 'cfo', false],
]

const BOOK = ['Александра', 'Влад', 'Дима', 'Любовь', 'Семён', 'Яна']
const TABLES = ['manager_stats_daily', 'manager_stats_monthly'] as const

let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select (nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::uuid
    $$;
    grant usage on schema auth to anon, authenticated;
    grant usage on schema public to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;

    create table public.users (
      id uuid primary key, name text, role text not null,
      can_view_all_deals boolean default false
    );
    alter table public.users enable row level security;
    -- Как в проде: грант на запись у authenticated есть, политики на запись нет.
    create policy users_select_own on public.users for select to authenticated using (id = auth.uid());
  `)
  await db.exec(fn('20260805_b2b_partner_isolation_backstop.sql', 'is_partner'))
  await db.exec(fn('20260720_crm_rls_real.sql', 'crm_caller'))
  await db.exec(file('20260917_manager_stats_daily.sql'))
  await db.exec(file('20260918_manager_stats_monthly.sql'))

  for (const [id, name, role, all] of USERS) {
    await db.query('insert into users (id, name, role, can_view_all_deals) values ($1, $2, $3, $4)', [id, name, role, all])
  }
  for (const [i, m] of BOOK.entries()) {
    await db.query(`insert into manager_stats_daily (stat_date, manager, metric, value) values ('2026-09-01', $1, 'payments', $2)`, [m, 1000 * (i + 1)])
    await db.query(`insert into manager_stats_monthly (month, manager, metric, value, kind) values ('2026-09', $1, 'payments', $2, 'match')`, [m, 1000 * (i + 1)])
  }

  await db.exec(file(OWN_ROWS))
}, 60_000)

afterAll(async () => { await db?.close() })

type Seen = { uid: string | null; managers: string[] }

async function seenBy(uid: string | null, table: string, role = 'authenticated'): Promise<Seen> {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`)
    if (uid) await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role })])
    const r = await tx.query<{ uid: string | null; managers: string[] | null }>(
      `select auth.uid()::text as uid, array_agg(distinct manager order by manager) as managers from ${table}`)
    return { uid: r.rows[0].uid, managers: r.rows[0].managers ?? [] }
  })
}

describe('users.book_name', () => {
  it('заполнен у менеджеров и админа по тому же правилу, что bookNames()', async () => {
    const { rows } = await db.query<{ name: string; role: string; book_name: string | null }>(
      'select name, role, book_name from users order by name')
    const filled = rows.filter(r => r.book_name)
    expect(Object.fromEntries(filled.map(r => [r.name, r.book_name]))).toEqual({
      'Администратор': 'Влад', 'Дмитрий': 'Дима', 'Семен': 'Семён',
      'Яна': 'Яна', 'Новичок': 'Новичок', 'Старший': 'Старший',
    })
    for (const r of filled) expect(bookNames(r.name), r.name).toContain(r.book_name)
    expect(rows.filter(r => !['manager', 'admin'].includes(r.role) && r.book_name)).toEqual([])
  })

  it('одна строка книги — один человек', async () => {
    await expect(db.query(`update users set book_name = 'Яна' where id = $1`, [U.semen])).rejects.toThrow(/users_book_name_key/)
  })

  it('сотрудник не может сам вписать себе чужое имя книги', async () => {
    const changed = await db.transaction(async tx => {
      await tx.exec('set local role authenticated')
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: U.newbie })])
      const r = await tx.query(`update users set book_name = 'Александра' where id = $1`, [U.newbie])
      return r.affectedRows
    })
    expect(changed).toBe(0)
    const { rows } = await db.query<{ book_name: string }>('select book_name from users where id = $1', [U.newbie])
    expect(rows[0].book_name).toBe('Новичок')
  })
})

describe.each(TABLES)('%s: кто чьи строки читает', table => {
  it.each([
    ['Семен', U.semen, ['Семён']],
    ['Дмитрий', U.dmitry, ['Дима']],
    ['Яна', U.yana, ['Яна']],
  ])('менеджер %s — только свои', async (_n, uid, own) => {
    expect(await seenBy(uid, table)).toEqual({ uid, managers: own })
  })

  it.each([
    ['менеджер без строк в книге', U.newbie],
    ['цех', U.workshop],
    ['тёзка менеджера в цеху', U.namesake],
    ['замерщик', U.measurer],
    ['партнёр', U.partner],
    ['закупщик с «видеть все сделки»', U.buyer],
  ])('%s — ничего', async (_n, uid) => {
    expect(await seenBy(uid, table)).toEqual({ uid, managers: [] })
  })

  it.each([
    ['admin', U.admin], ['ceo', U.ceo], ['commercial', U.commercial], ['cfo', U.cfo],
    ['менеджер с «видеть все сделки»', U.allDeals],
  ])('%s — все', async (_n, uid) => {
    expect(await seenBy(uid, table)).toEqual({ uid, managers: BOOK })
  })

  it('authenticated без claims — ничего', async () => {
    expect(await seenBy(null, table)).toEqual({ uid: null, managers: [] })
  })

  it('аноним — без доступа', async () => {
    await expect(seenBy(null, table, 'anon')).rejects.toThrow(/permission denied/)
  })

  it('старых политик «весь штат» не осталось', async () => {
    const { rows } = await db.query<{ policyname: string; roles: string }>(
      'select policyname, roles::text from pg_policies where tablename = $1', [table])
    expect(rows).toEqual([{ policyname: `${table}_select`, roles: '{authenticated}' }])
  })
})

describe('база и экран согласны, кому видны все', () => {
  it('роли руководства в политике = роли canAll в /api/manager-stats', () => {
    const route = readFileSync(join(process.cwd(), 'app/api/manager-stats/route.ts'), 'utf8')
    const inRoute = route.match(/const canAll = \[([^\]]*)\]\.includes/)
    expect(inRoute, 'canAll не найден в /api/manager-stats').not.toBeNull()
    const inSql = [...file(OWN_ROWS).matchAll(/c\.u_role in \(([^)]*)\)/g)].map(m => m[1])
    expect(inSql).toHaveLength(2)
    const roles = (s: string) => [...s.matchAll(/'([a-z_]+)'/g)].map(x => x[1]).sort()
    for (const s of inSql) expect(roles(s)).toEqual(roles(inRoute![1]))
  })
})
