# Деплой MGlass на Vercel

## Что уже настроено в коде

- Авторизация через Supabase Auth (email + пароль)
- Middleware: незалогиненные → `/login`
- Роли: `admin` и `manager` (таблица `public.users`)
- Защита `/admin/*` — только `admin`
- Все AI-роуты защищены от неавторизованного доступа

---

## 1. Подготовка кода — GitHub

```bash
cd mglass-app

git init
git add .
git commit -m "initial"

# Создай репозиторий на github.com, затем:
git remote add origin https://github.com/ТВО_ИМЯПОЛЬЗОВАТЕЛЯ/mglass-app.git
git push -u origin main
```

> `.env.local` уже в `.gitignore` — секреты в репо не попадут.

---

## 2. Supabase — применить схему БД

Открой [supabase.com](https://supabase.com) → твой проект → **SQL Editor**.

Выполни файл `supabase/schema.sql` целиком (скопируй и запусти).

Потом проверь, что все таблицы созданы в **Table Editor**.

---

## 3. Vercel — деплой

1. Зайди на [vercel.com](https://vercel.com) → **Add New Project**
2. Импортируй репозиторий из GitHub
3. Framework: **Next.js** (определится автоматически)
4. Нажми **Deploy** — первый деплой пройдёт без переменных (будет ошибка при входе, это нормально)

---

## 4. Переменные окружения на Vercel

Vercel → проект → **Settings → Environment Variables**.

Добавь каждую переменную:

| Имя | Значение | Где взять |
|-----|----------|-----------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xxxx.supabase.co` | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJ...` | Supabase → Project Settings → API → anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` | Supabase → Project Settings → API → service_role key |
| `ANTHROPIC_API_KEY` | `sk-ant-...` | [console.anthropic.com](https://console.anthropic.com) |
| `NEXT_PUBLIC_APP_URL` | `https://mglass-app.vercel.app` | URL твоего деплоя на Vercel |
| `RESEND_API_KEY` | _(необязательно)_ | [resend.com](https://resend.com) |
| `NOTIFY_ADMIN_EMAIL` | _(необязательно)_ | email для уведомлений |

После добавления переменных → **Redeploy** (Deployments → ⋯ → Redeploy).

---

## 5. Supabase — разрешить редиректы

Supabase → **Authentication → URL Configuration**:

- **Site URL**: `https://mglass-app.vercel.app`
- **Redirect URLs**: добавь `https://mglass-app.vercel.app/**`

---

## 6. Добавление пользователей

### Способ А — через Supabase Dashboard (быстро)

1. Supabase → **Authentication → Users → Invite user**
2. Введи email нового менеджера → **Send Invite**
3. Пользователь получит письмо со ссылкой для входа
4. После первого входа он автоматически попадает в `public.users` с ролью `manager`

### Способ Б — назначить роль `admin`

Supabase → **SQL Editor**:

```sql
update public.users
set role = 'admin'
where id = (
  select id from auth.users where email = 'email@example.com'
);
```

### Способ В — через админку приложения

Зайди в MGlass → **Настройки → Пользователи** (доступно только `admin`).

---

## 7. Обновление проекта

Любой `git push` в ветку `main` автоматически запускает новый деплой на Vercel.

```bash
# Внёс изменения
git add .
git commit -m "обновление"
git push
```

Vercel сам соберёт и задеплоит — обычно 1–2 минуты.

---

## 8. Кастомный домен (необязательно)

Vercel → **Settings → Domains** → добавь свой домен.
Пропиши CNAME/A-запись у регистратора домена.
Не забудь обновить `NEXT_PUBLIC_APP_URL` и Supabase Redirect URLs.

---

## Структура ролей

| Роль | Доступ |
|------|--------|
| `manager` | Калькуляторы, заказы, история, AI-ассистент |
| `admin` | Всё выше + справочники, материалы, настройки, пользователи |
