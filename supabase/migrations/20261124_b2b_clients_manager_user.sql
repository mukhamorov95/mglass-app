-- Ответственный менеджер клиента B2B: ему приходит «заявка из кабинета — проверить» (24.11.2026).
alter table public.b2b_clients add column if not exists manager_user_id uuid references public.users(id) on delete set null;
comment on column public.b2b_clients.manager_user_id is 'Ответственный менеджер: ему приходит «заявка из кабинета — проверить» (24.11.2026)';
-- Шовер Гласс ведёт Нуржан (слово владельца 24.11).
update public.b2b_clients set manager_user_id = '3375b51a-59ad-4739-af18-ba5d5b3a8b2b' where id = 2 and manager_user_id is null;
