-- Снимок рабочего дня менеджера: что он сделал вчера (docs/MANAGER_MORNING_ROUTE.md, М1).
--
-- Источник остаётся amo, АТС и приложение — здесь хранится уже посчитанный день,
-- чтобы «Утро» открывалось сразу, а не минуту ждало amo. Считает одна функция
-- (lib/managerDay.ts поверх lib/amoActivity.ts), та же, что на /commercial/activity.
-- Пишет крон /api/cron/manager-day-snapshot в 6:30 МСК; повтор перезаписывает день.

create table if not exists manager_day_stats (
  day                      date        not null,
  amo_user_id              bigint      not null,
  name                     text        not null,
  -- AmoCRM, lib/amoActivity.ts
  first_at                 timestamptz,
  last_at                  timestamptz,
  active_hours             numeric,
  longest_pause_min        integer,
  actions                  integer     not null default 0,
  messages_own             integer     not null default 0,
  messages_no_author       integer     not null default 0,
  client_messages          integer     not null default 0,
  reply_median_min         numeric,
  replies_counted          integer     not null default 0,
  unanswered               integer     not null default 0,
  left_waiting             integer     not null default 0,
  tasks_completed          integer     not null default 0,
  tasks_postponed          integer     not null default 0,
  cards_moved              integer     not null default 0,
  calls_out                integer     not null default 0,
  calls_out_ok             integer     not null default 0,
  calls_in                 integer     not null default 0,
  calls_in_missed          integer     not null default 0,
  talk_sec                 integer     not null default 0,
  -- AmoCRM, lib/amoResults.ts: вход сделки в этап за день
  leads_received           integer,
  first_contact_median_min numeric,
  adv_measure              integer,
  adv_kp                   integer,
  adv_invoice              integer,
  adv_paid                 integer,
  -- АТС onlinePBX; null — АТС в этот день не ответила или не подключена
  pbx_out                  integer,
  pbx_out_ok               integer,
  pbx_in                   integer,
  pbx_talk_sec             integer,
  -- Приложение: что создано под его учёткой
  app_quick                integer     not null default 0,
  app_calcs                integer     not null default 0,
  app_kp                   integer     not null default 0,
  app_contracts            integer     not null default 0,
  updated_at               timestamptz not null default now(),
  primary key (day, amo_user_id)
);

create index if not exists manager_day_stats_user_day on manager_day_stats (amo_user_id, day desc);

alter table manager_day_stats enable row level security;

-- Руководство видит всех; менеджер — только свои строки, пока ему не открыли «видеть все».
drop policy if exists manager_day_stats_select on manager_day_stats;
create policy manager_day_stats_select on manager_day_stats for select to authenticated using (
  exists (select 1 from crm_caller() c where c.u_role in ('admin','ceo','commercial','cfo') or c.can_all)
  or amo_user_id = (select u.amo_user_id from users u where u.id = auth.uid())
);
-- INSERT/UPDATE/DELETE-политик нет: пишет только service-role.

revoke all on manager_day_stats from anon;
