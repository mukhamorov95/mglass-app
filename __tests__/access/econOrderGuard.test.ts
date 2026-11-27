import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

// А0.1: матрица «роль × действие» на настоящем Postgres (PGlite) поверх действующего состояния
// гарда: функции берутся из миграций репозитория. patch_order_notes_shallow, _assert_shop_caller,
// mark_order_stages и is_owner — копии определений прода на 26.11.2026 (в миграциях они
// разложены по нескольким файлам). Люди и суммы вымышленные.

const MIG = join(process.cwd(), 'supabase/migrations')
const file = (f: string) => readFileSync(join(MIG, f), 'utf8')
const NEW = '20261126_econ_a0_1_guard_audit.sql'
const DOWN = readFileSync(join(process.cwd(), 'supabase/rollbacks/20261126_econ_a0_1_guard_audit.down.sql'), 'utf8')

function fn(f: string, name: string): string {
  const m = file(f).match(new RegExp(`create or replace function public\\.${name}\\([^)]*\\)[\\s\\S]*?(?:end \\$\\$;|\\n\\$\\$;|\\$function\\$;)`, 'i'))
  if (!m) throw new Error(`${name} не найдена в ${f}`)
  return m[0]
}

const ROLES = ['admin', 'ceo', 'manager', 'buyer', 'production', 'accountant', 'measurer', 'partner'] as const
type Who = (typeof ROLES)[number] | 'service' | 'anon'
const uid = (role: string) => `00000000-0000-4000-8000-0000000000${String(ROLES.indexOf(role as never) + 10)}`
const NOTES = JSON.stringify({ status: 'sent', stages: {}, urgent: false })

let db: PGlite

async function as<T>(who: Who, run: (q: (sql: string, p?: unknown[]) => Promise<{ rows: T[]; affectedRows?: number }>) => Promise<unknown>) {
  const role = who === 'service' ? 'service_role' : who === 'anon' ? 'anon' : 'authenticated'
  const claims = { role, ...(who === 'service' || who === 'anon' ? {} : { sub: uid(who) }) }
  return db.transaction(async tx => {
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)])
    await tx.exec(`set local role ${role}`)
    return run((sql, p) => tx.query<T>(sql, p))
  })
}

const rpc = (who: Who, patch: object) => as(who, q => q('select patch_order_notes_shallow(1, $1::jsonb)', [JSON.stringify(patch)]))
const update = (who: Who, set: string, p: unknown[] = []) => as(who, q => q(`update b2b_orders set ${set} where id = 1`, p))
const notesNow = async () => JSON.parse((await db.query<{ notes: string }>('select notes from b2b_orders where id = 1')).rows[0].notes)
const log = async () => (await db.query<{ user_name: string; details: { changes: Record<string, unknown> } }>(
  `select user_name, details from activity_log where entity_type = 'b2b_orders' order by id`)).rows

async function reset() {
  await db.exec('reset role')
  await db.query(`select set_config('request.jwt.claims', '', false)`)
  await db.query(`update b2b_orders set notes = $1, launched_at = null, total_after_discount = 1000 where id = 1`, [NOTES])
  await db.exec('delete from activity_log')
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select (nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::uuid $$;
    create function auth.role() returns text language sql stable as $$
      select nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role' $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;

    create table public.users (id uuid primary key, name text, email text, role text not null, max_discount_percent numeric default 0);
    create table public.b2b_orders (
      id int primary key, client_id int, client_name text, discount_percent numeric default 0, items jsonb default '[]',
      total_area numeric, total_weight numeric, total_cost_net numeric, total_cost_vat numeric, total_sale_inc_vat numeric,
      total_after_discount numeric, notes text, created_by text, margin_percent numeric, organization_id bigint,
      payer_client_id bigint, archived_at timestamptz, updated_by_user_id uuid, updated_by_name text, updated_at timestamptz,
      launched_at date);
    create table public.activity_log (id bigserial primary key, user_id uuid, user_name text, action text not null,
      entity_type text, entity_id text, details jsonb, created_at timestamptz not null default now());
    create table public.b2b_hole_prices (id int primary key, d_max int, t_max int, sale numeric, cost numeric);
    alter table public.b2b_hole_prices enable row level security;
    create policy b2b_hole_prices_read on public.b2b_hole_prices for select to authenticated using (true);
    insert into b2b_hole_prices values (1, 20, 10, 100, 40);

    create function public.is_owner() returns boolean language sql stable security definer set search_path = public as $$
      select exists (select 1 from public.users where id = auth.uid() and role in ('admin', 'ceo')) $$;
    create function public.is_partner() returns boolean language sql stable security definer set search_path = public as $$
      select exists (select 1 from public.users where id = auth.uid() and role = 'partner') $$;
    create function public._assert_shop_caller() returns void language plpgsql security definer set search_path = public as $$
    declare r text; begin
      if auth.uid() is null then return; end if;
      select role into r from users where id = auth.uid();
      if r is null or r not in ('production','admin','ceo','buyer') then
        raise exception 'forbidden: shop action requires production role' using errcode = '42501';
      end if;
    end $$;
    create function public.patch_order_notes_shallow(p_order_id bigint, p_patch jsonb) returns void
    language plpgsql security definer set search_path = public as $$
    declare n jsonb; begin
      perform _assert_shop_caller();
      select coalesce(nullif(notes, '')::jsonb, '{}'::jsonb) into n from b2b_orders where id = p_order_id for update;
      update b2b_orders set notes = (coalesce(n, '{}') || p_patch)::text where id = p_order_id;
    end $$;
    create function public.mark_detail_stages(p_order_id bigint, p_stages jsonb) returns void
    language plpgsql security definer set search_path = public as $$
    begin update b2b_orders set notes = (notes::jsonb || jsonb_build_object('detail_stages', p_stages))::text where id = p_order_id; end $$;
  `)
  const GUARD = '20261002_b2b_money_columns_guard.sql'
  for (const name of ['_is_browser_write', 'b2b_money_editor_roles', '_b2b_caller', 'guard_b2b_order_money']) await db.exec(fn(GUARD, name))
  await db.exec(fn('20261014_paid_stage_source_guard.sql', '_b2b_order_money_keys'))
  await db.exec(file(GUARD).match(/create trigger trg_guard_b2b_order_money[\s\S]*?guard_b2b_order_money\(\);/)![0])
  await db.exec(fn('20261006_margin_edits_audit.sql', 'audit_change'))
  for (const r of ROLES) await db.query('insert into users (id, name, role) values ($1, $2, $3)', [uid(r), `Тест ${r}`, r])
  await db.query(`insert into b2b_orders (id, client_name, notes, total_after_discount) values (1, 'ООО Пример', $1, 1000)`, [NOTES])
}, 60_000)

afterAll(async () => { await db?.close() })

describe('до миграции дыры есть (иначе тесты ниже ничего не доказывают)', () => {
  it('цех ставит «за счёт M GLASS» и дату запуска прямой записью, функция берёт любой ключ', async () => {
    await reset()
    await update('production', 'notes = $1', [JSON.stringify({ own_cost_remake: { of: '00001' } })])
    expect((await notesNow()).own_cost_remake).toBeTruthy()
    await update('production', `launched_at = '2026-11-01'`)
    await rpc('production', { manager_name: 'кто угодно' })
    expect((await notesNow()).manager_name).toBe('кто угодно')
  })
})

describe('после миграции', () => {
  beforeAll(async () => { await db.exec('reset role'); await db.exec(file(NEW)) })

  it('миграция повторяется без ошибки', async () => {
    await db.exec(file(NEW))
  })

  it.each(['admin', 'ceo', 'manager', 'buyer', 'production', 'accountant', 'measurer'] as const)(
    '%s не ставит «за счёт M GLASS» из браузера', async who => {
      await reset()
      await expect(update(who, 'notes = $1', [JSON.stringify({ ...JSON.parse(NOTES), own_cost_remake: { of: '1' } })]))
        .rejects.toThrow(/закрыта/)
      expect((await notesNow()).own_cost_remake).toBeUndefined()
    })

  it('сервер ставит отметку, и она попадает в журнал', async () => {
    await reset()
    await rpc('service', { own_cost_remake: { of: '00001' } })
    expect((await notesNow()).own_cost_remake).toEqual({ of: '00001' })
    const rows = await log()
    expect(rows).toHaveLength(1)
    expect(Object.keys(rows[0].details.changes)).toEqual(['own_cost_remake'])
    expect(rows[0].user_name).toBe('система')
  })

  it.each([
    ['urgent', { urgent: true }],
    ['drawing_url', { drawing_url: 'x.pdf' }],
    ['отмена этапа', { detail_stages: {}, detail_stage_audit: [] }],
    ['материал', { material_status: 'needed', material_checked_at: 'x', material_checked_by: 'y', material_needed_items: [0] }],
  ])('цех по-прежнему пишет: %s — и в журнал это не идёт', async (_n, patch) => {
    await reset()
    await rpc('production', patch)
    expect(await notesNow()).toMatchObject(patch)
    expect(await log()).toEqual([])
  })

  it.each(['production', 'buyer', 'admin'] as const)('%s: чужой ключ через функцию — отказ и ничего не записано', async who => {
    await reset()
    await expect(rpc(who, { urgent: true, manager_name: 'x' })).rejects.toThrow(/из браузера не пишутся: manager_name/)
    expect(await notesNow()).toEqual(JSON.parse(NOTES))
  })

  it('серверу любые ключи доступны, как раньше', async () => {
    await reset()
    await rpc('service', { manager_name: 'x', deadline_date: '2026-12-01' })
    expect(await notesNow()).toMatchObject({ manager_name: 'x' })
  })

  it('менеджеру и замерщику функция закрыта, как раньше', async () => {
    for (const who of ['manager', 'measurer', 'partner'] as const) {
      await reset()
      await expect(rpc(who, { urgent: true })).rejects.toThrow(/shop action/)
    }
  })

  it.each(['manager', 'buyer', 'admin', 'ceo'] as const)('%s меняет дату запуска', async who => {
    await reset()
    await update(who, `launched_at = '2026-11-02'`)
    const rows = await log()
    expect(rows).toHaveLength(1)
    expect(Object.keys(rows[0].details.changes)).toContain('launched_at')
    expect(rows[0].user_name).toBe(`Тест ${who}`)
  })

  it.each(['production', 'accountant', 'measurer'] as const)('%s не меняет дату запуска — ни колонкой, ни в notes', async who => {
    await reset()
    await expect(update(who, `launched_at = '2026-11-02'`)).rejects.toThrow(/Дату запуска/)
    await expect(update(who, 'notes = $1', [JSON.stringify({ ...JSON.parse(NOTES), launched_at: '2026-11-02' })])).rejects.toThrow(/Дату запуска/)
  })

  it('цех не может и снять дату запуска', async () => {
    await reset()
    await update('service', `launched_at = '2026-11-02'`)
    await expect(update('production', 'launched_at = null')).rejects.toThrow(/Дату запуска/)
  })

  it('отметка этапа цехом на запущенном заказе проходит: дата запуска не меняется', async () => {
    await reset()
    await update('service', `launched_at = '2026-11-02', notes = $1`, [JSON.stringify({ ...JSON.parse(NOTES), launched_at: '2026-11-02' })])
    await as('production', q => q('select mark_detail_stages(1, $1::jsonb)', [JSON.stringify({ 0: { cutting: true } })]))
    await rpc('production', { urgent: true })
    expect(await notesNow()).toMatchObject({ urgent: true, launched_at: '2026-11-02' })
  })

  it('битые notes не ломают запись', async () => {
    await reset()
    await db.query(`update b2b_orders set notes = 'не json' where id = 1`)
    await db.exec('delete from activity_log')
    await update('production', `notes = 'тоже не json'`)
    expect(await log()).toEqual([])
  })

  it('смена суммы и удаление заказа — в журнале', async () => {
    await reset()
    await update('admin', 'total_after_discount = 900')
    expect((await log())[0].details.changes).toMatchObject({ total_after_discount: [1000, 900] })
    await db.exec(`insert into b2b_orders (id, client_name, notes) values (2, 'Удаляемый', '{}'); delete from activity_log; delete from b2b_orders where id = 2`)
    expect(await log()).toHaveLength(1)
  })

  it('цены отверстий: сотрудники читают, партнёр — нет', async () => {
    const seen = async (who: Who) => {
      let n = -1
      await as(who, async q => { n = (await q('select * from b2b_hole_prices')).rows.length })
      return n
    }
    for (const who of ['manager', 'buyer', 'production', 'admin'] as const) expect(await seen(who), who).toBe(1)
    expect(await seen('partner')).toBe(0)
  })

  it('откат возвращает прежнее поведение, повторный накат — снова закрывает', async () => {
    await db.exec('reset role'); await db.exec(DOWN)
    await reset()
    await update('production', `launched_at = '2026-11-01'`)
    await rpc('production', { manager_name: 'x' })
    await db.exec('reset role'); await db.exec(file(NEW))
    await reset()
    await expect(rpc('production', { manager_name: 'x' })).rejects.toThrow(/из браузера/)
  })
})
