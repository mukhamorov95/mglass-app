# Российская точка входа (ru-edge)

Маршрут и причины — `docs/RUSSIA_ACCESS_ROUTE.md`, этапы Э2–Э4.

Схема: люди → `app.mglass.pro` (сервер в РФ, nginx) → Vercel → Supabase. Люди подключаются к российскому IP с VPN или без. Зарубежный отрезок идёт из дата-центра, а не с домашнего или мобильного провайдера.

На сервере работают:
- nginx — прокси всего приложения, включая `/supabase/*`;
- проба доступности раз в минуту с сигналом в Telegram (`probe.sh`);
- ночная полная копия базы с пробным восстановлением по воскресеньям (`backup.sh`).

## Что нужно от владельца

1. **Облачный сервер в РФ.** Ubuntu 26.04 или 24.04, от 1 vCPU / 1 ГБ RAM / 10 ГБ диска (reg.ru Free Tier — 3 месяца бесплатно). reg.ru «Облачный сервер», Selectel или Timeweb, около 400–700 ₽/мес.
   - При создании добавить SSH-ключ `mglass-ru-edge`. Публичная часть: `~/.mglass-secrets/ru-edge_ed25519.pub` на Mac владельца.
2. **DNS:** A-запись `app` в зоне `mglass.pro` (reg.ru) → IP сервера.
3. **Разрешить подключить `app.mglass.pro` к проекту Vercel `mglass-app`** — рекомендуемый режим, см. ниже.
4. **Пароль базы Supabase** для строки session pooler — для резервных копий. Кладётся только в `/etc/mglass/ru-edge.env` на сервере.

## Развёртывание

```bash
scp -i ~/.mglass-secrets/ru-edge_ed25519 -r infra/ru-edge root@<IP>:/opt/
ssh -i ~/.mglass-secrets/ru-edge_ed25519 root@<IP>
  mkdir -p /etc/mglass && cp /opt/ru-edge/ru-edge.env.example /etc/mglass/ru-edge.env && nano /etc/mglass/ru-edge.env
  bash /opt/ru-edge/setup.sh app.mglass.pro
```

Повторный запуск `setup.sh` безопасен: обновляет конфиги и перезапускает службы.

## Два режима связи с Vercel

| | Рекомендуемый | Запасной |
|---|---|---|
| Как запускать | `setup.sh app.mglass.pro` | `UPSTREAM_HOST=mglass-app.vercel.app setup.sh app.mglass.pro` |
| Что нужно в Vercel | `app.mglass.pro` подключён к проекту | ничего |
| SNI до Vercel | `app.mglass.pro` | `mglass-app.vercel.app` |
| Риск | Сертификат Vercel выпускает через наш прокси: HTTP-01 уходит на порт 80 Vercel | Если провайдеры дата-центра начнут резать по SNI `*.vercel.app`, отрезок до Vercel оборвётся |

Запасной режим проверен 29.09 в контейнере на живом приложении:
- `/login` 200, 19,7 КБ;
- `/` → 307 на `https://app.mglass.pro/login`, адрес переписан;
- `/supabase/auth/v1/health` 200;
- статика 200.

Серверных действий Next.js (`'use server'`) в приложении нет, поэтому проверка Origin не мешает.

## После запуска — в приложении

- `NEXT_PUBLIC_APP_URL=https://app.mglass.pro`. От неё строятся ссылки в Telegram, письмах и приглашениях.
- Самовызовы сервера (крон-цепочки, очередь) должны идти на vercel.app напрямую, а не через Россию и обратно.
- Supabase Auth: добавить `https://app.mglass.pro` в Site URL / Redirect URLs.
- Вебхуки AmoCRM, OnlinePBX, Авито, Wazzup, Telegram — на новый адрес (этап Э6).
- Встраивание на Tilda (`/embed/shower`) и форма сайта зеркал — на новый адрес.

## Откат

DNS-запись `app` удалить или направить на `cname.vercel-dns.com`. Приложение на `mglass-app.vercel.app` продолжает работать всё время — посредник ничего в нём не меняет.

## Проверка

- С сервера: `tail -f /var/log/mglass-probe.csv`. Поля: время, путь, код, байты, секунды, ok.
- Снаружи: полная загрузка `/login` с российских узлов. Сравнивать байты, а не код ответа (наблюдение 91).
