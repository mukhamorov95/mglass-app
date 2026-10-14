-- 14.10: этап «Оплачен» ставят деньги из выписки и аванса (lib/b2b/paidStage.ts) и помечают
-- notes.payment_source. Метка решает, снимет ли сверка этап, когда платёж отменят, — из
-- браузера её не пишет никто, как и остальные ключи оплаты. Список = SERVER_ONLY_NOTE_KEYS.
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
