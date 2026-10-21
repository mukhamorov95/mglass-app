-- Черновик «Производства» в финмодели (владелец 22.10.2026): копия юнита для проб.
-- Своя строка finplan_models; сводки, цех и финнеделя читают только mglass/production/total.
alter table public.finplan_models drop constraint if exists finplan_models_unit_check;
alter table public.finplan_models add constraint finplan_models_unit_check
  check (unit in ('total','mglass','production','production_draft'));
