-- Причина №2: гонка на notes теряла ~11% отметок этапов. Экраны/API читали весь
-- notes в JS, правили и писали блоб обратно — при двух одновременных отметках по
-- одному заказу второй затирал первого. Фикс: правка под блокировкой строки.
-- Применено через MCP apply_migration (atomic_detail_stage_marks). Файл — для истории.

create or replace function mark_detail_stages(p_order_id bigint, p_updates jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  n jsonb; u jsonb; itm text; stg text;
begin
  select coalesce(nullif(notes, '')::jsonb, '{}'::jsonb) into n
  from b2b_orders where id = p_order_id for update;
  if n is null then n := '{}'::jsonb; end if;
  n := jsonb_set(n, '{detail_stages}', coalesce(n->'detail_stages', '{}'::jsonb), true);
  for u in select * from jsonb_array_elements(p_updates) loop
    itm := u->>'item'; stg := u->>'stage';
    n := jsonb_set(n, array['detail_stages', itm], coalesce(n->'detail_stages'->itm, '{}'::jsonb), true);
    n := jsonb_set(n, array['detail_stages', itm, stg], u->'entry', true);
  end loop;
  update b2b_orders set notes = n::text where id = p_order_id;
end $$;

create or replace function patch_order_notes_shallow(p_order_id bigint, p_patch jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare n jsonb;
begin
  select coalesce(nullif(notes, '')::jsonb, '{}'::jsonb) into n
  from b2b_orders where id = p_order_id for update;
  if n is null then n := '{}'::jsonb; end if;
  update b2b_orders set notes = (n || p_patch)::text where id = p_order_id;
end $$;

grant execute on function mark_detail_stages(bigint, jsonb) to authenticated;
grant execute on function patch_order_notes_shallow(bigint, jsonb) to authenticated;
