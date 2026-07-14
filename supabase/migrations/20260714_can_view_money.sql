-- Доступ к разделу «Деньги» в производстве (read-only витрина финмодели цеха):
-- владелец решает, кто из команды видит доходы/расходы/ТБ и бонусный фонд.
alter table users add column if not exists can_view_money boolean not null default false;
