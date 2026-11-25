-- Платёжное поручение к счёту из кабинета заказчика (владелец 25.11.2026).
-- Файл — в бакете b2b-attachments (invoices/<id>/…), здесь путь и кто/когда приложил.
alter table public.invoices
  add column if not exists payment_doc_path text,
  add column if not exists payment_doc_name text,
  add column if not exists payment_doc_at timestamptz,
  add column if not exists payment_doc_by text;
