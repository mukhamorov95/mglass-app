-- ФП Ф1 (docs/finplan/FINPLAN_ROUTE.md): внедоходное поступление — заём, вклад
-- учредителя, возврат от поставщика. Растит остаток, но не входит в выполнение
-- плана клиентских поступлений и в заливку фондов. Правит финконтур.
alter table public.cashflow_subfunds add column if not exists non_income boolean not null default false;

update public.cashflow_subfunds s set non_income = true
from public.cashflow_funds f
where f.id = s.fund_id and f.flow = 'in' and lower(trim(s.name)) in ('со своих', 'возвраты');
