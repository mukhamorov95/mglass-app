-- Лаборатория ценообразования (/cfo/lab, ТЗ 27.11.2026). Экспериментальный контур: проекты
-- лаборатории не заказы — они не попадают в производство, на склад, в выручку и в статистику.
-- Действующие цены, справочники и заказы эта миграция не трогает: ни одной существующей
-- таблицы здесь нет.
--
-- RLS включён БЕЗ политик намеренно: обе таблицы читает и пишет только сервер сервисным
-- ключом после проверки роли (admin, ceo, cfo) в API. Из браузера под анонимным ключом
-- таблицы отдают пустоту — это не поломка, а граница: в справочнике лежат закупочные цены и
-- ставки, выведенные из окладов, поэтому прямого доступа у клиента быть не должно.
-- Откат: supabase/rollbacks/20261127_economics_lab.down.sql

-- Справочники лаборатории: технические нормативы и финансовые параметры. Репозиторий публичный,
-- поэтому сами значения живут здесь, а не в коде.
create table if not exists public.economics_lab_reference (
  id          text primary key check (id in ('tech', 'finance')),
  version     int not null,
  data        jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);
comment on table public.economics_lab_reference is
  'Справочники экспериментальной лаборатории: id = tech | finance, data = Reference (lib/economics/engine/reference.ts). Новая версия пишется целиком, прежняя остаётся в economics_lab_reference_history.';

-- История версий: уточнение норматива создаёт новую версию, прежняя не переписывается.
create table if not exists public.economics_lab_reference_history (
  id          bigserial primary key,
  ref_id      text not null,
  version     int not null,
  data        jsonb not null,
  reason      text not null default '',
  saved_at    timestamptz not null default now(),
  saved_by    uuid,
  unique (ref_id, version)
);

create table if not exists public.economics_lab_projects (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  note        text not null default '',
  input       jsonb not null,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.economics_lab_projects is
  'Экспериментальный проект лаборатории. Не заказ: в производство, склад, выручку и статистику не попадает.';

-- Сохранённый вариант расчёта: снимок входа и результата. Правка справочника сохранённый
-- результат не меняет — пересчёт делается явно и создаёт новый вариант.
create table if not exists public.economics_lab_variants (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.economics_lab_projects(id) on delete cascade,
  label         text not null,
  note          text not null default '',
  tech_stamp    text not null,
  finance_stamp text,
  input         jsonb not null,
  result        jsonb not null,
  computed_at   timestamptz not null default now(),
  saved_by      uuid
);
create index if not exists economics_lab_variants_project_idx on public.economics_lab_variants (project_id, computed_at desc);

alter table public.economics_lab_reference         enable row level security;
alter table public.economics_lab_reference_history enable row level security;
alter table public.economics_lab_projects          enable row level security;
alter table public.economics_lab_variants          enable row level security;
