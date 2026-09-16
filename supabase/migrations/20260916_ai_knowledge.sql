-- База знаний AI и компании (решение владельца 16.09.2026).
--
-- Раньше факты бота Ивана (стоимость замера, сроки, профиль компании) были вшиты
-- строкой в код: владелец не видел, что бот знает, и не мог это поправить без деплоя.
-- Старая таблица sales_knowledge_base из миграции 20250507 в боевую базу так и не
-- попала — экран «База знаний» в Sales Center всё это время смотрел в пустоту.
--
-- ai_knowledge      — что бот и команда знают (факты, одна запись = один факт).
-- ai_knowledge_gaps — чего бот НЕ знает: вопросы клиентов, на которые в базе не
--                     нашлось ответа. Пополняются ботом, закрываются владельцем.
--
-- Доступ только через сервер (service role за requireOwner / вебхук). Политики не
-- создаются намеренно: база кормит бота, который пишет клиентам сам, — правка из
-- браузера в обход роли владельца стала бы прямой записью в уста бота.

create table if not exists public.ai_knowledge (
  id          bigint generated always as identity primary key,
  category    text not null check (category in ('company','products','process','pricing','guarantee','objections','competitors','b2b')),
  title       text not null,
  content     text not null,
  for_bot     boolean not null default true,
  active      boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  text
);

create index if not exists ai_knowledge_cat_idx on public.ai_knowledge (category, sort_order) where active;

create table if not exists public.ai_knowledge_gaps (
  id            bigint generated always as identity primary key,
  question      text not null,
  source        text not null default 'avito',
  lead_id       bigint references public.crm_leads(id) on delete set null,
  status        text not null default 'open' check (status in ('open','answered','dismissed')),
  knowledge_id  bigint references public.ai_knowledge(id) on delete set null,
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz,
  resolved_by   text
);

create index if not exists ai_knowledge_gaps_open_idx on public.ai_knowledge_gaps (created_at desc) where status = 'open';

alter table public.ai_knowledge      enable row level security;
alter table public.ai_knowledge_gaps enable row level security;
revoke all on public.ai_knowledge      from anon, authenticated;
revoke all on public.ai_knowledge_gaps from anon, authenticated;

-- Стартовое наполнение: ровно те факты, что были вшиты в промпт Ивана и работали
-- в проде. Непроверенных цифр сюда не переносим — пусть лучше бот скажет «уточню».
insert into public.ai_knowledge (category, title, content, sort_order, updated_by)
select * from (values
  ('company',  'Кто мы',              'M-Glass, Москва. Собственное производство: зеркала, душевые перегородки из стекла, лофт-перегородки, стекло под размер.', 1, 'перенос из промпта'),
  ('company',  'Чем не занимаемся',   'Автостёкла, ремонт стеклопакетов, мебель на заказ без стекла — не наш профиль, вежливо отказываем.', 2, 'перенос из промпта'),
  ('company',  'География',           'Работаем по Москве и области. Другой город — не отказываем, уточняем у менеджера, возим ли туда.', 3, 'перенос из промпта'),
  ('process',  'Замер',               'Замер по Москве — 2500 ₽, сумма идёт в зачёт стоимости заказа (при заказе замер по сути бесплатный). Точное время назначает менеджер по графику замерщиков.', 1, 'перенос из промпта'),
  ('process',  'Готовность объекта к замеру', 'Перед замером: закончена черновая отделка, установлены ванна или поддон, есть доступ. Не готово — договариваемся вернуться, когда будет готово.', 2, 'перенос из промпта'),
  ('process',  'Сроки изготовления',  'Обычно 5–7 рабочих дней. Точный срок — после замера, конкретные даты заранее не обещаем.', 3, 'перенос из промпта'),
  ('pricing',  'Цена изделия',        'Точную стоимость под проём и комплектацию считает менеджер. Цифру «на глаз» не называем.', 1, 'перенос из промпта'),
  ('pricing',  'Скидки',              'Скидок не даём. Для небольшого бюджета предлагаем эконом-вариант: производство своё, можем дешевле рынка.', 2, 'перенос из промпта')
) as v(category, title, content, sort_order, updated_by)
where not exists (select 1 from public.ai_knowledge);
