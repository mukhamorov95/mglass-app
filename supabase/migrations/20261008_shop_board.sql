-- Табло цеха — поручения, которые видят все (docs/SHOP_BOARD_ROUTE.md, этап 1).
--
-- Карточка-поручение: что сделать, по каким заказам, к какому сроку, кто поставил и кто
-- взял. Колонки канбана — status: new → in_progress → done → closed.
-- events — журнал карточки: взял / готово / вернул / закрыл / комментарий.
--
-- Читают и пишут только через API (/api/shop-board/*) с проверкой роли в том же файле
-- (service-role). Прямого доступа у клиента нет: RLS включён, политика чтения — только
-- владельцу (для разбора в SQL Editor), политик записи нет.

create table if not exists public.shop_board_cards (
  id               bigserial primary key,
  title            text not null check (length(btrim(title)) between 1 and 200),
  details          text check (details is null or length(details) <= 2000),
  order_ids        bigint[] not null default '{}',
  due_at           timestamptz,
  hot              boolean not null default false,
  status           text not null default 'new' check (status in ('new', 'in_progress', 'done', 'closed')),
  created_by       uuid not null references auth.users(id),
  created_by_name  text,
  taken_by         uuid references auth.users(id),
  taken_by_name    text,
  taken_at         timestamptz,
  done_by          uuid references auth.users(id),
  done_by_name     text,
  done_at          timestamptz,
  closed_by        uuid references auth.users(id),
  closed_by_name   text,
  closed_at        timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists shop_board_cards_open_idx on public.shop_board_cards (status, due_at) where status <> 'closed';
create index if not exists shop_board_cards_closed_idx on public.shop_board_cards (closed_at) where status = 'closed';

create table if not exists public.shop_board_events (
  id         bigserial primary key,
  card_id    bigint not null references public.shop_board_cards(id) on delete cascade,
  kind       text not null check (kind in ('created', 'taken', 'done', 'reopened', 'closed', 'comment')),
  text       text check (text is null or length(text) <= 1000),
  by_id      uuid references auth.users(id),
  by_name    text,
  created_at timestamptz not null default now()
);

create index if not exists shop_board_events_card_idx on public.shop_board_events (card_id, id);

alter table public.shop_board_cards enable row level security;
alter table public.shop_board_events enable row level security;

drop policy if exists shop_board_cards_owner_read on public.shop_board_cards;
create policy shop_board_cards_owner_read on public.shop_board_cards for select using (public.is_owner());

drop policy if exists shop_board_events_owner_read on public.shop_board_events;
create policy shop_board_events_owner_read on public.shop_board_events for select using (public.is_owner());

-- Дима (Дмитрий, prod@mglass.ru) ставит поручения наравне с владельцем — решение владельца 08.10.
update public.users
set permissions = coalesce(permissions, '{}'::jsonb) || '{"shop_board": true}'::jsonb
where id = '29d5b13f-06c5-48d3-83a7-ccf801f155cb';
