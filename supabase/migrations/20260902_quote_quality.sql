-- Качество просчёта: насколько полно менеджер описал изделие при расчёте.
--
-- Зачем функция, а не выборка в приложении: признаки лежат внутри jsonb-массива
-- `b2b_orders.items`, и разворачивать 1700 позиций на каждой загрузке экрана —
-- значит тащить в Node несколько мегабайт ради четырёх счётчиков.
--
-- Три счётчика вместо одного сознательно. `hasHoles` — признак «нужна сверловка»,
-- он один решает, появится ли этап у сверловщика. `holes` — группы «N штук ⌀D»,
-- поле появилось 28.08 (PR #365), до этой даты его не существовало и ноль в нём
-- ничего не говорит о менеджере. Диаметры в `comment` пишет разбор чертежа —
-- без этого счётчика пустое поле групп читается как «данных нет», хотя данные
-- есть, просто в другом месте.
--
-- Архивные просчёты не считаем: выброшенный черновик не характеризует работу.

create or replace function public.quote_quality_weekly(p_from date)
returns table (
  week            date,
  manager         text,
  positions       bigint,
  flagged         bigint,
  detailed        bigint,
  diam_in_comment bigint,
  cutouts         bigint,
  orders          bigint
)
language sql
stable
as $$
  select
    date_trunc('week', o.created_at)::date                                   as week,
    coalesce(nullif(o.created_by_name, ''), o.created_by, '— не указан —')   as manager,
    count(*)                                                                  as positions,
    count(*) filter (where (it->>'hasHoles')::boolean is true)                as flagged,
    count(*) filter (where jsonb_typeof(it->'holes') = 'array'
                       and jsonb_array_length(it->'holes') > 0)               as detailed,
    count(*) filter (where coalesce(it->>'comment', '') ~ '[Ø⌀]')             as diam_in_comment,
    count(*) filter (where (it->>'hasCutouts')::boolean is true)              as cutouts,
    count(distinct o.id)                                                      as orders
  from public.b2b_orders o
  cross join lateral jsonb_array_elements(o.items) as it
  where jsonb_typeof(o.items) = 'array'
    and o.archived_at is null
    and o.created_at >= p_from
  group by 1, 2
$$;

-- Экран зовут сервис-клиентом после проверки роли (lib/apiAuth). Никому другому
-- функция не нужна: REVOKE до GRANT, иначе унаследуется PUBLIC EXECUTE.
revoke all on function public.quote_quality_weekly(date) from public;
revoke all on function public.quote_quality_weekly(date) from anon;
revoke all on function public.quote_quality_weekly(date) from authenticated;
grant execute on function public.quote_quality_weekly(date) to service_role;

comment on function public.quote_quality_weekly(date) is
  'Полнота просчёта по неделям и менеджерам: позиций, отмечено отверстий, расписаны группы, диаметры в комментарии, вырезы. Поле групп существует с 28.08.2026.';
