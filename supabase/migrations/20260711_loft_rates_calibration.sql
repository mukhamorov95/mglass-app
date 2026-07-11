-- Калибровка ставок лофта владельцем (11.07.2026):
-- бонки 30→13 ₽/точка (~1500 ₽ на лофт), петля 400→300 ₽/шт,
-- расходники 140→45 ₽/пог.м (~3000 ₽ на лофт),
-- сборка: НОВАЯ ставка glazing_m2 500 ₽/м² изделия (вместо ₽/стекло; старая
-- glazing_glass остаётся фолбэком в calcLoftFactory, но не используется).

update loft_rates set value = 13  where key = 'bonka';
update loft_rates set value = 300 where key = 'hinge';
update loft_rates set value = 45  where key = 'consumables_m';

insert into loft_rates (key, label, unit, value, sort)
values ('glazing_m2', 'Остекление и сборка', '₽/м² изделия', 500, 100)
on conflict (key) do update set value = excluded.value;
