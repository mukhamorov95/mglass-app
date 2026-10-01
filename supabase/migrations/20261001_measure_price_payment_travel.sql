-- Замеры, второй круг (владелец 01.10.2026):
--  · actual_price + price_note — цена выезда, которую назвал замерщик, если она не совпала
--    с ценой менеджера («заложил 2 500, а вышло 3 500, потому что…»); цена менеджера
--    (visit_price) остаётся как была;
--  · visit_payment — как оплачен выезд: на объекте замерщику / на компанию / не оплачен;
--  · travel_min — оценка дороги до этого замера от предыдущего (минуты), её ставит тот,
--    кто назначает замер вторым и дальше в день;
--  · часы замерщика по умолчанию — пн–пт 09:00–18:00 (суббота — по желанию в «Моём графике»).

alter table public.measure_requests
  add column if not exists actual_price numeric,
  add column if not exists price_note text,
  add column if not exists visit_payment text,
  add column if not exists travel_min integer;

alter table public.measure_requests drop constraint if exists measure_requests_visit_payment_chk;
alter table public.measure_requests add constraint measure_requests_visit_payment_chk
  check (visit_payment is null or visit_payment in ('onsite', 'company', 'unpaid'));
alter table public.measure_requests drop constraint if exists measure_requests_travel_chk;
alter table public.measure_requests add constraint measure_requests_travel_chk
  check (travel_min is null or travel_min between 0 and 600);
alter table public.measure_requests drop constraint if exists measure_requests_actual_price_chk;
alter table public.measure_requests add constraint measure_requests_actual_price_chk
  check (actual_price is null or actual_price >= 0);

alter table public.measurer_schedules alter column work_days set default '{1,2,3,4,5}';
alter table public.measurer_schedules alter column work_to set default '18:00';
