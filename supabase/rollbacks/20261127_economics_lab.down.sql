-- Откат лаборатории ценообразования. Удаляет только её таблицы: действующих данных в них нет.
drop table if exists public.economics_lab_variants;
drop table if exists public.economics_lab_projects;
drop table if exists public.economics_lab_reference_history;
drop table if exists public.economics_lab_reference;
