-- Брак/переделка: причины словами владельца (14.10) — бой при резке, бой при закалке,
-- брак кромки, ошибка размера, рекламация клиента, другое.
--
-- Только расширяет CHECK: коды первой версии (break, scratch, material_defect) остаются
-- допустимыми — новых записей с ними нет, но строки читаются и подписываются.
-- Строк в production_rework на 14.10 — ноль, так что нарушающих условие быть не может.
--
-- Порядок: ДО деплоя кода (код шлёт новые коды; без миграции вставка падает CHECK 23514,
-- и маршрут отвечает понятной ошибкой «нужна миграция», а не молча).
--
-- RLS не трогаем: пишет только /api/production/rework сервис-ключом после requireRole
-- (production, admin, ceo, buyer). Живые политики на 14.10: SELECT и INSERT
-- TO authenticated с NOT is_partner().

ALTER TABLE public.production_rework DROP CONSTRAINT IF EXISTS pr_reason_valid;
ALTER TABLE public.production_rework ADD CONSTRAINT pr_reason_valid CHECK (
  reason_code IN (
    'break_cutting', 'break_tempering', 'edge_defect', 'wrong_size', 'client_claim', 'other',
    'break', 'scratch', 'material_defect'
  )
);

COMMENT ON COLUMN public.production_rework.found_at_stage IS
  'Этап, на котором брак обнаружен: задача, на которой нажали (очередь), или первый незакрытый
   этап позиции (карточка заказа). after_production — у позиции не осталось открытых этапов
   (рекламация после отгрузки): маршрут тогда не переоткрывается.';
