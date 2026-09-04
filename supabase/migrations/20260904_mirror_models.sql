-- Модели зеркал для вкладки «Расчёт» (маршрут З2).
-- Модель — строка справочника, а не ветка кода: добавить «круглое» или
-- «в металлической раме» должно быть заведением строки, а не релизом.
-- Читают все авторизованные (это витрина, не себестоимость); пишет service-role.

create table if not exists public.mirror_models (
  code text primary key,
  name text not null,
  descr text,
  shape text not null default 'rect',        -- rect | circle | oval
  has_lighting boolean not null default false,
  frame_kind text,                            -- null | vetro | metal | ushape (П-профиль → зеркало 6 мм)
  image_url text,
  sort int not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.mirror_models is 'Модели зеркал для «Расчёта»: добавление модели — строка справочника, а не релиз';
comment on column public.mirror_models.shape is 'rect | circle | oval';
comment on column public.mirror_models.frame_kind is 'null | vetro | metal | ushape (П-профиль, требует 6 мм)';

alter table public.mirror_models enable row level security;

drop policy if exists mirror_models_read on public.mirror_models;
create policy mirror_models_read on public.mirror_models
  for select to authenticated using (true);

insert into public.mirror_models (code, name, descr, shape, has_lighting, sort) values
  ('З1', 'Зеркало', 'Зеркало под размер, без подсветки.', 'rect', false, 10),
  ('З2', 'Зеркало с подсветкой', 'LED-подсветка по выбранным сторонам, управление кнопкой или сенсором.', 'rect', true, 20)
on conflict (code) do nothing;
