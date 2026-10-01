-- Ч1: партнёр прикладывает к просчёту чертёж конструктора или фото эскиза.
-- Разбор (Ч2) читает их по-разному, поэтому вид файла храним рядом с ним.
-- Старые вложения менеджеров остаются с kind = null.
alter table public.b2b_calculation_attachments
  add column if not exists kind text check (kind in ('drawing', 'sketch'));
