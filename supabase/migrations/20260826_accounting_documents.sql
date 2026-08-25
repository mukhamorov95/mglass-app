-- Б8: реестр документов бухгалтера и вложения к операциям ДДС.
-- УПД отдельной таблицы не имеет (документ печатается из заказа) — отмечаем
-- факт выдачи прямо на счёте, чтобы бухгалтер видел «счёт есть, УПД нет».
alter table invoices
  add column if not exists upd_issued_at date;

-- Скан/квитанция к операции: тот же приватный бакет, что у заявок на оплату.
alter table cashflow_entries
  add column if not exists attachment_path text;
