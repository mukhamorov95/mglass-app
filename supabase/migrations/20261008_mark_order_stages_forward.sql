-- Флаги этапов заказа «только вперёд» с честным ответом, кто их поставил.
--
-- Зачем. Зеркало цеха (lib/productionOrderMirror.ts) ставит notes.stages.packaged, когда
-- закрыта последняя упаковка, и на этом переходе менеджеру уходит «упакован — согласуйте
-- отгрузку». mark_order_stages пишет безусловно и не говорит, стоял ли флаг до вызова:
-- две быстрые отметки по одному заказу (очередь цеха оптимистичная, «Готово» жмут подряд)
-- обе видят «флага нет», обе его ставят — и менеджер получает два сообщения.
--
-- Эта функция под той же блокировкой строки ставит только отсутствующие ключи и
-- возвращает массив ключей, которые поставил именно этот вызов. Код без неё работает
-- как раньше (откат на mark_order_stages), но тогда «ровно один раз» не гарантирован.
--
-- Проверка роли — как в mark_order_stages. SECURITY DEFINER + auth.uid() IS NULL у anon,
-- поэтому сначала REVOKE у public/anon, потом GRANT.

create or replace function public.mark_order_stages_forward(p_order_id bigint, p_stages jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n jsonb;
  k text;
  v jsonb;
  r text;
  cur jsonb;
  added jsonb := '[]'::jsonb;
begin
  if auth.uid() is not null then
    select role into r from users where id = auth.uid();
    if r is null or r not in ('production', 'admin', 'ceo', 'buyer', 'manager', 'commercial') then
      raise exception 'forbidden: stage marking requires order role' using errcode = '42501';
    end if;
  end if;

  select coalesce(nullif(notes, '')::jsonb, '{}'::jsonb) into n
  from b2b_orders where id = p_order_id for update;
  if not found then return added; end if;

  n := jsonb_set(n, '{stages}', coalesce(n->'stages', '{}'::jsonb), true);

  for k, v in select * from jsonb_each(p_stages) loop
    if v is null or v = 'null'::jsonb then continue; end if;
    cur := n->'stages'->k;
    -- «Нет флага» — как в pickOrderStageFlags: отсутствует, null, false или пустая строка.
    if cur is null or cur in ('null'::jsonb, 'false'::jsonb, '""'::jsonb) then
      n := jsonb_set(n, array['stages', k], v, true);
      added := added || to_jsonb(k);
    end if;
  end loop;

  if jsonb_array_length(added) > 0 then
    update b2b_orders set notes = n::text where id = p_order_id;
  end if;
  return added;
end
$$;

revoke all on function public.mark_order_stages_forward(bigint, jsonb) from public;
revoke all on function public.mark_order_stages_forward(bigint, jsonb) from anon;
grant execute on function public.mark_order_stages_forward(bigint, jsonb) to authenticated, service_role;
