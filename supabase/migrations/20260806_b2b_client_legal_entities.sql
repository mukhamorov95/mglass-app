-- Юрлица заказчика: у одного B2B-клиента может быть несколько плательщиков (юрлиц).
-- Реквизиты добавляются, не затирая старые; при счёте выбирается одно юрлицо.
-- Плоские колонки b2b_clients остаются зеркалом ОСНОВНОГО юрлица (совместимость).
create table if not exists b2b_client_legal_entities (
  id                   bigserial primary key,
  client_id            bigint not null references b2b_clients(id) on delete cascade,
  organization_id      bigint not null default 1,
  full_name            text,   -- Полное юр. наименование (ООО «...» / ИП ...)
  inn                  text,
  kpp                  text,
  ogrn                 text,   -- ОГРН / ОГРНИП
  legal_address        text,
  bank_account         text,   -- Р/С
  bank_name            text,
  bik                  text,
  corr_account         text,   -- К/С
  supply_contract_no   text,
  supply_contract_date date,
  is_default           boolean not null default false,  -- какое юрлицо подставлять по умолчанию
  active               boolean not null default true,   -- add-without-delete: старые не удаляем, деактивируем
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists idx_bcle_client on b2b_client_legal_entities (client_id, active);
create index if not exists idx_bcle_org on b2b_client_legal_entities (organization_id);

-- Бэкфилл: у клиентов с заполненным ИНН делаем первое (дефолтное) юрлицо из
-- плоских колонок карточки. Идемпотентно — только если у клиента ещё нет юрлиц.
insert into b2b_client_legal_entities
  (client_id, organization_id, full_name, inn, kpp, ogrn, legal_address,
   bank_account, bank_name, bik, corr_account, supply_contract_no, supply_contract_date, is_default, active)
select c.id, coalesce(c.organization_id, 1), coalesce(nullif(btrim(c.full_name), ''), c.name),
       c.inn, c.kpp, c.ogrn, c.legal_address,
       c.bank_account, c.bank_name, c.bik, c.corr_account, c.supply_contract_no, c.supply_contract_date, true, true
from b2b_clients c
where c.inn is not null and btrim(c.inn) <> ''
  and not exists (select 1 from b2b_client_legal_entities e where e.client_id = c.id);

alter table b2b_client_legal_entities enable row level security;
create policy "Org tenant bcle" on b2b_client_legal_entities for all to authenticated
  using (organization_id = current_org_id() and not is_partner())
  with check (organization_id = current_org_id() and not is_partner());
create policy "auth bcle" on b2b_client_legal_entities for all to authenticated
  using (auth.role() = 'authenticated' and not is_partner())
  with check (auth.role() = 'authenticated' and not is_partner());

-- Выбор юрлица-плательщика фиксируем в реестре счетов.
alter table invoices add column if not exists payer_entity_id bigint references b2b_client_legal_entities(id);
