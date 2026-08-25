-- A1: флаг «клиент может сам скачать счёт-спецификацию».
-- По умолчанию ВЫКЛЮЧЕН — счёт выставляем мы, пока владелец не убедится в паритете
-- расчётов и не включит самообслуживание конкретному клиенту.
alter table b2b_clients
  add column if not exists can_self_invoice boolean not null default false;
