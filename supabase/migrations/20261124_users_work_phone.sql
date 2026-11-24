-- Рабочий телефон сотрудника — показывается клиенту в кабинете в блоке «Ваш менеджер» (24.11.2026).
alter table public.users add column if not exists work_phone text;
comment on column public.users.work_phone is 'Рабочий телефон для клиентов: блок «Ваш менеджер» в кабинете партнёра';
