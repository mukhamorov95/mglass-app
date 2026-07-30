# Онбординг партнёра в личный кабинет (безопасно)

Кабинет партнёра (`/partner`) — **server-only**: партнёр не выполняет запросов к БД
из браузера, только вызовы `/api/partner/*` (service-role, жёсткий фильтр по его
`client_id`, отдаётся только его цена — без себестоимости/маржи). Это главная стена.

Защита в глубину: партнёрский пользователь живёт в **отдельной организации**
(`organizations` id **2**, «Партнёры B2B»), а не в нашей org 1. Так даже случайный
браузерный запрос не отдаст ничего внутреннего (`auth.org_id()` вернёт 2, где нет
наших данных). Заказы партнёр видит через политику `Partner reads own orders`
(по `client_id`), независимо от организации.

## Шаги (создаёт владелец — я не завожу учётки/пароли)

1. **Создать auth-аккаунт** партнёра в Supabase → Authentication → Users → Add user
   (email партнёра + пароль). Скопировать его `UID`.

2. **Привязать роль, организацию и клиента** (Supabase SQL editor), подставив `<UID>`
   и нужный `client_id` (для MR GLASS — `10`):

```sql
-- роль partner (доступ только к /partner)
insert into public.users (id, role) values ('<UID>', 'partner')
on conflict (id) do update set role = 'partner';

-- отдельная организация «Партнёры B2B» (id 2) — изоляция от org 1
insert into public.profiles (user_id, organization_id, role)
values ('<UID>', 2, 'partner')
on conflict (user_id) do update set organization_id = 2, role = 'partner';

-- связка партнёр → его компания
update public.b2b_clients set user_id = '<UID>' where id = 10;
```

3. Партнёр логинится обычным `/login` → его кидает на `/partner`.

## Проверка изоляции
- Под аккаунтом партнёра `/` и `/partner` доступны, всё остальное → `/access-denied`.
- В кабинете видны только заказы его компании; ни себестоимости, ни маржи, ни чужих.
- Владелец (admin/ceo) может открыть `/partner` — партнёр этого не видит.
