-- Б4: голосовые предложения бухгалтеров.
-- Правило владельца: расшифровка сохраняется ДОСЛОВНО и показывается сверху,
-- ниже — AI-разбор «вы хотите: 1, 2, 3», который бухгалтер подтверждает или
-- правит. Владелец/CFO видят все предложения, бухгалтер — свои.
-- Ничего не удаляется: отклонённые остаются с status='rejected'.

create table accounting_notes (
  id            bigserial primary key,
  unit          text not null check (unit in ('ip','ooo')),
  source        text not null default 'voice' check (source in ('voice','text')),
  audio_path    text,
  transcript    text,                    -- ДОСЛОВНО, не перефразировать
  items         jsonb not null default '[]'::jsonb,  -- [{text, kind, done}]
  summary       text,
  status        text not null default 'new' check (status in ('new','confirmed','rejected','failed')),
  error         text,
  answered_at   timestamptz,
  answered_by   text,
  created_by      uuid references users(id) on delete set null,
  created_by_name text,
  created_at    timestamptz not null default now()
);
create index idx_acc_notes_created on accounting_notes (created_at desc);

alter table accounting_notes enable row level security;

create policy acc_notes_select on accounting_notes for select to authenticated using (
  exists (select 1 from crm_caller() c where c.u_role in ('cfo','admin','ceo'))
  or (exists (select 1 from crm_caller() c where c.u_role = 'accountant') and created_by = auth.uid())
);
create policy acc_notes_insert on accounting_notes for insert to authenticated with check (
  exists (select 1 from crm_caller() c where c.u_role in ('accountant','cfo','admin','ceo'))
  and created_by = auth.uid()
);
create policy acc_notes_update on accounting_notes for update to authenticated using (
  exists (select 1 from crm_caller() c where c.u_role in ('cfo','admin','ceo'))
  or (exists (select 1 from crm_caller() c where c.u_role = 'accountant') and created_by = auth.uid())
);
