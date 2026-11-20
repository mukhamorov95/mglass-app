-- Реестр публикаций (маршрут контент-машины, Э1, 20.11.2026): объект → публикации → цифры.
-- Адрес, имя и телефон клиента сюда не пишутся — только ЖК и район (docs/sites/OBJECT_CARD.md).
-- RLS без политик: читает и пишет только /marketing/objects после проверки роли (admin, ceo, seo).

create table if not exists public.content_objects (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9-]+$'),
  title       text not null,
  product     text,
  district    text,
  site        text not null default 'mglass-zerkala.ru',
  page_url    text,
  status      text not null default 'draft' check (status in ('draft', 'published')),
  notes       text,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id)
);

create table if not exists public.content_publications (
  id            uuid primary key default gen_random_uuid(),
  object_id     uuid not null references public.content_objects(id) on delete cascade,
  platform      text not null check (platform in ('site', 'telegram', 'vk', 'dzen', 'avito', 'yandex_maps', 'pinterest', 'other')),
  url           text,
  target_url    text not null,
  utm_source    text,
  utm_medium    text,
  utm_campaign  text,
  utm_content   text,
  status        text not null default 'draft' check (status in ('draft', 'review', 'published')),
  published_at  date,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id)
);
create index if not exists content_publications_object_idx on public.content_publications(object_id);

create table if not exists public.content_metrics (
  id              bigserial primary key,
  publication_id  uuid not null references public.content_publications(id) on delete cascade,
  day             date not null,
  source          text not null,
  views           int,
  clicks          int,
  unique (publication_id, day, source)
);

alter table public.content_objects enable row level security;
alter table public.content_publications enable row level security;
alter table public.content_metrics enable row level security;

insert into public.content_objects (slug, title, product, district, site, page_url, status) values
  ('zhk-sobytie', 'ЖК «Событие»', 'Зеркала в полный рост от пола до потолка', 'запад Москвы, м. Мичуринский проспект', 'mglass-zerkala.ru',
   'https://www.mglass-zerkala.ru/raboty/zerkala-ot-pola-do-potolka-zhk-sobytie', 'published'),
  ('zhk-subbota', 'ЖК «Суббота»', 'Зеркала с подсветкой и душевая', 'Беговой, САО', 'mglass-zerkala.ru',
   'https://www.mglass-zerkala.ru/raboty/zerkala-s-podsvetkoj-zhk-subbota', 'published')
on conflict (slug) do nothing;

insert into public.content_publications (object_id, platform, url, target_url, status, published_at)
select o.id, 'site', o.page_url, o.page_url, 'published', date '2026-11-18'
from public.content_objects o
where o.slug in ('zhk-sobytie', 'zhk-subbota')
  and not exists (select 1 from public.content_publications p where p.object_id = o.id and p.platform = 'site');
