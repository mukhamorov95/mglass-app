-- Задание на производство контента: сценарий из AI Video Factory, развёрнутый
-- в конкретную работу — кадры с промптами, текст диктора, моменты субтитров.
--
-- Почему не «запуск генерации из приложения»: ключа Higgsfield в приложении нет,
-- доступ к нему идёт через MCP оркестратора. Поэтому приложение готовит задание
-- и хранит результаты, а генерацию выполняет оркестратор. Появится ключ в env —
-- поверх этой же таблицы встанет автозапуск, ломать ничего не придётся.
create table if not exists public.promo_jobs (
  id            bigserial primary key,
  script_id     bigint references public.marketing_scripts(id) on delete set null,
  title         text not null,
  stage         text not null default 'shots'
                check (stage in ('shots','animation','voice','edit','subtitles','cover','published')),
  shots         jsonb not null default '[]'::jsonb,
  narrator_text text,
  subtitle_moments jsonb not null default '[]'::jsonb,
  cover_idea    text,
  result_url    text,
  note          text,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists promo_jobs_stage_idx on public.promo_jobs(stage);
create index if not exists promo_jobs_script_idx on public.promo_jobs(script_id);

alter table public.promo_jobs enable row level security;

-- Раздел «Продвижение» видит только владелец — политика это повторяет.
-- Пустой RLS отвечал бы 200 с пустым телом и молчал, поэтому политики две и явные.
drop policy if exists "Owner read promo_jobs" on public.promo_jobs;
create policy "Owner read promo_jobs" on public.promo_jobs for select to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('admin','ceo')));

drop policy if exists "Owner write promo_jobs" on public.promo_jobs;
create policy "Owner write promo_jobs" on public.promo_jobs for all to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('admin','ceo')))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('admin','ceo')));
