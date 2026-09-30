-- Журнал распределителя новых заявок «Продаж» (docs/LEAD_DISTRIBUTION_ROUTE.md): кому отдать и почему.
-- В тени (mode = shadow) в amo ничего не пишется — журнал нужен, чтобы неделю сравнивать решения
-- алгоритма с ручными назначениями; он же считает «сколько заявок сегодня у каждого».
-- Пишет только крон /api/cron/lead-distribution (service role); читать может владелец.

create table if not exists public.lead_distribution (
  lead_id                  bigint primary key,
  lead_name                text        not null,
  lead_created_at          timestamptz not null,
  phone                    text,
  status                   text        not null check (status in ('deferred', 'decided', 'skipped')),
  rule                     text        check (rule in ('known_client', 'rotation', 'least_loaded')),
  chosen_user_id           bigint,
  chosen_name              text,
  reason                   text,
  sellers                  jsonb,
  responsible_at_decision  bigint,
  mode                     text        not null default 'shadow' check (mode in ('shadow', 'live')),
  decided_at               timestamptz,
  applied_at               timestamptz,
  updated_at               timestamptz not null default now()
);

create index if not exists lead_distribution_decided_at_idx on public.lead_distribution (decided_at) where status = 'decided';
create index if not exists lead_distribution_phone_idx on public.lead_distribution (phone) where phone is not null;

alter table public.lead_distribution enable row level security;
revoke all on table public.lead_distribution from anon;

drop policy if exists "Owner reads lead_distribution" on public.lead_distribution;
create policy "Owner reads lead_distribution" on public.lead_distribution
  for select to authenticated using (public.is_owner());
