-- Табло цеха: правка «Горит» и срока пишется в журнал карточки видом 'edited'
-- (docs/SHOP_BOARD_ROUTE.md). Без этого SQL правка работает, но в журнале не остаётся.

alter table public.shop_board_events drop constraint if exists shop_board_events_kind_check;
alter table public.shop_board_events add constraint shop_board_events_kind_check
  check (kind in ('created', 'taken', 'done', 'reopened', 'closed', 'comment', 'edited'));
