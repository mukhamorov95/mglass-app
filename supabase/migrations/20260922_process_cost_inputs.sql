-- Исходные данные процессов цеха для расчёта себестоимости (пескоструй и далее).
-- Владелец собирает их не за один раз: ширину рулона и вес мешка назвал сразу,
-- расход песка и время меряют в цеху позже. Поэтому они должны храниться, а не
-- жить в полях формы до перезагрузки.
create table if not exists process_cost_inputs (
  process     text primary key,
  inputs      jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table process_cost_inputs enable row level security;

-- Как у production_settings: сотрудники читают и правят, партнёр не видит.
drop policy if exists "Auth read process_cost_inputs" on process_cost_inputs;
create policy "Auth read process_cost_inputs" on process_cost_inputs
  for select using (not is_partner());

drop policy if exists "Auth manage process_cost_inputs" on process_cost_inputs;
create policy "Auth manage process_cost_inputs" on process_cost_inputs
  for all using (not is_partner()) with check (not is_partner());
