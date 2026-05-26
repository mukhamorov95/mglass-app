## Текущая задача
Sales Monitor (AmoCRM) — реализован, ждёт ENV vars

## Что сделано (сессия 26 мая)

### КП (app/calculations/order/[groupId]/print/page.tsx)
- Размеры изделий: `getProductDescription` теперь всегда читает из `input_data` (форма + размер + материал)
- Формат: Изделие → Монтаж → Доставка — услуги идут отдельными строками сразу под своим изделием
- Цена изделия = `final_price − servicesTotal` (совпадает с "Стоимость изделия" в калькуляторе)
- ИТОГО = Σ(final_price) — совпадает с историей расчётов и калькулятором

### Sales Monitor (AmoCRM → Telegram)
- `lib/amocrm.ts` — клиент AmoCRM API v4 (read-only, token refresh, пагинация)
- `lib/salesMonitor.ts` — сбор метрик по Алине, Семёну, Александре, Яне + РОП-аналитика
- `app/api/cron/sales-monitor/route.ts` — GET-endpoint, авторизация CRON_SECRET
- `vercel.json` — добавлен cron `0 15 * * 1-5` (18:00 МСК, пн-пт)
- `skills/sales-monitor-skill.md` — skill-документация
- `skills/README.md` — обновлён до 16 Skills

### DB миграция localStorage (завершена ранее)
- health-check и ai-control-center: DB-first + localStorage fallback

## Следующий шаг — нужно от пользователя

Добавить в `.env.local` и Vercel:
```
AMOCRM_DOMAIN=yourdomain.amocrm.ru
AMOCRM_CLIENT_ID=...
AMOCRM_CLIENT_SECRET=...
AMOCRM_REFRESH_TOKEN=...
AMOCRM_REDIRECT_URI=https://yourdomain.vercel.app
TELEGRAM_OWNER_CHAT_ID=...   # ID чата руководителя (или TELEGRAM_CHAT_ID)
```

После — протестировать вручную: `GET /api/cron/sales-monitor` с заголовком `Authorization: Bearer {CRON_SECRET}`

## Контекст
- AmoCRM токен обновляется автоматически при каждом запуске (refresh → access)
- Все запросы к AmoCRM только GET — никаких следов в карточках
- Менеджеры определяются по имени (substring match): Алина, Семён, Александра, Яна
- Зоны воронки: 1=квалификация, 2=продажа, 3=оплата/производство — мэппинг по названию этапа
- Красные флаги: 0 активности, зависшие лиды >2д (зона1) / >3д (зона2,3), счёт >5д без оплаты

## Открытые вопросы
- Точные названия этапов воронки в AmoCRM — нужно проверить совпадение с мэппингом в salesMonitor.ts
- TELEGRAM_OWNER_CHAT_ID — нужен ID чата (не бота), можно узнать через @userinfobot
- AmoCRM OAuth app нужно создать в аккаунте и получить Client ID + Secret + Refresh Token
