-- НДС на уровне строки цены (а не на уровне позиции фурнитуры)
alter table public.shower_catalog_prices
  add column if not exists vat_included boolean not null default false;
