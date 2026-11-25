-- Вырез внешний III категории (владелец 25.11.2026): длинный большой вырез по краю, 2000 ₽.
insert into b2b_services (code, name, type, value, cost_price, unit_label, description, active, sort_order)
select 'cutout_outer_3', 'Вырез внешний III категории', 'fixed', 2000, 0, '₽/шт', 'Длинный большой вырез по краю стекла', true, 42
where not exists (select 1 from b2b_services where code = 'cutout_outer_3');
update b2b_services set sort_order = 43 where code = 'cutout_inner_1';
update b2b_services set sort_order = 44 where code = 'cutout_inner_2';
