-- Реквизиты B2B-покупателя для «Счёт-спецификации» (счёт-оферта от ООО).
-- Хранятся в карточке клиента: заполнили один раз — счета автозаполняются.
ALTER TABLE public.b2b_clients
  ADD COLUMN IF NOT EXISTS full_name           text,   -- Полное юр. наименование (ИП Иванов И.И. / ООО «...»)
  ADD COLUMN IF NOT EXISTS inn                 text,
  ADD COLUMN IF NOT EXISTS kpp                 text,
  ADD COLUMN IF NOT EXISTS ogrn                text,   -- ОГРН / ОГРНИП
  ADD COLUMN IF NOT EXISTS legal_address       text,
  ADD COLUMN IF NOT EXISTS bank_account        text,   -- Расчётный счёт (Р/С)
  ADD COLUMN IF NOT EXISTS bank_name           text,
  ADD COLUMN IF NOT EXISTS bik                 text,
  ADD COLUMN IF NOT EXISTS corr_account        text,   -- Корр. счёт (К/С)
  ADD COLUMN IF NOT EXISTS supply_contract_no  text,   -- Рамочный «Договор поставки № …» (опционально)
  ADD COLUMN IF NOT EXISTS supply_contract_date date;
