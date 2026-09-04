-- Отказ с причиной и обещание перезвонить (разбор кабинета, группа 2).
--
-- Отказ: сделку можно было только двигать вперёд или прятать в архив. Проигранная
-- висела в «КП отправлено» вечно и раздувала «Зависли», а архив прятал её без
-- причины — потом не ответить, почему не купили. Отказ — это исход, а не удаление.
--
-- next_contact_at: доска знает, что тишина 12 дней, но менеджеру негде записать
-- «перезвонить в понедельник». По этой дате считается просрочка обещания —
-- это и есть рабочий список на день, в отличие от «просто давно не трогали».
--
-- deal_notes: что обсуждали. Без этого возврат к сделке через неделю — с нуля.

alter table public.deals add column if not exists lost_at timestamptz;
alter table public.deals add column if not exists lost_reason text;
alter table public.deals add column if not exists next_contact_at date;

comment on column public.deals.lost_at is 'Отказ клиента: сделка выбывает с доски, но остаётся с причиной';
comment on column public.deals.lost_reason is 'Причина отказа — цена, выбрал другого, отложил, не отвечает, не наш профиль, другое';
comment on column public.deals.next_contact_at is 'Дата следующего контакта: обещание менеджера, по нему считается просрочка';

create index if not exists deals_lost_at_idx on public.deals (lost_at);
create index if not exists deals_next_contact_idx on public.deals (next_contact_at);

create table if not exists public.deal_notes (
  id bigserial primary key,
  deal_id bigint not null references public.deals(id) on delete cascade,
  text text not null,
  author_id uuid,
  author_name text,
  created_at timestamptz not null default now()
);
create index if not exists deal_notes_deal_idx on public.deal_notes (deal_id, created_at desc);

alter table public.deal_notes enable row level security;

-- Доступ к заметкам определяется доступом к сделке: RLS на deals уже отсекает
-- чужие, а роуты дополнительно проверяют canSeeDeal через сервис-клиент.
drop policy if exists deal_notes_select on public.deal_notes;
create policy deal_notes_select on public.deal_notes for select to authenticated using (
  exists (select 1 from public.deals d where d.id = deal_notes.deal_id)
);

drop policy if exists deal_notes_write on public.deal_notes;
create policy deal_notes_write on public.deal_notes for all to authenticated using (
  exists (select 1 from public.deals d where d.id = deal_notes.deal_id)
) with check (
  exists (select 1 from public.deals d where d.id = deal_notes.deal_id)
);
