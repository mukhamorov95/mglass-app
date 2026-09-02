-- Форматы листа читались и писались с клиента, но у таблицы был включён RLS
-- без единой политики: PostgREST отвечал 200 с пустым массивом, без ошибки.
--
-- Следствия, обе тихие:
--   1) калькулятор не видел ни одного варианта и раскраивал по листу, записанному
--      в самом материале. У 7 материалов из 48 он отличается от фактического
--      (например 3210x2250 против 2800x2100) — отход и цена считались по листу,
--      которого нет;
--   2) админский экран форматов не мог ни прочитать, ни изменить строку —
--      кнопки работали, результата не было.
--
-- Политика по образцу b2b_films: вошедшие сотрудники да, партнёры нет.
drop policy if exists "Auth manage b2b_material_sheet_variants" on public.b2b_material_sheet_variants;
create policy "Auth manage b2b_material_sheet_variants"
  on public.b2b_material_sheet_variants
  for all
  to authenticated
  using (not is_partner())
  with check (not is_partner());
