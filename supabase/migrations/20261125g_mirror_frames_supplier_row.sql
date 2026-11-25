-- Обрамление зеркал (В5, владелец 25.11.2026): рамка привязана к строке прайса поставщика
-- (Ветро/АВ24, артикул+цвет) — себестоимость метра берётся из прайса, а не вписывается руками.
alter table mirror_frames add column if not exists supplier_row_id bigint references supplier_price_rows(id) on delete set null;
