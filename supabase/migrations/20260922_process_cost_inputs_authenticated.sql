-- Политики process_cost_inputs были созданы без TO authenticated, то есть выданы
-- роли PUBLIC — в неё входит и anon. Предикат `not is_partner()` анонима не
-- отсекает: is_partner() строится на EXISTS, а EXISTS при пустом auth.uid()
-- возвращает false, значит NOT false = true. Себестоимость процессов цеха
-- (цены материалов, время, оборудование) была доступна без входа в систему.
drop policy if exists "Auth read process_cost_inputs" on process_cost_inputs;
create policy "Auth read process_cost_inputs" on process_cost_inputs
  for select to authenticated using (not is_partner());

drop policy if exists "Auth manage process_cost_inputs" on process_cost_inputs;
create policy "Auth manage process_cost_inputs" on process_cost_inputs
  for all to authenticated using (not is_partner()) with check (not is_partner());

revoke all on process_cost_inputs from anon;
