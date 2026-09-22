-- Пароли сотрудников лежали в users.password_plain открытым текстом: 11 из 17
-- учёток, включая владельческую, и читал их любой вошедший не-партнёр своей же
-- сессией (политика users_read_staff: id = auth.uid() OR NOT is_partner()).
-- Решение владельца 22.09.2026: «исправить это безобразие».
--
-- Пароль живёт в Supabase Auth (хеш). Смена пароля сотруднику остаётся —
-- через auth.admin.updateUserById, как уже делает /api/admin/users; посмотреть
-- существующий пароль больше нельзя ни владельцу, ни кому-либо ещё.
update users set password_plain = null where password_plain is not null;
alter table users drop column if exists password_plain;
