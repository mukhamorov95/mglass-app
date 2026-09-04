-- Архив сделок и источник заявки.
--
-- archived_at — «удаление» карточки без потери данных: доска её не показывает,
-- владелец может вернуть. Жёстко ничего не удаляем: к сделке привязаны расчёты,
-- КП, договоры, замеры и деньги — их потеря необратима.
-- source — откуда пришла заявка (Авито, сайт, звонок, рекомендация, партнёр…),
-- как в AmoCRM. Свободный текст: список каналов живёт в коде и меняется чаще схемы.

alter table public.deals add column if not exists archived_at timestamptz;
alter table public.deals add column if not exists archived_by uuid;
alter table public.deals add column if not exists source text;

create index if not exists deals_archived_at_idx on public.deals (archived_at);

comment on column public.deals.archived_at is 'В архиве с этого момента; null — активная сделка';
comment on column public.deals.source is 'Источник заявки: avito | site | call | recommend | partner | repeat | other';
