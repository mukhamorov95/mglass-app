-- Этап «Песочка» в production_tasks. Применено владельцем в SQL Editor 09.10.2026.
-- 1) Проверки pt_stage_key_valid / pt_station_valid (последняя версия — 20260706) не знали
--    'sandblast': этап появился в коде позже, и запуск заказа с песочкой падал на вставке
--    задач целиком (launch-production — best-effort, ошибку никто не видел).
-- 2) Пескоструй выбирали услугой, признак «Песочка» не ставили — этапа в маршруте не было.
--    Деталям незавершённых заказов досоздаём sandblast перед закалкой/триплексом/упаковкой,
--    только если деталь туда ещё не дошла (следующая задача в очереди). Триплекс не трогаем.
--    Итог 09.10: 9 деталей в 8 заказах; 05669 пропущен — упаковка уже отмечена.
begin;
alter table public.production_tasks drop constraint if exists pt_stage_key_valid;
alter table public.production_tasks add constraint pt_stage_key_valid check (
  stage_key in ('cutting','curved','polishing','drilling','facet','sandblast','tempering','triplex','packaging'));
alter table public.production_tasks drop constraint if exists pt_station_valid;
alter table public.production_tasks add constraint pt_station_valid check (
  station in ('cutting','curved','polishing','drilling','facet','sandblast','tempering','triplex','packaging'));
do $$
declare r record; v_seq int; v_next record; v_prev bigint; v_new bigint;
begin
  for r in
    select o.id as order_id, (e.ord - 1)::int as item_index
    from b2b_orders o
    cross join lateral jsonb_array_elements(o.items::jsonb) with ordinality e(item, ord)
    where exists (select 1 from production_tasks t where t.order_id = o.id and t.status <> 'done')
      and exists (select 1 from jsonb_array_elements(coalesce(e.item->'services','[]'::jsonb)) s
                  where s->>'name' ~* 'пескостру|матирован|матовк')
      and coalesce((e.item->>'hasTriplex')::boolean, false) = false
      and exists (select 1 from production_tasks t where t.order_id = o.id and t.item_index = (e.ord - 1)::int)
      and not exists (select 1 from production_tasks t where t.order_id = o.id and t.item_index = (e.ord - 1)::int
                      and (t.stage_key = 'sandblast' or t.layer <> 1))
  loop
    select min(sequence_order) into v_seq from production_tasks
      where order_id = r.order_id and item_index = r.item_index and stage_key in ('tempering','triplex','packaging');
    if v_seq is null then continue; end if;
    select id, status into v_next from production_tasks
      where order_id = r.order_id and item_index = r.item_index and sequence_order = v_seq order by id limit 1;
    if v_next.status <> 'queued' then continue; end if;
    select id into v_prev from production_tasks
      where order_id = r.order_id and item_index = r.item_index and sequence_order < v_seq
      order by sequence_order desc, id desc limit 1;
    update production_tasks set sequence_order = sequence_order + 1
      where order_id = r.order_id and item_index = r.item_index and sequence_order >= v_seq;
    insert into production_tasks (order_id, item_index, stage_key, sequence_order, station, status, layer, blocked_by_task_id)
      values (r.order_id, r.item_index, 'sandblast', v_seq, 'sandblast', 'queued', 1, v_prev) returning id into v_new;
    update production_tasks set blocked_by_task_id = v_new where id = v_next.id;
  end loop;
end $$;
commit;
