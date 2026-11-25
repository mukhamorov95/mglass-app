-- Архив объединённых счетов (владелец 25.11.2026): неактуальный счёт не удаляется, а уходит в архив —
-- status = 'cancelled' (в долг и сверки не входит), кто и когда — здесь. Вернуть можно.
alter table public.invoices
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by text;
