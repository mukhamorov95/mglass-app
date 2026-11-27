-- Светофор входящей заявки B2B (этап В3, docs/avito-b2b/INQUIRY_ROUTE.md).
-- Аддитивная: только новые колонки и новая таблица порогов — накатывается ДО деплоя кода,
-- который их читает. Ничего не отнимает, старые строки остаются валидными (всё nullable).
--
-- Числа (units) считает код по тексту заявки, сегмент — мнение модели; уровень (tier)
-- выводится из чисел и порогов владельца, поэтому пороги живут в таблице, а не в коде:
-- «с какого объёма заявка промышленная» — решение владельца, а не константа разработчика.

alter table public.b2b_inquiries
  add column if not exists triage_segment text,
  add column if not exists triage_tier    text,
  add column if not exists triage_units   integer,
  add column if not exists triage_repeat  text,
  add column if not exists triage_gaps    text[],
  add column if not exists triaged_at     timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'b2b_inquiries_triage_segment_check') then
    alter table public.b2b_inquiries add constraint b2b_inquiries_triage_segment_check
      check (triage_segment is null or triage_segment in ('private','workshop','manufacturer','trade','unclear'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'b2b_inquiries_triage_tier_check') then
    alter table public.b2b_inquiries add constraint b2b_inquiries_triage_tier_check
      check (triage_tier is null or triage_tier in ('small','batch','large'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'b2b_inquiries_triage_repeat_check') then
    alter table public.b2b_inquiries add constraint b2b_inquiries_triage_repeat_check
      check (triage_repeat is null or triage_repeat in ('once','repeat','unknown'));
  end if;
end $$;

-- Крупное и повторяющееся наверх списка заявок.
create index if not exists b2b_inquiries_triage_idx
  on public.b2b_inquiries (triage_tier, created_at desc);

-- Пороги уровня. Одна строка: id фиксирован true, вторая строка физически невозможна —
-- иначе «какой из двух порогов настоящий» стало бы вопросом без ответа.
create table if not exists public.b2b_inquiry_triage_settings (
  id          boolean primary key default true,
  batch_from  integer not null default 10,
  large_from  integer not null default 50,
  -- true, пока значения поставил не владелец: экран показывает их с пометкой «стартовое».
  is_starter  boolean not null default true,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.users(id) on delete set null,
  constraint b2b_inquiry_triage_settings_single check (id),
  constraint b2b_inquiry_triage_settings_order check (large_from >= batch_from and batch_from >= 1)
);

insert into public.b2b_inquiry_triage_settings (id) values (true) on conflict (id) do nothing;

alter table public.b2b_inquiry_triage_settings enable row level security;
revoke all on public.b2b_inquiry_triage_settings from anon;

-- Читают те же, кто видит заявки: иначе на экране заявок не объяснить, почему «партия».
drop policy if exists "Triage settings read" on public.b2b_inquiry_triage_settings;
create policy "Triage settings read" on public.b2b_inquiry_triage_settings for select to authenticated
  using (
    exists (select 1 from public.users u where u.id = auth.uid()
            and u.role in ('admin','ceo','manager','commercial','buyer','cfo'))
  );

-- Меняет только владелец: порог решает, что считать промышленной заявкой.
drop policy if exists "Triage settings write" on public.b2b_inquiry_triage_settings;
create policy "Triage settings write" on public.b2b_inquiry_triage_settings for update to authenticated
  using (is_owner()) with check (is_owner());
