-- Тестовый партнёр (решение владельца 01.10.2026): карточка клиента без учётки и пароля.
-- Владелец смотрит кабинет его глазами через режим «Смотреть как партнёр»
-- (lib/partnerPreview.ts). is_test — признак, по которому режим разрешает на тестовой
-- карточке то, что на настоящей запрещено (настройки прилавка), а отчёты могут её исключать.

alter table public.b2b_clients add column if not exists is_test boolean not null default false;

insert into public.b2b_clients (name, discount_percent, is_test, crm_status, notes)
select 'Тестовый партнёр', 10, true, 'new', 'Служебная карточка для проверки кабинета партнёра. Заказов не создаёт.'
where not exists (select 1 from public.b2b_clients where is_test and name = 'Тестовый партнёр');
