-- Откуда пришёл B2B-клиент (этап А3, docs/avito-b2b/AVITO_B2B_ROUTE.md): без этого отчёт
-- /b2b-crm/report не ответит, сколько денег принёс Авито или другой канал.
-- Список значений продублирован в B2B_SOURCES (lib/types.ts) — менять оба места вместе.
alter table public.b2b_clients add column if not exists crm_source text;

alter table public.b2b_clients drop constraint if exists b2b_clients_crm_source_check;
alter table public.b2b_clients add constraint b2b_clients_crm_source_check check (
  crm_source is null or crm_source in (
    'avito', 'referral', 'partner_program', 'website', 'yandex_maps',
    '2gis', 'exhibition', 'cold_call', 'retail', 'other'
  )
);

-- Клиенты, привязанные к партнёрской программе, источник уже известен.
update public.b2b_clients c set crm_source = 'partner_program'
where c.crm_source is null
  and exists (select 1 from public.referral_clients r where r.b2b_client_id = c.id);
