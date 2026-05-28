## Текущая задача
CFO Center MVP завершён и задеплоен

## Что сделано (сессия 28 мая)

### CFO Center — полный редизайн
- `app/admin/cfo/CfoClient.tsx` — полная перепись: P&L таблица с 6 направлениями, inline план (localStorage), фонды, ТБ0/ТБ1 прогресс-бары, AI-инсайты (7 rule-based условий), 5 вкладок
- `app/admin/cfo/page.tsx` — MonthActuals из calculations по PRODUCT_TO_DIR, роль cfo в guard
- `docs/CFO_FINMODEL_ARCHITECTURE.md` — полная архитектурная документация финмодели
- Коммит: af8d8ab, запушен в main

## Следующий шаг
По приоритетам из SYSTEM.md:
1. Менеджер (`/manager`) — личный кабинет: мои сделки, задачи на день, активность
2. Или: вынести VC% направлений из хардкода в cfo_settings (таблица financial_settings)

## Контекст
- CFO Center живёт в `/admin/cfo/` (не `/cfo/`) — это admin-раздел
- Plan и Funds хранятся в localStorage (ключи: `cfo_rev_plan`, `cfo_funds`)
- ТБ0 = FC / (1 - weightedVC), ТБ1 = FC / ((1 - weightedVC) × (1 - fundsPct))
- Дефолты из ТБ1: FC=2 868 890, VC=62%, target=8 700 000
- TypeScript чистый (ошибки только в pre-existing __tests__)

## Открытые вопросы
- b2b_glass факт = 0 (нет в calculations, нужен ручной ввод или AmoCRM интеграция)
- localStorage план теряется в инкогнито — нужна таблица cfo_plan_snapshots
- VC% направлений захардкожен в REV_DIRS — нужно вынести в настройки
