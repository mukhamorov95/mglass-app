-- Одна строка выписки — не больше одного ДЕЙСТВУЮЩЕГО аванса. Отменённый аванс строку
-- освобождает: иначе ошибочно записанный аванс нельзя было бы записать заново.
alter table public.client_advances drop constraint if exists client_advances_bank_row_id_key;
create unique index if not exists client_advances_bank_row_live_idx
  on public.client_advances (bank_row_id) where voided_at is null;
