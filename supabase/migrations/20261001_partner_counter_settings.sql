-- Прилавок партнёра (точки на стройрынках, решение 01.10.2026): наценка точки и
-- шапка КП, которое партнёр печатает своему покупателю от своего имени.
-- Партнёр таблицу напрямую не читает: только /api/partner/settings под service role
-- через resolvePartnerClient. Поэтому RLS включён без политик, а права anon и
-- authenticated сняты — прямой запрос из браузера получит пустоту, а не чужие строки.
-- Покупателя партнёра здесь нет и не будет: его ФИО в нашу базу не попадает (152-ФЗ).

create table if not exists public.b2b_partner_settings (
  client_id  integer primary key references public.b2b_clients(id) on delete cascade,
  markup_pct numeric(5,2) not null default 25 check (markup_pct >= 0 and markup_pct <= 300),
  kp_name    text check (char_length(kp_name) <= 120),
  kp_phone   text check (char_length(kp_phone) <= 40),
  kp_note    text check (char_length(kp_note) <= 500),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table public.b2b_partner_settings enable row level security;
revoke all on public.b2b_partner_settings from anon, authenticated;
