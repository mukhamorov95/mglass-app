-- Мост «договор/счёт → реестр продаж».
-- До этого contracts висел отдельно от денег: предоплата жила только цифрой в
-- печатном PDF и нигде не фиксировалась, отметить продажу было негде. Теперь
-- оплата по договору рождает строку продажи (как уже работает для B2B), а
-- каждое поступление — строку в payments через crm_sale_id (CHECK
-- payments_has_document это уже допускает, менять его не нужно).
--
-- Аддитивно и nullable: исторические строки реестра не затрагиваются.
alter table public.crm_sales
  add column if not exists contract_id bigint references public.contracts(id) on delete restrict;

-- Индекс ОБЫЧНЫЙ, не частичный: ON CONFLICT (contract_id) не подхватывает
-- частичный уникальный индекс (пришлось бы дублировать его предикат в каждом
-- запросе — апсерт падал с «no unique or exclusion constraint matching the
-- ON CONFLICT specification»). В Postgres уникальный индекс по nullable-колонке
-- допускает сколько угодно NULL, поэтому строки без договора друг другу не
-- мешают — ровно как у crm_sales_b2b_order_id_key и crm_sales_order_id_key.
drop index if exists crm_sales_contract_id_key;

create unique index crm_sales_contract_id_key
  on public.crm_sales (contract_id);
