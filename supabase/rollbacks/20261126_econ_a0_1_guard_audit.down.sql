-- Откат 20261126_econ_a0_1_guard_audit.sql. Записи activity_log остаются.
drop trigger if exists trg_audit_b2b_order_note_money on public.b2b_orders;
drop trigger if exists trg_audit_b2b_orders on public.b2b_orders;
drop trigger if exists trg_guard_b2b_order_launch_date on public.b2b_orders;
drop function if exists public.audit_b2b_order_note_money();
drop function if exists public.guard_b2b_order_launch_date();
drop function if exists public.b2b_launch_editor_roles();

create or replace function public.patch_order_notes_shallow(p_order_id bigint, p_patch jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare n jsonb;
begin
  perform _assert_shop_caller();
  select coalesce(nullif(notes, '')::jsonb, '{}'::jsonb) into n
  from b2b_orders where id = p_order_id for update;
  if n is null then n := '{}'::jsonb; end if;
  update b2b_orders set notes = (n || p_patch)::text where id = p_order_id;
end $$;
drop function if exists public.b2b_browser_note_keys();

create or replace function public._b2b_order_money_keys(p_notes text) returns jsonb
language plpgsql immutable set search_path = public as $$
declare n jsonb;
begin
  begin
    n := nullif(p_notes, '')::jsonb;
  exception when others then
    return '{}'::jsonb;
  end;
  if n is null or jsonb_typeof(n) <> 'object' then return '{}'::jsonb; end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'payment_status',    n -> 'payment_status',
    'payment_source',    n -> 'payment_source',
    'prepayment_amount', n -> 'prepayment_amount',
    'paid_at',           n -> 'paid_at',
    'payments',          n -> 'payments',
    'price_approval',    n -> 'price_approval',
    'total_history',     n -> 'total_history',
    'stages.invoice_paid', case when jsonb_typeof(n -> 'stages') = 'object' then n -> 'stages' -> 'invoice_paid' end
  ));
end $$;
drop function if exists public._b2b_notes_launched_at(text);

drop policy if exists b2b_hole_prices_read on public.b2b_hole_prices;
create policy b2b_hole_prices_read on public.b2b_hole_prices
  for select to authenticated using (true);
