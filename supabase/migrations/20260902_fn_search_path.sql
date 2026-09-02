-- Пять функций без фиксированного search_path. Все SECURITY INVOKER, то есть
-- выполняются с правами вызывающего и эскалации не дают — это не дыра.
-- Фиксируем всё равно: линтер выдаёт на них WARN, а в куче формальных
-- предупреждений тонут настоящие. Поведение не меняется.
alter function public.supplier_price_categories(text)          set search_path = public;
alter function public.supplier_price_reprice(text, numeric)    set search_path = public;
alter function public.supplier_price_snapshot()                set search_path = public;
alter function public.inventory_moves_immutable()              set search_path = public;
alter function public.quote_quality_weekly(date)               set search_path = public;
