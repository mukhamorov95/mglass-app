-- Т5 (docs/partner-points/PARTNER_POINTS_ROUTE.md): причина гарантийного обращения.
-- Метрика точки «переделок по вине размера > 10 % — стоп» не считается, пока «вина
-- размера» не отличается от брака. Экран /b2b-claims работает и без этой колонки
-- (статус и ответ партнёру), выбор причины включается после выполнения файла.
-- Только добавление: существующие строки не меняются, писать по-прежнему может
-- только service-role (у partner_claims RLS без политик, 20260922_partner_no_cost.sql).

alter table partner_claims add column if not exists cause text;

alter table partner_claims drop constraint if exists partner_claims_cause_check;
alter table partner_claims add constraint partner_claims_cause_check
  check (cause is null or cause in ('size', 'defect', 'transport', 'other'));

comment on column partner_claims.cause is
  'Причина по итогам разбора: size — вина размера (замер/размер заказчика), defect — брак производства, transport — повреждение при доставке, other — другое. Ставит владелец в /b2b-claims.';
